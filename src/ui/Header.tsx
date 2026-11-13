import type {FitPhase} from './caption'

const STEPS: {phase: FitPhase; number: string; label: string}[] = [
  {phase: 'start', number: '01', label: 'START'},
  {phase: 'growing', number: '02', label: 'GROWING'},
  {phase: 'refining', number: '03', label: 'REFINING'},
  {phase: 'done', number: '04', label: 'DONE'},
]

// Wordmark, tagline and the four-step phase indicator. `phase` is null before a fit starts.
export function Header({phase}: {phase: FitPhase | null}) {
  return (
    <header className="top">
      <div className="brand">
        <p className="wordmark">
          <a href="/" title="Code Face home page">
            CODE FACE
          </a>
        </p>
        <p className="tagline">Your photo, re-painted blob by blob. It never leaves this device.</p>
      </div>
      {phase === 'file' ? (
        <p className="phase-file">FROM A CODE FILE</p>
      ) : (
        <ol className="phases" aria-label="Phase">
          {STEPS.map((step) => (
            <li key={step.phase} className={step.phase === phase ? 'current' : ''} aria-current={step.phase === phase ? 'step' : undefined}>
              <span className="phase-number">{step.number}</span> {step.label}
            </li>
          ))}
        </ol>
      )}
    </header>
  )
}
