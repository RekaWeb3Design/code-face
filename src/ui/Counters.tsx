import {useTweened} from './motion'

type Props = {
  blobs: number // active
  target: number
  step: number | null // null for a picture opened from a file
  mistake: number | null // fraction; null when there is nothing to compare with
}

const n = (value: number) => Math.round(value).toLocaleString('en-US')

// Three large counters under the picture. The numbers ease towards new values.
export function Counters({blobs, target, step, mistake}: Props) {
  const shownBlobs = useTweened(blobs)
  const shownStep = useTweened(step ?? 0)
  const shownMistake = useTweened(mistake ?? Number.NaN)
  return (
    <dl className="counters">
      <div>
        <dt className="label">BLOBS</dt>
        <dd>
          <span className="big accent">{n(shownBlobs)}</span>
          {blobs < target && <span className="of"> OF {n(target)}</span>}
        </dd>
      </div>
      <div>
        <dt className="label">STEP</dt>
        <dd>
          <span className="big">{step === null ? '–' : n(shownStep)}</span>
        </dd>
      </div>
      <div>
        <dt className="label">MISTAKE</dt>
        <dd>
          <span className="big">{mistake === null ? '–' : `${(shownMistake * 100).toFixed(2)}%`}</span>
        </dd>
      </div>
    </dl>
  )
}
