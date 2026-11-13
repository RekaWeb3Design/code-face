import {describe, expect, it} from 'vitest'
import {createAutoStop} from './autoStop'

// Window 250 steps, 0.5% minimum improvement per window, at most 8000 steps; a reading every 25 steps.
const run = (lossAt: (step: number) => number, from = 0, stop = createAutoStop(250, 0.005, 8000)) => {
  for (let step = from + 25; step <= from + 20000; step += 25) {
    const reason = stop.add(step, lossAt(step))
    if (reason) return {step, reason, stop}
  }
  return {step: -1, reason: null, stop}
}

describe('auto-stop rule', () => {
  it('does not stop while the loss still falls by more than 0.5% per 250 steps', () => {
    // 2% lower every 250 steps, for ever: only the step limit ends it.
    expect(run((step) => 0.5 * 0.98 ** (step / 250))).toMatchObject({step: 8000, reason: 'max-steps'})
  })

  it('stops as converged once the improvement per 250 steps drops below 0.5%', () => {
    // Falls fast until step 1000, then stays flat.
    const {step, reason} = run((s) => (s < 1000 ? 1 - s / 2000 : 0.5))
    expect(reason).toBe('converged')
    expect(step).toBeGreaterThan(1000)
    expect(step).toBeLessThanOrEqual(1500)
  })

  it('needs two full windows of readings before it can call a fit converged', () => {
    expect(run(() => 0.3).step).toBe(500)
  })

  it('after restart() it forgets the history and counts the step limit from there', () => {
    const first = run(() => 0.3)
    first.stop.restart(first.step)
    expect(first.stop.add(first.step + 25, 0.3)).toBeNull()
    expect(run(() => 0.3, first.step, first.stop).step).toBe(first.step + 500)
  })
})
