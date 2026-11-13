import {describe, expect, it} from 'vitest'
import {P, Q_MAX} from '../fitter/params'
import {lossAndGradients} from './gradients'
import {forward} from './render'
import {tinyCase} from './tinyCase'

// Blobs beyond the active count are allocated but must not exist for the maths.
describe('inactive blobs (CPU reference)', () => {
  it('contribute exactly nothing to the image, the loss and the gradients', () => {
    const {scene, count, params, target} = tinyCase(Q_MAX)
    const padded = new Float32Array((count + 3) * P)
    padded.set(params)
    // Big, bright, opaque blobs in the middle of the image, and one that is not even a number.
    padded.set([0.5, 0.35, -1, -1, 0.3, 1, 0, 1, 4], count * P)
    padded.set([0.2, 0.2, -1, -1, 0, 0, 1, 0, 4], (count + 1) * P)
    padded.fill(NaN, (count + 2) * P)

    expect(Array.from(forward(padded, count, scene).color)).toEqual(Array.from(forward(params, count, scene).color))
    const a = lossAndGradients(params, count, scene, target)
    const b = lossAndGradients(padded, count, scene, target)
    expect(b.loss).toBe(a.loss)
    expect(Array.from(b.grads)).toEqual(Array.from(a.grads))

    // Sanity: the same blobs do change the image once they are active.
    const active = forward(padded, count + 2, scene).color
    expect(Array.from(active)).not.toEqual(Array.from(forward(params, count, scene).color))
  })
})
