import {describe, expect, it} from 'vitest'
import {P, PARAM_NAMES} from '../fitter/params'
import {gatherGrid, jitter, lossAndGradients, type Sampling} from './gradients'
import {readBlob} from './render'
import {BIG_BLOB, blobGradError, SUBSAMPLE_MAX_SIDE, SUBSAMPLE_STRIDE, subsampleCase} from './subsampleCase'

// Errors are on blob 0 (the big one): |a - b| / |full| per param, and the max over its 9 params.
const EXACT_TOL = 1e-9 // box walk at stride 1, and the mean over all grid offsets, vs the full gradient
// One jittered grid is a noisy but unbiased estimate, so it gets no pass threshold of its own; its
// error is printed. What must hold is that averaging shrinks the error: independent draws would
// shrink it sqrt(MEAN_STEPS) = 16 times, the test demands at least SHRINK times.
const MEAN_STEPS = 256
const SHRINK = 4

const sorted = (values: number[]) => [...values].sort((a, b) => a - b)
const median = (values: number[]) => sorted(values)[values.length >> 1]

describe('subsampled gather (64x48 image, blob 0 covers it, maxSide 16 -> 4x3 grid)', () => {
  const {scene, count, params, target} = subsampleCase()
  const p = Float64Array.from(params)
  const full = lossAndGradients(p, count, scene, target).grads
  const [sx, sy] = SUBSAMPLE_STRIDE
  const fixed = (ox: number, oy: number): Sampling => ({
    maxSide: SUBSAMPLE_MAX_SIDE,
    offset: (blob, stride) => (blob === BIG_BLOB ? [ox % stride[0], oy % stride[1]] : [0, 0]),
  })

  it('only the big blob is subsampled, and none of its full gradients is near zero', () => {
    for (let i = 0; i < count; i++) {
      const grid = gatherGrid(readBlob(p, i), i, scene, fixed(0, 0))
      expect(grid?.stride).toEqual(i === BIG_BLOB ? SUBSAMPLE_STRIDE : [1, 1])
    }
    const big = Array.from(full.slice(BIG_BLOB * P, BIG_BLOB * P + P), Math.abs)
    console.log(`full gradient of blob 0: ${big.map((g) => g.toExponential(2)).join(' ')}`)
    // Guard: a relative error against a vanishing gradient would mean nothing.
    for (const g of big) expect(g).toBeGreaterThan(Math.max(...big) * 1e-3)
  })

  it('walking the bounding box at stride 1 gives the full gradient', () => {
    const boxed = lossAndGradients(p, count, scene, target, {maxSide: 1e6, offset: () => [0, 0]}).grads
    for (let i = 0; i < count; i++) expect(blobGradError(boxed, full, i).err).toBeLessThan(EXACT_TOL)
  })

  it('the mean over all 12 grid offsets equals the full gradient (unbiased weighting)', () => {
    const mean = new Float64Array(count * P)
    for (let oy = 0; oy < sy; oy++) {
      for (let ox = 0; ox < sx; ox++) {
        const g = lossAndGradients(p, count, scene, target, fixed(ox, oy)).grads
        for (let j = 0; j < mean.length; j++) mean[j] += g[j] / (sx * sy)
      }
    }
    const {err, param} = blobGradError(mean, full, BIG_BLOB)
    console.log(`mean over all offsets vs full: ${err.toExponential(2)} (${PARAM_NAMES[param]}), tolerance ${EXACT_TOL}`)
    expect(err).toBeLessThan(EXACT_TOL)
    // The small blobs are read at stride 1, so they match too.
    for (let i = 1; i < count; i++) expect(blobGradError(mean, full, i).err).toBeLessThan(EXACT_TOL)
  })

  it('single jittered grids scatter around the full gradient and their mean converges', () => {
    const worst: number[] = []
    const perParam: number[][] = PARAM_NAMES.map(() => [])
    const offsets = new Set<string>()
    const mean = new Float64Array(count * P)
    for (let step = 1; step <= MEAN_STEPS; step++) {
      const offset = jitter(step)
      offsets.add(offset(BIG_BLOB, SUBSAMPLE_STRIDE).join(','))
      const g = lossAndGradients(p, count, scene, target, {maxSide: SUBSAMPLE_MAX_SIDE, offset}).grads
      worst.push(blobGradError(g, full, BIG_BLOB).err)
      for (let k = 0; k < P; k++) {
        const j = BIG_BLOB * P + k
        perParam[k].push(Math.abs(g[j] - full[j]) / Math.abs(full[j]))
      }
      for (let j = 0; j < mean.length; j++) mean[j] += g[j] / MEAN_STEPS
    }
    const singleMedian = median(worst)
    const meanErr = blobGradError(mean, full, BIG_BLOB)
    console.log(
      [
        `single jittered grid vs full over ${MEAN_STEPS} steps, worst param per step: ` +
          `median ${singleMedian.toExponential(2)}, max ${Math.max(...worst).toExponential(2)}`,
        `  median per param: ${PARAM_NAMES.map((name, k) => `${name} ${median(perParam[k]).toExponential(1)}`).join(', ')}`,
        `  mean of ${MEAN_STEPS} grids vs full: ${meanErr.err.toExponential(2)} on ${PARAM_NAMES[meanErr.param]}, ` +
          `must be below median / ${SHRINK} = ${(singleMedian / SHRINK).toExponential(2)}`,
        `  ${offsets.size}/12 offsets used`,
      ].join('\n'),
    )
    expect(offsets.size).toBe(sx * sy) // the hash reaches every offset
    expect(meanErr.err).toBeLessThan(singleMedian / SHRINK)
  })
})
