import {createAutoStop, type StopReason} from './autoStop'
import type {Fitter, SigmaStats} from './fitter'
import {growthStepLimit, type GrowthEvent} from './growth'
import {GROWTH_MIN_SECONDS, MAX_STEPS, PAINT_SPEED, STOP_MIN_IMPROVEMENT, STOP_WINDOW_STEPS, type FitSettings} from './settings'

const LOSS_EVERY_STEPS = 25 // a loss readback after this many steps ...
const LOSS_EVERY_MS = 500 // ... or this much time, whichever comes first (only if a step was taken)
const MAX_STEPS_PER_BATCH = 64
const TARGET_MS = 30 // aimed duration of one batch, submit to finished, so the canvas keeps updating

export type Loop = {
  setPaused(paused: boolean): void
  stop(): void
}

// Progressive growth of the active blob count ("painting" mode).
export type Growth = {
  events: GrowthEvent[] // in step order
  // The blobs [from, event.active) for event number `index`, placed with the per-pixel error map.
  sample(error: Float32Array, from: number, event: GrowthEvent, index: number): Float32Array
  settingsFor(active: number): FitSettings
  // Told after each growth event: the step, how many blobs were added, and the new active count.
  onGrown(step: number, added: number, total: number): void
}

// What one loss readback reports.
export type LoopStats = {
  step: number
  active: number // active blobs at that step
  loss: number
  stepsPerSecond: number | null // since the previous readback; null right after a start or resume
  sigma: SigmaStats | null // only when asked for
  blobIndices: number[] // the blobs chosen by pickBlobs ...
  blobs: Float32Array // ... and their params, 9 floats each, read with the loss
}

// Runs the fit, one batch of optimisation steps per animation frame, and draws after every batch.
// - Pacing: the step count follows e^(PAINT_SPEED * seconds) - 1, so early steps are shown one by
//   one and the batches grow from there.
// - Back-pressure: a new batch is only submitted once the GPU has finished the previous one, and the
//   batch size adapts to how long the GPU takes, so the queue can never pile up.
// - The loss is read back asynchronously, never per step; withSigma adds the blob-size summary to
//   that same readback, and pickBlobs chooses a few blobs whose params come along with it.
// - Growth: when an event is due, stepping waits for one readback of the per-pixel error, the new
//   blobs are placed with it, and stepping goes on. Events are tied to step numbers, so the same seed
//   gives the same growth sequence.
export function runLoop(
  device: GPUDevice,
  fitter: Fitter,
  withSigma: boolean,
  pickBlobs: (active: number) => number[],
  growth: Growth | null,
  draw: () => void,
  // seconds: fitting time so far, pauses excluded
  onStep: (step: number, active: number, seconds: number) => void,
  onStats: (stats: LoopStats) => void,
  // The fit stopped by itself (see autoStop.ts). setPaused(false) continues past it.
  onDone: (reason: StopReason) => void,
  onError: (error: unknown) => void,
): Loop {
  let paused = false
  let stopped = false
  let busy = false
  let maxBatch = 1 // what the GPU can take per frame
  let grown = 0 // growth events done
  const autoStop = createAutoStop(STOP_WINDOW_STEPS, STOP_MIN_IMPROVEMENT, MAX_STEPS)
  let fitMs = 0 // time spent fitting, pauses excluded
  let lastFrame: number | null = null
  let statsPending = false
  let lastStats: {step: number; time: number} | null = null
  // Step and time of the previous readback while running, to measure steps per second.
  let mark: {step: number; time: number} | null = null

  function readStats(now: number) {
    statsPending = true
    const step = fitter.steps
    const stepsPerSecond = mark && now > mark.time ? ((step - mark.step) * 1000) / (now - mark.time) : null
    mark = {step, time: now}
    lastStats = {step, time: now}
    const active = fitter.active
    const blobIndices = pickBlobs(active)
    fitter
      .readStats({sigma: withSigma, blobs: blobIndices})
      .then(({loss, sigma, blobs}) => {
        if (stopped) return
        onStats({step, active, loss, stepsPerSecond, sigma, blobIndices, blobs})
        if (paused || (growth && grown < growth.events.length)) return
        const reason = autoStop.add(step, loss)
        if (reason) {
          paused = true
          mark = null
          onDone(reason)
        }
      }, onError)
      .finally(() => {
        statsPending = false
      })
  }

  // Submits the next batch if the pacing asks for one and the GPU is free.
  function pump() {
    if (stopped || paused || busy || lastFrame === null) return
    const event = growth?.events[grown]
    if (growth && event && fitter.steps >= event.step) {
      busy = true
      const index = grown
      fitter.readErrorMap().then((error) => {
        if (stopped) return
        const before = fitter.active
        fitter.grow(growth.sample(error, before, event, index), growth.settingsFor(event.active))
        grown++
        growth.onGrown(fitter.steps, event.active - before, event.active)
        if (grown === growth.events.length) autoStop.restart(fitter.steps) // judge convergence from here
        busy = false
        onStep(fitter.steps, fitter.active, fitMs / 1000)
        pump()
      }, onError)
      return
    }
    // The ramp for the first steps, and during growth the pace cap.
    const paced = Math.floor(Math.expm1((PAINT_SPEED * fitMs) / 1000))
    const capped = growth ? growthStepLimit(growth.events, fitMs / 1000, GROWTH_MIN_SECONDS) : Infinity
    const wanted = Math.min(paced, capped) - fitter.steps
    if (wanted < 1) return
    busy = true
    const started = performance.now()
    // Never step past a growth event.
    const batch = Math.min(wanted, maxBatch, event ? event.step - fitter.steps : Infinity)
    fitter.step(batch)
    draw()
    onStep(fitter.steps, fitter.active, fitMs / 1000)
    device.queue.onSubmittedWorkDone().then(() => {
      busy = false
      const ms = performance.now() - started
      // Scale the batch limit towards TARGET_MS, at most doubling per batch.
      const fits = Math.round((batch * TARGET_MS) / Math.max(ms, 1))
      maxBatch = Math.max(1, Math.min(MAX_STEPS_PER_BATCH, maxBatch * 2, fits))
      // Go on right away instead of waiting for the next animation frame.
      pump()
    }, onError)

    const since = lastStats ? {steps: fitter.steps - lastStats.step, ms: started - lastStats.time} : null
    if (!statsPending && (!since || since.steps >= LOSS_EVERY_STEPS || since.ms >= LOSS_EVERY_MS)) readStats(started)
  }

  // The animation frame keeps the fitting clock and starts a batch whenever none is running.
  function frame(now: number) {
    if (stopped) return
    requestAnimationFrame(frame)
    if (lastFrame === null) {
      // First frame: show the starting canvas and its loss before any step.
      lastFrame = now
      draw()
      onStep(0, fitter.active, 0)
      readStats(performance.now())
      return
    }
    if (!paused) fitMs += now - lastFrame
    lastFrame = now
    pump()
  }
  requestAnimationFrame(frame)

  return {
    setPaused(value) {
      if (paused && !value) autoStop.restart(fitter.steps) // resuming: fresh history, fresh step limit
      paused = value
      mark = null // the pause must not count as fitting time
    },
    stop() {
      stopped = true
    },
  }
}
