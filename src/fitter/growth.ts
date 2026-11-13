import type {Photo} from './init'
import {A_RAW, B, G, LOG_SX, LOG_SY, P, R, THETA, X, Y} from './params'
import {prng} from './prng'

// New blobs start at this multiple of the blob spacing at the new active count.
const GROWTH_SIGMA_FACTOR = 0.5
// Growth events per doubling of the active count.
const EVENTS_PER_DOUBLING = 4

export type GrowthEvent = {
  step: number // the event happens once this many steps are done
  active: number // active blobs after the event
}

// Steps done when the active count has doubled u times (u may be fractional): doubling number k
// (from u = k to u = k + 1) takes firstDoublingSteps * ratio^k steps.
export function stepsAtDoublings(u: number, firstDoublingSteps: number, ratio: number): number {
  return ratio === 1 ? firstDoublingSteps * u : (firstDoublingSteps * (ratio ** u - 1)) / (ratio - 1)
}

// The active count rises geometrically from `start` to `target`, in EVENTS_PER_DOUBLING events per
// doubling; see stepsAtDoublings for when. Depends on nothing but its arguments.
export function growthSchedule(
  start: number,
  target: number,
  firstDoublingSteps: number,
  ratio: number,
): GrowthEvent[] {
  const events: GrowthEvent[] = []
  let active = start
  let lastStep = 0
  for (let k = 1; active < target; k++) {
    const next = Math.min(target, Math.round(start * 2 ** (k / EVENTS_PER_DOUBLING)))
    if (next > active) {
      active = next
      // At least one step between events, so each one is fitted before the next readback.
      lastStep = Math.max(lastStep + 1, Math.round(stepsAtDoublings(k / EVENTS_PER_DOUBLING, firstDoublingSteps, ratio)))
      events.push({step: lastStep, active})
    }
  }
  return events
}

// Params for the blobs [from, to) added by growth event number `eventIndex`.
// Positions are drawn in proportion to the per-pixel error (one value per pixel, row 0 at the top),
// the colour is the photo's pixel there, sigma follows the blob spacing at the new active count.
// Same seed + same event + same error map -> identical blobs.
export function sampleNewBlobs(
  error: ArrayLike<number>,
  photo: Photo,
  seed: number,
  eventIndex: number,
  from: number,
  to: number,
): Float32Array {
  const {width, height, data} = photo
  const longSide = Math.max(width, height)
  const pixels = width * height
  const cdf = new Float64Array(pixels)
  let total = 0
  for (let k = 0; k < pixels; k++) {
    total += Math.max(0, error[k]) || 0 // NaN counts as no error
    cdf[k] = total
  }
  const rand = prng((seed + Math.imul(eventIndex + 1, 0x9e3779b1)) >>> 0)
  const logSigma = Math.log(GROWTH_SIGMA_FACTOR * Math.sqrt(pixels / (longSide * longSide) / to))
  const params = new Float32Array((to - from) * P)
  for (let i = 0; i < to - from; i++) {
    let pixel: number
    if (total > 0) {
      const pick = rand() * total
      let lo = 0
      let hi = pixels - 1
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (cdf[mid] > pick) hi = mid
        else lo = mid + 1
      }
      pixel = lo
    } else {
      pixel = Math.min(pixels - 1, Math.floor(rand() * pixels)) // no error anywhere: uniform
    }
    const o = i * P
    params[o + X] = ((pixel % width) + rand()) / longSide
    params[o + Y] = (Math.floor(pixel / width) + rand()) / longSide
    params[o + LOG_SX] = logSigma
    params[o + LOG_SY] = logSigma
    params[o + THETA] = 0
    params[o + R] = data[pixel * 4] / 255
    params[o + G] = data[pixel * 4 + 1] / 255
    params[o + B] = data[pixel * 4 + 2] / 255
    params[o + A_RAW] = 0
  }
  return params
}

// Pace cap during growth: the highest step allowed after `seconds` of fitting, so that growth to the
// target takes at least `minSeconds` however fast the GPU is. Growth event k of E (1-based) may not
// happen before k / E * minSeconds; between events the allowed step rises evenly. Slower machines
// never reach this limit. After the last event (or with minSeconds = 0) there is no limit.
export function growthStepLimit(events: readonly GrowthEvent[], seconds: number, minSeconds: number): number {
  if (minSeconds <= 0) return Infinity
  const position = (seconds / minSeconds) * events.length
  const i = Math.floor(position)
  if (i >= events.length) return Infinity
  const from = i === 0 ? 0 : events[i - 1].step
  return Math.floor(from + (position - i) * (events[i].step - from))
}
