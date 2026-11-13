import {describe, expect, it} from 'vitest'
import {changedPositions} from './CodePanel'

describe('changedPositions', () => {
  it('marks the characters of a field whose value changed beyond its last digit', () => {
    // x 1e7b -> 1e8c: two digits changed, both flash; y unchanged; w 8a9 -> 8b9 flashes its middle digit.
    expect([...changedPositions('1e7b 5dc0 8a9', '1e8c 5dc0 8b9')]).toEqual([2, 3, 11])
  })

  it('leaves out a change confined to the last digit of a field', () => {
    expect(changedPositions('1e7b 5dc0 8a9', '1e7c 5dc1 8a8').size).toBe(0)
  })

  it('marks nothing for an unchanged line, a line not seen before, or a different shape', () => {
    expect(changedPositions('abcd', 'abcd').size).toBe(0)
    expect(changedPositions(undefined, 'abcd').size).toBe(0)
    expect(changedPositions('abc', 'abcd').size).toBe(0)
  })
})
