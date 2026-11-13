import {A_RAW, B, EPS, G, LOG_SX, LOG_SY, P, R, THETA, X, Y} from '../fitter/params'
import {prng} from '../fitter/prng'
import type {Scene} from './render'

// The fixed tiny case shared by the vitest gradient check and the in-app GPU self-test.
// Non-square on purpose so a mixed-up long-side normalization shows.
export function tinyCase(qMax: number, seed = 7) {
  const width = 16
  const height = 12
  const count = 5
  const rand = prng(seed)
  const rgba = new Uint8ClampedArray(width * height * 4)
  const target = new Float64Array(width * height * 3)
  for (let k = 0; k < width * height; k++) {
    for (let ch = 0; ch < 3; ch++) {
      rgba[k * 4 + ch] = Math.floor(rand() * 256)
      target[k * 3 + ch] = rgba[k * 4 + ch] / 255
    }
    rgba[k * 4 + 3] = 255
  }
  const params = new Float32Array(count * P)
  for (let i = 0; i < count; i++) {
    const o = i * P
    params[o + X] = 0.15 + 0.7 * rand()
    params[o + Y] = (0.15 + 0.7 * rand()) * (height / width)
    params[o + LOG_SX] = Math.log(0.1 + 0.15 * rand())
    params[o + LOG_SY] = Math.log(0.1 + 0.15 * rand())
    params[o + THETA] = (rand() - 0.5) * Math.PI
    params[o + R] = 0.1 + 0.8 * rand()
    params[o + G] = 0.1 + 0.8 * rand()
    params[o + B] = 0.1 + 0.8 * rand()
    params[o + A_RAW] = 2 * rand() - 1
  }
  const scene: Scene = {width, height, bg: [0.5, 0.4, 0.3], eps: EPS, qMax}
  return {scene, count, params, target, rgba}
}
