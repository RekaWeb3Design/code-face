import {memo} from 'react'
// A thin line of the mistake over the steps so far, from the real loss readbacks, on a log scale.
export type MistakePoint = {step: number; loss: number}

const WIDTH = 600
const HEIGHT = 56
const PAD = 3

// Points of the polyline in the chart's own units (x by step, y by log10 of the mistake).
export function chartPoints(points: readonly MistakePoint[]): string {
  const valid = points.filter((p) => Number.isFinite(p.loss) && p.loss > 0)
  if (valid.length < 2) return ''
  const maxStep = Math.max(1, valid[valid.length - 1].step)
  const logs = valid.map((p) => Math.log10(p.loss))
  const top = Math.max(...logs)
  const bottom = Math.min(...logs)
  const span = Math.max(top - bottom, 1e-6)
  return valid
    .map((p, i) => {
      const x = PAD + (p.step / maxStep) * (WIDTH - 2 * PAD)
      const y = PAD + ((top - logs[i]) / span) * (HEIGHT - 2 * PAD)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

export const MistakeChart = memo(function MistakeChart({points}: {points: readonly MistakePoint[]}) {
  const line = chartPoints(points)
  const first = points.find((p) => Number.isFinite(p.loss))
  const last = points[points.length - 1]
  const label =
    first && last
      ? `Mistake over the steps so far, from ${(first.loss * 100).toFixed(2)}% to ${(last.loss * 100).toFixed(2)}%.`
      : 'Mistake over the steps so far.'
  return (
    <figure className="chart">
      <figcaption className="label">MISTAKE OVER TIME · LOG SCALE</figcaption>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={label}>
        <line x1="0" y1={HEIGHT - 0.5} x2={WIDTH} y2={HEIGHT - 0.5} className="chart-axis" />
        {line && <polyline points={line} className="chart-line" vectorEffect="non-scaling-stroke" />}
      </svg>
    </figure>
  )
})
