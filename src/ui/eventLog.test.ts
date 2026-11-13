import {describe, expect, it} from 'vitest'
import {milestoneCrossed, nextEntry, type FitEvent, type LogEntry} from './eventLog'

const drain = (events: FitEvent[]) => {
  const entries: LogEntry[] = []
  let pending = events
  for (let next = nextEntry(pending); next; next = nextEntry(pending)) {
    entries.push(next.entry)
    pending = next.rest
  }
  return entries
}

describe('event log', () => {
  it('writes one short row per event with its real numbers', () => {
    expect(
      drain([
        {kind: 'start', mode: 'painting', active: 32},
        {kind: 'milestone', step: 230, below: 0.05, loss: 0.0487},
        {kind: 'refining', step: 477, total: 8000},
        {kind: 'done', step: 4083, reason: 'converged', loss: 0.0031},
        {kind: 'resumed', step: 4083},
        {kind: 'opened', count: 8000, seed: 1, name: 'code-face-1-8000.txt'},
      ]),
    ).toEqual([
      {tag: '0', text: '32 big blobs, average colour'},
      {tag: '230', text: 'mistake under 5%'},
      {tag: '477', text: 'all 8,000 blobs in place'},
      {tag: '4,083', text: 'done · mistake 0.31%'},
      {tag: '4,083', text: 'resumed'},
      {tag: 'file', text: '8,000 blobs · seed 1'},
    ])
  })

  it('merges consecutive growth events into one row, and only consecutive ones', () => {
    expect(
      drain([
        {kind: 'grow', step: 101, added: 40, total: 391},
        {kind: 'grow', step: 117, added: 40, total: 431},
        {kind: 'milestone', step: 120, below: 0.05, loss: 0.049},
        {kind: 'grow', step: 133, added: 81, total: 512},
      ]),
    ).toEqual([
      {tag: '117', text: '+80 blobs -> 431'},
      {tag: '120', text: 'mistake under 5%'},
      {tag: '133', text: '+81 blobs -> 512'},
    ])
  })

  it('reports only the lowest milestone crossed, and only on a crossing', () => {
    expect(milestoneCrossed(0.2, 0.04)).toBe(0.05)
    expect(milestoneCrossed(0.011, 0.0099)).toBe(0.01)
    expect(milestoneCrossed(0.04, 0.03)).toBeNull()
    expect(milestoneCrossed(0.004, 0.006)).toBeNull()
  })

  it('keeps every row short and never calls the picture AI-generated', () => {
    const entries = drain([
      {kind: 'start', mode: 'painting', active: 32},
      {kind: 'start', mode: 'blank', active: 8000},
      {kind: 'start', mode: 'photo', active: 8000},
      {kind: 'grow', step: 5, added: 6, total: 38},
      {kind: 'milestone', step: 9, below: 0.1, loss: 0.097},
      {kind: 'refining', step: 477, total: 8000},
      {kind: 'done', step: 8000, reason: 'max-steps', loss: 0.003},
      {kind: 'resumed', step: 8000},
      {kind: 'opened', count: 50000, seed: 123456, name: 'a.txt'},
    ])
    for (const {tag, text} of entries) {
      expect(tag.length, tag).toBeLessThanOrEqual(6)
      expect(text.length, text).toBeLessThanOrEqual(32)
      expect(text).not.toMatch(/\bAI\b|artificial|generated/i)
    }
  })
})
