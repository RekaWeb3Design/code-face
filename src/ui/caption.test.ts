import {describe, expect, it} from 'vitest'
import {caption, fitPhase, type CaptionState} from './caption'

const painting: CaptionState = {mode: 'painting', startActive: 32, target: 8000, active: 32, done: null, file: null}
const sentences = (text: string) => text.split(/(?<=[.!?])\s+/).filter(Boolean).length

const all: CaptionState[] = [
  painting,
  {...painting, active: 512},
  {...painting, active: 8000},
  {...painting, mode: 'blank', startActive: 8000, active: 8000},
  {...painting, mode: 'photo', startActive: 8000, active: 8000},
  {...painting, active: 8000, done: {reason: 'converged', step: 2951, loss: 0.0031}},
  {...painting, active: 8000, done: {reason: 'max-steps', step: 8000, loss: 0.003}},
  {...painting, file: {count: 8000, seed: 1}},
]

describe('caption', () => {
  it('follows the phases of a painting fit with its real numbers', () => {
    expect(caption(painting).support).toMatch(/starts with 32 blobs/)
    expect(caption({...painting, active: 512}).support).toMatch(/from 32 up to 8,000/)
    expect(caption({...painting, active: 8000}).headline).toBe('All 8,000 blobs placed.')
    expect(caption({...painting, active: 8000, done: {reason: 'converged', step: 2951, loss: 0.0031}})).toEqual({
      headline: 'Done.',
      support: 'Re-painted from your photo with 8,000 blobs in 2,951 steps; the mistake stopped improving at 0.31%.',
    })
  })

  it('stays the same within a phase, so the live region only speaks on a phase change', () => {
    expect(caption({...painting, active: 64})).toEqual(caption({...painting, active: 6889}))
  })

  it('describes the other start modes, the step limit and an opened file', () => {
    expect(caption({...painting, mode: 'blank', startActive: 8000, active: 8000}).headline).toMatch(/one flat colour/)
    expect(caption({...painting, mode: 'photo', startActive: 8000, active: 8000}).headline).toMatch(/photo's colours/)
    expect(caption({...painting, active: 8000, done: {reason: 'max-steps', step: 8000, loss: 0.003}}).support).toMatch(
      /Resume keeps going/,
    )
    expect(caption({...painting, file: {count: 8000, seed: 1}}).support).toMatch(/^8,000 blobs, seed 1/)
  })

  it('is one short headline and one supporting sentence, never "AI-generated"', () => {
    for (const state of all) {
      const {headline, support} = caption(state)
      expect(sentences(headline), headline).toBe(1)
      expect(headline.length, headline).toBeLessThanOrEqual(40)
      expect(sentences(support), support).toBe(1)
      expect(`${headline} ${support}`).not.toMatch(/\bAI\b|artificial|generated/i)
    }
  })
})

describe('fitPhase', () => {
  it('maps a fit to the four header steps', () => {
    expect(fitPhase(painting)).toBe('start')
    expect(fitPhase({...painting, active: 512})).toBe('growing')
    expect(fitPhase({...painting, active: 8000})).toBe('refining')
    expect(fitPhase({...painting, active: 8000, done: {reason: 'converged', step: 10, loss: 0.01}})).toBe('done')
    expect(fitPhase({...painting, file: {count: 8000, seed: 1}})).toBe('file')
    expect(fitPhase({...painting, mode: 'blank', startActive: 8000, active: 8000})).toBe('refining')
  })
})
