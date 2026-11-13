import {A_RAW, B, G, LOG_SX, LOG_SY, P, R, THETA, X, Y} from './params'
import {prng} from './prng'
import {START_BLOBS} from './settings'

// The downscaled photo, RGBA bytes, row 0 at the top.
export type Photo = {width: number; height: number; data: Uint8ClampedArray}

// Where the painting starts.
//   blank: uniform random positions, every blob the mean colour of the photo, large and blurry.
//          Step 0 is a flat canvas; nothing but the mean colour comes from the photo.
//   photo: positions follow the edges of the photo and each blob takes the colour of its pixel.
//          Step 0 already resembles the photo.
//   painting: like blank, but only START_BLOBS blobs are active at first, sized for that count.
export type InitMode = 'painting' | 'blank' | 'photo'

// How many blobs are active at step 0 when the fit aims for `target` blobs.
export const startCount = (mode: InitMode, target: number) =>
  mode === 'painting' ? Math.min(START_BLOBS, target) : target

// Initial sigma as a multiple of the average spacing between blobs.
// Blank: measured 1.0 against 1.5 on one photo (8k blobs): 1.0 was about 1.4x faster per step and
// ended slightly lower. Step 0 is a flat canvas either way.
const BLANK_SIGMA_FACTOR = 1
const PHOTO_SIGMA_FACTOR = 0.5
const PAINTING_SIGMA_FACTOR = 0.5
// 'photo' mode: share of blobs that land anywhere (uniformly) instead of following edges, FLAT / (1 + FLAT).
const FLAT = 0.5

// Sobel gradient magnitude of the luminance, one value per pixel.
export function edgeMagnitude({width, height, data}: Photo): Float32Array {
  const lum = new Float32Array(width * height)
  for (let k = 0; k < width * height; k++) {
    lum[k] = (0.2126 * data[k * 4] + 0.7152 * data[k * 4 + 1] + 0.0722 * data[k * 4 + 2]) / 255
  }
  const at = (x: number, y: number) =>
    lum[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))]
  const mag = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gx =
        at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)
      const gy =
        at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)
      mag[y * width + x] = Math.hypot(gx, gy)
    }
  }
  return mag
}

export function meanColor({width, height, data}: Photo): [number, number, number] {
  const sum = [0, 0, 0]
  for (let k = 0; k < width * height; k++) {
    for (let ch = 0; ch < 3; ch++) sum[ch] += data[k * 4 + ch]
  }
  const n = width * height * 255
  return [sum[0] / n, sum[1] / n, sum[2] / n]
}

// Log of a sigma that is `factor` times the average spacing between blobs, normalized to the long side.
function logSigma({width, height}: Photo, count: number, factor: number): number {
  const longSide = Math.max(width, height)
  return Math.log(factor * Math.sqrt((width * height) / (longSide * longSide) / count))
}

function writeBlob(
  params: Float32Array,
  i: number,
  x: number,
  y: number,
  logS: number,
  rgb: ArrayLike<number>,
  rgbOffset: number,
  rgbScale: number,
) {
  const o = i * P
  params[o + X] = x
  params[o + Y] = y
  params[o + LOG_SX] = logS
  params[o + LOG_SY] = logS
  params[o + THETA] = 0
  params[o + R] = rgb[rgbOffset] * rgbScale
  params[o + G] = rgb[rgbOffset + 1] * rgbScale
  params[o + B] = rgb[rgbOffset + 2] * rgbScale
  params[o + A_RAW] = 0
}

function initBlank(photo: Photo, count: number, seed: number, factor: number): Float32Array {
  const {width, height} = photo
  const longSide = Math.max(width, height)
  const rand = prng(seed)
  const logS = logSigma(photo, count, factor)
  const mean = meanColor(photo)
  const params = new Float32Array(count * P)
  for (let i = 0; i < count; i++) {
    const x = (rand() * width) / longSide
    const y = (rand() * height) / longSide
    writeBlob(params, i, x, y, logS, mean, 0, 1)
  }
  return params
}

function initFromPhoto(photo: Photo, count: number, seed: number): Float32Array {
  const {width, height, data} = photo
  const longSide = Math.max(width, height)
  const pixels = width * height
  const mag = edgeMagnitude(photo)
  let mean = 0
  for (let k = 0; k < pixels; k++) mean += mag[k]
  mean /= pixels
  const floor = mean > 0 ? FLAT * mean : 1
  const cdf = new Float64Array(pixels)
  let total = 0
  for (let k = 0; k < pixels; k++) {
    total += mag[k] + floor
    cdf[k] = total
  }

  const rand = prng(seed)
  const logS = logSigma(photo, count, PHOTO_SIGMA_FACTOR)
  const params = new Float32Array(count * P)
  for (let i = 0; i < count; i++) {
    const pick = rand() * total
    let lo = 0
    let hi = pixels - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (cdf[mid] > pick) hi = mid
      else lo = mid + 1
    }
    const x = ((lo % width) + rand()) / longSide
    const y = (Math.floor(lo / width) + rand()) / longSide
    writeBlob(params, i, x, y, logS, data, lo * 4, 1 / 255)
  }
  return params
}

// Params for the `count` blobs that are active at step 0 (see startCount).
// Same seed + same photo + same mode -> identical params.
export function initBlobs(photo: Photo, count: number, seed: number, mode: InitMode): Float32Array {
  if (mode === 'photo') return initFromPhoto(photo, count, seed)
  return initBlank(photo, count, seed, mode === 'blank' ? BLANK_SIGMA_FACTOR : PAINTING_SIGMA_FACTOR)
}
