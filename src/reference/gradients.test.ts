import {describe, expect, it} from 'vitest'
import {A_RAW, P, PARAM_NAMES, Q_MAX, R} from '../fitter/params'
import {lossAndGradients} from './gradients'
import {tinyCase} from './tinyCase'

// Central finite differences in float64.
// Relative error = |analytic - fd| / max(|analytic|, |fd|, FLOOR), must stay below REL_TOL.
const H = 1e-6
const REL_TOL = 1e-5
const FLOOR = 1e-7

function check(qMax: number, paramFrom: number, paramTo: number) {
  const {scene, count, params, target} = tinyCase(qMax)
  const p = Float64Array.from(params)
  const {grads} = lossAndGradients(p, count, scene, target)
  let worst = 0
  let nonZero = 0
  for (let i = 0; i < count; i++) {
    for (let k = paramFrom; k <= paramTo; k++) {
      const j = i * P + k
      const saved = p[j]
      p[j] = saved + H
      const up = lossAndGradients(p, count, scene, target).loss
      p[j] = saved - H
      const down = lossAndGradients(p, count, scene, target).loss
      p[j] = saved
      const fd = (up - down) / (2 * H)
      const rel = Math.abs(grads[j] - fd) / Math.max(Math.abs(grads[j]), Math.abs(fd), FLOOR)
      if (Math.abs(fd) > 1e-4) nonZero++
      worst = Math.max(worst, rel)
      expect(rel, `blob ${i} ${PARAM_NAMES[k]}: analytic ${grads[j]} vs fd ${fd}`).toBeLessThan(REL_TOL)
    }
  }
  return {worst, nonZero, total: count * (paramTo - paramFrom + 1)}
}

describe('analytic gradients vs finite differences (16x12 image, 5 blobs, seed 7)', () => {
  it('all 9 params, exact formula (no footprint cut-off)', () => {
    const {worst, nonZero, total} = check(Infinity, 0, P - 1)
    console.log(`no cut-off: worst relative error ${worst.toExponential(2)}, ${nonZero}/${total} gradients above 1e-4`)
    // Guard against a vacuous pass where every gradient is ~0.
    expect(nonZero).toBeGreaterThan(total * 0.8)
  })

  it('colour and opacity params with the 3-sigma cut-off (the footprint does not depend on them)', () => {
    const {worst} = check(Q_MAX, R, A_RAW)
    console.log(`with cut-off, r/g/b/a_raw: worst relative error ${worst.toExponential(2)}`)
  })
})
