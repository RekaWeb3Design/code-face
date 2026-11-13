import {A_RAW, B, EPS, G, LOG_SX, LOG_SY, P, Q_MAX, R, THETA, X, Y} from '../fitter/params'
import {prng} from '../fitter/prng'
import type {Scene} from './render'

// Fixed case for the subsampled gather, shared by vitest and the in-app GPU self-test.
// Blob 0 covers the whole 64x48 image, so with maxSide = 16 it is read on a 4x3 grid
// (16x16 samples out of 3072 pixels). The other blobs are small enough to stay at stride 1.
// The target is smooth, like a photo, not noise.
export const SUBSAMPLE_MAX_SIDE = 16
export const SUBSAMPLE_STRIDE: [number, number] = [4, 3]
export const BIG_BLOB = 0

export function subsampleCase(seed = 11) {
  const width = 64
  const height = 48
  const count = 5
  const rand = prng(seed)
  const rgba = new Uint8ClampedArray(width * height * 4)
  const target = new Float64Array(width * height * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const k = y * width + x
      const u = x / width
      const v = y / height
      const rgb = [
        0.5 + 0.4 * Math.sin(5 * u + 2 * v),
        0.5 + 0.4 * Math.cos(3 * u - 4 * v + 1),
        0.3 + 0.5 * u * v + 0.2 * Math.sin(7 * v),
      ]
      for (let ch = 0; ch < 3; ch++) {
        rgba[k * 4 + ch] = Math.round(rgb[ch] * 255)
        target[k * 3 + ch] = rgba[k * 4 + ch] / 255
      }
      rgba[k * 4 + 3] = 255
    }
  }
  const params = new Float32Array(count * P)
  for (let i = 0; i < count; i++) {
    const o = i * P
    const big = i === BIG_BLOB
    params[o + X] = big ? 0.45 : 0.15 + 0.7 * rand()
    params[o + Y] = big ? 0.4 : (0.15 + 0.7 * rand()) * (height / width)
    params[o + LOG_SX] = Math.log(big ? 0.35 : 0.02 + 0.015 * rand())
    params[o + LOG_SY] = Math.log(big ? 0.22 : 0.02 + 0.015 * rand())
    params[o + THETA] = big ? 0.5 : (rand() - 0.5) * Math.PI
    params[o + R] = 0.1 + 0.8 * rand()
    params[o + G] = 0.1 + 0.8 * rand()
    params[o + B] = 0.1 + 0.8 * rand()
    params[o + A_RAW] = 2 * rand() - 1
  }
  const scene: Scene = {width, height, bg: [0.5, 0.4, 0.3], eps: EPS, qMax: Q_MAX}
  return {scene, count, params, target, rgba}
}

// Relative error of blob `blob`'s 9 gradients against a reference: max over params of |a - b| / |b|.
export function blobGradError(a: ArrayLike<number>, b: ArrayLike<number>, blob: number) {
  let err = 0
  let param = 0
  for (let k = 0; k < P; k++) {
    const rel = Math.abs(a[blob * P + k] - b[blob * P + k]) / Math.abs(b[blob * P + k])
    if (!(rel <= err)) {
      err = Number.isNaN(rel) ? Infinity : rel
      param = k
    }
  }
  return {err, param}
}
