import {EPS, Q_MAX} from './params'

export type FitSettings = {
  width: number
  height: number
  count: number
  bg: [number, number, number]
  eps: number
  qMax: number
  lr: number[] // one learning rate per param, in params.ts order
  beta1: number
  beta2: number
  adamEps: number
  sigmaMin: number // normalized to the long side
  sigmaMax: number
  maxSide: number // the gather samples at most maxSide x maxSide pixels per blob
}

// Overall speed of the painting, so the first steps can be watched. The step shown after t seconds
// of fitting is at most e^(PAINT_SPEED * t) - 1: one canvas update per step at first, then ever larger
// batches, until the GPU's own speed is the limit (about 6 s in at 0.7). Higher = faster start.
export const PAINT_SPEED = 0.7

// "painting" mode starts with this many active blobs and grows towards the chosen blob count.
export const START_BLOBS = 32
// Growth speed of "painting" mode, in steps so the same seed grows identically. The first doubling of
// the active blob count takes GROWTH_FIRST_DOUBLING_STEPS steps, and each later doubling
// GROWTH_DOUBLING_RATIO times as many as the one before: few steps while steps are slow (few, large
// blobs), more once they get cheap, so every doubling takes about the same wall-clock time.
export const GROWTH_FIRST_DOUBLING_STEPS = 20
export const GROWTH_DOUBLING_RATIO = 1.3
// Pace cap: growth to the target takes at least this many seconds of fitting on any machine. The
// schedule stays in steps; the cap only keeps the step count from running ahead of the clock
// (see growthStepLimit). Slower machines are not affected. No cap after growth.
export const GROWTH_MIN_SECONDS = 25

// Auto-stop. A fit is done when growth is complete and the mean mistake over the last STOP_WINDOW_STEPS
// steps is less than STOP_MIN_IMPROVEMENT (relative) below the mean over the window before it,
// or after MAX_STEPS steps since the start or the last resume.
export const STOP_WINDOW_STEPS = 250
export const STOP_MIN_IMPROVEMENT = 0.005
export const MAX_STEPS = 8000

// Worst-case average number of blobs drawn over one pixel. Through the sigma cap this bounds
// both the forward pass and the gather: at most MAX_OVERDRAW * width * height pixels per step.
const MAX_OVERDRAW = 200

export function defaultSettings(
  width: number,
  height: number,
  count: number,
  bg: [number, number, number],
): FitSettings {
  const longSide = Math.max(width, height)
  const area = (width * height) / (longSide * longSide)
  // count * (2 * 3 * sigmaMax)^2 <= MAX_OVERDRAW * area
  const sigmaMax = Math.min(0.15, Math.sqrt((MAX_OVERDRAW * area) / count) / 6)
  return {
    width,
    height,
    count,
    bg,
    eps: EPS,
    qMax: Q_MAX,
    //   x     y     log_sx log_sy theta r      g      b      a_raw
    lr: [5e-4, 5e-4, 0.01, 0.01, 0.01, 0.005, 0.005, 0.005, 0.02],
    beta1: 0.9,
    beta2: 0.999,
    adamEps: 1e-10,
    sigmaMin: 0.3 / longSide,
    sigmaMax,
    // The bounding box of a blob at the sigma cap (plus a pixel of slack), so every blob within
    // the cap is read at full stride and subsampling is only a safety net beyond it.
    maxSide: Math.floor(2 * Math.sqrt(Q_MAX) * sigmaMax * longSide) + 2,
  }
}
