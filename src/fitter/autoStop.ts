export type StopReason = 'converged' | 'max-steps'

// Decides when a fit is done, from the loss readbacks.
//   converged: the mean loss over the last `windowSteps` steps is less than `minImprovement`
//              (relative) below the mean over the `windowSteps` steps before that.
//   max-steps: `maxSteps` steps were taken since the start or the last restart().
// restart(step) forgets the history: call it when growth finishes and when the user resumes.
export function createAutoStop(windowSteps: number, minImprovement: number, maxSteps: number) {
  let readings: {step: number; loss: number}[] = []
  let from = 0
  const mean = (values: {loss: number}[]) => values.reduce((sum, r) => sum + r.loss, 0) / values.length
  return {
    restart(step: number) {
      readings = []
      from = step
    },
    add(step: number, loss: number): StopReason | null {
      if (step - from >= maxSteps) return 'max-steps'
      readings.push({step, loss})
      readings = readings.filter((r) => r.step > step - 2 * windowSteps)
      if (step - from < 2 * windowSteps) return null
      const recent = readings.filter((r) => r.step > step - windowSteps)
      const before = readings.filter((r) => r.step <= step - windowSteps)
      if (recent.length === 0 || before.length === 0) return null
      return (mean(before) - mean(recent)) / mean(before) < minImprovement ? 'converged' : null
    },
  }
}
