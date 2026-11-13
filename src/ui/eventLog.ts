import type {StopReason} from '../fitter/autoStop'
import type {InitMode} from '../fitter/init'

// Real events of a fit, in the order they happened.
export type FitEvent =
  | {kind: 'start'; mode: InitMode; active: number}
  | {kind: 'grow'; step: number; added: number; total: number}
  | {kind: 'milestone'; step: number; below: number; loss: number} // loss fell below `below` (fractions)
  | {kind: 'refining'; step: number; total: number}
  | {kind: 'done'; step: number; reason: StopReason; loss: number}
  | {kind: 'resumed'; step: number}
  | {kind: 'opened'; count: number; seed: number; name: string}

// Mistake levels worth an entry, as fractions.
export const MILESTONES = [0.1, 0.05, 0.01, 0.005]

// The lowest milestone crossed between two loss readings, or null.
export function milestoneCrossed(previous: number, next: number): number | null {
  const crossed = MILESTONES.filter((level) => previous >= level && next < level)
  return crossed.length > 0 ? Math.min(...crossed) : null
}

// One row of the timeline: a tag (the step, or "file") and a short text.
export type LogEntry = {tag: string; text: string}

const n = (value: number) => value.toLocaleString('en-US')
const pct = (fraction: number) => `${+(fraction * 100).toFixed(2)}%`

// Turns the oldest pending events into one timeline row. Consecutive growth events are merged into
// a single row, tagged with the step of the last one. Returns the row and the events still pending.
// "->", not an arrow character: the bundled mono font's Latin subset has no U+2192, so an arrow would
// come from a fallback font.
export function nextEntry(pending: readonly FitEvent[]): {entry: LogEntry; rest: FitEvent[]} | null {
  const first = pending[0]
  if (!first) return null
  if (first.kind === 'grow') {
    let last = 0
    while (pending[last + 1]?.kind === 'grow') last++
    const grows = pending.slice(0, last + 1) as Extract<FitEvent, {kind: 'grow'}>[]
    const added = grows.reduce((sum, event) => sum + event.added, 0)
    const final = grows[grows.length - 1]
    return {entry: {tag: n(final.step), text: `+${n(added)} blobs -> ${n(final.total)}`}, rest: pending.slice(last + 1)}
  }
  return {entry: describe(first), rest: pending.slice(1)}
}

function describe(event: Exclude<FitEvent, {kind: 'grow'}>): LogEntry {
  switch (event.kind) {
    case 'start':
      if (event.mode === 'painting') return {tag: '0', text: `${n(event.active)} big blobs, average colour`}
      if (event.mode === 'blank') return {tag: '0', text: `${n(event.active)} blobs, one flat colour`}
      return {tag: '0', text: `${n(event.active)} blobs, photo colours`}
    case 'milestone':
      return {tag: n(event.step), text: `mistake under ${pct(event.below)}`}
    case 'refining':
      return {tag: n(event.step), text: `all ${n(event.total)} blobs in place`}
    case 'done':
      return event.reason === 'converged'
        ? {tag: n(event.step), text: `done · mistake ${pct(event.loss)}`}
        : {tag: n(event.step), text: `step limit · mistake ${pct(event.loss)}`}
    case 'resumed':
      return {tag: n(event.step), text: 'resumed'}
    case 'opened':
      return {tag: 'file', text: `${n(event.count)} blobs · seed ${event.seed}`}
  }
}
