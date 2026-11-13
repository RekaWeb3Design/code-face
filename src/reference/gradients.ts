import {A_RAW, LOG_SX, LOG_SY, P, R, THETA, X, Y} from '../fitter/params'
import {blobWeightGrad, type Blob} from './blend'
import {forward, l1Loss, pixelCentre, readBlob, type Scene} from './render'

// How the gather of one blob walks its pixels. Mirrors GATHER_WGSL in src/fitter/shaders.ts.
export type Sampling = {
  maxSide: number // at most maxSide x maxSide pixels are read per blob
  // Grid offset for one blob, 0 <= offset < stride on each axis.
  offset: (blobIndex: number, stride: [number, number]) => [number, number]
}

export type Grid = {
  first: [number, number] // first pixel read
  last: [number, number] // last pixel of the clipped bounding box
  stride: [number, number]
}

// Same hash as GATHER_WGSL (32-bit PCG).
export function hash(x: number): number {
  const s = (Math.imul(x, 747796405) + 2891336453) >>> 0
  const w = Math.imul((s >>> ((s >>> 28) + 4)) ^ s, 277803737) >>> 0
  return ((w >>> 22) ^ w) >>> 0
}

// The grid offset the GPU picks for a blob at a given step.
export const jitter =
  (step: number): Sampling['offset'] =>
  (blobIndex, stride) => {
    const h = hash((blobIndex ^ hash(step)) >>> 0)
    return [h % stride[0], hash(h) % stride[1]]
  }

// Bounding box of the blob's footprint, clipped to the image, and the stride that keeps the
// number of pixels read within maxSide x maxSide. Returns null when the box is empty.
export function gatherGrid(blob: Blob, blobIndex: number, scene: Scene, sampling: Sampling): Grid | null {
  const {width, height, qMax} = scene
  const longSide = Math.max(width, height)
  const reach = Math.sqrt(qMax)
  const ext = [
    reach * Math.hypot(blob.cs * blob.sx, blob.sn * blob.sy),
    reach * Math.hypot(blob.sn * blob.sx, blob.cs * blob.sy),
  ]
  const mu = [blob.x, blob.y]
  const size = [width, height]
  const lo = [0, 0]
  const last: [number, number] = [0, 0]
  const stride: [number, number] = [1, 1]
  for (let axis = 0; axis < 2; axis++) {
    lo[axis] = Math.min(size[axis], Math.max(0, Math.ceil((mu[axis] - ext[axis]) * longSide - 0.5)))
    last[axis] = Math.min(size[axis] - 1, Math.max(-1, Math.floor((mu[axis] + ext[axis]) * longSide - 0.5)))
    if (last[axis] < lo[axis]) return null
    stride[axis] = Math.ceil((last[axis] - lo[axis] + 1) / sampling.maxSide)
  }
  const offset = sampling.offset(blobIndex, stride)
  return {first: [lo[0] + offset[0], lo[1] + offset[1]], last, stride}
}

// L1 loss and its analytic gradient with respect to all 9 raw params of every blob.
//   dL/dC      = sign(C - T) / (3 * pixels)
//   dC/dw_i    = (c_i - C) / (sum_w + eps)
//   dC/dc_i    = w_i / (sum_w + eps)
//   dw/dparam  = blobWeightGrad, and da/da_raw = a * (1 - a)
// Without `sampling` every blob reads every pixel: the exact gradient. With it, each blob reads
// the grid the GPU gather would read, and each sample counts for stride.x * stride.y pixels.
export function lossAndGradients(
  params: ArrayLike<number>,
  count: number,
  scene: Scene,
  target: ArrayLike<number>,
  sampling?: Sampling,
): {loss: number; grads: Float64Array} {
  const {width, height, eps, qMax} = scene
  const longSide = Math.max(width, height)
  const {sumW, color} = forward(params, count, scene)
  const scale = 1 / color.length
  const grads = new Float64Array(count * P)
  const wg = new Float64Array(7)
  const everyPixel: Grid = {first: [0, 0], last: [width - 1, height - 1], stride: [1, 1]}
  for (let i = 0; i < count; i++) {
    const blob = readBlob(params, i)
    const grid = sampling ? gatherGrid(blob, i, scene, sampling) : everyPixel
    if (!grid) continue
    const {first, last, stride} = grid
    const c = [blob.r, blob.g, blob.b]
    const o = i * P
    const sum = new Float64Array(P)
    for (let py = first[1]; py <= last[1]; py += stride[1]) {
      const dy = pixelCentre(py, longSide) - blob.y
      for (let px = first[0]; px <= last[0]; px += stride[0]) {
        blobWeightGrad(pixelCentre(px, longSide) - blob.x, dy, blob, qMax, wg)
        if (wg[6] === 0) continue
        const k = py * width + px
        const inv = 1 / (sumW[k] + eps)
        let dLdw = 0
        for (let ch = 0; ch < 3; ch++) {
          const dLdC = Math.sign(color[k * 3 + ch] - target[k * 3 + ch]) * scale
          dLdw += dLdC * (c[ch] - color[k * 3 + ch]) * inv
          sum[R + ch] += dLdC * wg[0] * inv // r, g, b are consecutive
        }
        sum[X] += dLdw * wg[1]
        sum[Y] += dLdw * wg[2]
        sum[LOG_SX] += dLdw * wg[3]
        sum[LOG_SY] += dLdw * wg[4]
        sum[THETA] += dLdw * wg[5]
        sum[A_RAW] += dLdw * wg[6]
      }
    }
    sum[A_RAW] *= blob.a * (1 - blob.a)
    const pixelsPerSample = stride[0] * stride[1]
    for (let k = 0; k < P; k++) grads[o + k] = sum[k] * pixelsPerSample
  }
  return {loss: l1Loss(color, target), grads}
}
