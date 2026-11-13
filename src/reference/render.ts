import {A_RAW, B, G, LOG_SX, LOG_SY, P, R, THETA, X, Y} from '../fitter/params'
import {blobWeight, resolveColor, sigmoid, type Blob} from './blend'

export type Scene = {
  width: number
  height: number
  bg: [number, number, number]
  eps: number
  qMax: number
}

export type Accum = {
  sumWC: Float64Array // width*height*3
  sumW: Float64Array // width*height
  color: Float64Array // width*height*3, resolved
}

export function readBlob(params: ArrayLike<number>, i: number): Blob {
  const o = i * P
  return {
    x: params[o + X],
    y: params[o + Y],
    sx: Math.exp(params[o + LOG_SX]),
    sy: Math.exp(params[o + LOG_SY]),
    cs: Math.cos(params[o + THETA]),
    sn: Math.sin(params[o + THETA]),
    r: params[o + R],
    g: params[o + G],
    b: params[o + B],
    a: sigmoid(params[o + A_RAW]),
  }
}

// Pixel centre in long-side-normalized coordinates.
export const pixelCentre = (index: number, longSide: number) => (index + 0.5) / longSide

export function forward(params: ArrayLike<number>, count: number, scene: Scene): Accum {
  const {width, height, bg, eps, qMax} = scene
  const longSide = Math.max(width, height)
  const sumWC = new Float64Array(width * height * 3)
  const sumW = new Float64Array(width * height)
  for (let i = 0; i < count; i++) {
    const blob = readBlob(params, i)
    const c = [blob.r, blob.g, blob.b]
    for (let py = 0; py < height; py++) {
      const dy = pixelCentre(py, longSide) - blob.y
      for (let px = 0; px < width; px++) {
        const w = blobWeight(pixelCentre(px, longSide) - blob.x, dy, blob, qMax)
        const k = py * width + px
        sumW[k] += w
        for (let ch = 0; ch < 3; ch++) sumWC[k * 3 + ch] += w * c[ch]
      }
    }
  }
  const color = new Float64Array(width * height * 3)
  for (let k = 0; k < width * height; k++) {
    for (let ch = 0; ch < 3; ch++) color[k * 3 + ch] = resolveColor(sumWC[k * 3 + ch], sumW[k], bg[ch], eps)
  }
  return {sumWC, sumW, color}
}

// Mean absolute error over all pixels and channels. `target` is rgb in 0..1, width*height*3.
export function l1Loss(color: ArrayLike<number>, target: ArrayLike<number>): number {
  let sum = 0
  for (let k = 0; k < color.length; k++) sum += Math.abs(color[k] - target[k])
  return sum / color.length
}
