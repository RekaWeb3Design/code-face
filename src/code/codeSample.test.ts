import {describe, expect, it} from 'vitest'
import {createBlobPicker, SAMPLE_LINES} from './codeSample'

describe('createBlobPicker', () => {
  const pick = createBlobPicker(8000)

  it('shows every blob while there are fewer than the panel holds', () => {
    expect(pick(32)).toEqual(Array.from({length: 32}, (_, i) => i))
  })

  it('shows the newest blobs while growing', () => {
    expect(pick(512)).toEqual(Array.from({length: SAMPLE_LINES}, (_, k) => 512 - SAMPLE_LINES + k))
  })

  it('shows a fixed, evenly spaced sample of all blobs once growth is complete', () => {
    const sample = pick(8000)
    expect(sample.length).toBe(SAMPLE_LINES)
    expect(pick(8000)).toEqual(sample)
    expect(sample[0]).toBeGreaterThanOrEqual(0)
    expect(sample.at(-1)).toBeLessThan(8000)
    for (let k = 1; k < sample.length; k++) expect(sample[k] - sample[k - 1]).toBeGreaterThan(200)
  })
})
