import {memo, useEffect, useMemo, useRef} from 'react'
import {CODE_LEGEND, encodeLine} from '../code/blobCode'
import type {LoopStats} from '../fitter/runLoop'

type Props = {
  stats: LoopStats | null
  newFrom: number // blobs with this index or higher were added since the previous readback
  hovered: number | null // blob index whose line is hovered or focused
  onHover: (index: number | null) => void
}

// Positions where two code lines of the same shape differ, leaving out changes that stay within the last
// hex digit of a field: that digit wobbles at almost every readback, and flashing it everywhere would
// be noise (and measurably slows the fit down by repainting hundreds of characters).
export function changedPositions(before: string | undefined, after: string): Set<number> {
  const changed = new Set<number>()
  if (before === undefined || before.length !== after.length) return changed
  let start = 0
  for (let end = 0; end <= after.length; end++) {
    if (end < after.length && after[end] !== ' ') continue
    // Field [start, end): flash its changed characters only if more than the last digit changed.
    const moved = []
    for (let k = start; k < end; k++) if (before[k] !== after[k]) moved.push(k)
    if (moved.some((k) => k < end - 1)) for (const k of moved) changed.add(k)
    start = end + 1
  }
  return changed
}

// Right column: the real compact code of a few current blobs, refreshed with the loss readback.
// Lines of blobs that growth added since the previous readback are marked "+"; characters flash only
// where the blob's value really changed since the previous readback (see changedPositions).
// Re-renders only when its readback, the hovered line or the new-line marker changes, not on every step.
export const CodePanel = memo(function CodePanel({stats, newFrom, hovered, onHover}: Props) {
  // The lines shown at the previous readback, by blob index (updated after each readback is shown).
  const previous = useRef(new Map<number, string>())
  // Worked out once per readback, so a flash lasts until the next readback, not the next render.
  const lines = useMemo(
    () =>
      (stats?.blobIndices ?? []).map((index, k) => {
        const line = encodeLine(stats!.blobs, k)
        const isNew = index >= newFrom
        return {index, line, isNew, changed: isNew ? new Set<number>() : changedPositions(previous.current.get(index), line)}
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stats],
  )
  useEffect(() => {
    previous.current = new Map(lines.map(({index, line}) => [index, line]))
  }, [lines])

  return (
    <section className="code-panel">
      <p className="accent-label">THE CODE OF YOUR PICTURE</p>
      <p className="code-intro">
        Every blob is one line of hex: where it sits, how big it is, which way it turns, its colour and how opaque
        it is.
      </p>
      <p className="code-legend" aria-hidden="true">
        <span className="code-gutter"> blob</span> {CODE_LEGEND}
      </p>
      <p className="code-key">x y position · w h size · ang angle · colour · op opacity</p>
      <ol className="code-lines" aria-label="A sample of the code, one blob per line">
        {lines.map(({index, line, isNew, changed}) => {
          const colour = line.slice(-9, -3)
          return (
            <li
              key={index}
              className={`code-line${isNew ? ' new' : ''}${hovered === index ? ' hovered' : ''}`}
              tabIndex={0}
              aria-label={`Blob ${index + 1}: ${line}`}
              onMouseEnter={() => onHover(index)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(index)}
              onBlur={() => onHover(null)}
            >
              <span className="code-gutter">
                {isNew ? '+' : ' '}
                {String(index + 1).padStart(4, ' ')}
              </span>{' '}
              {[...line].map((char, k) =>
                changed.has(k) ? (
                  <span key={`${stats!.step}-${k}`} className="flash">
                    {char}
                  </span>
                ) : (
                  char
                ),
              )}{' '}
              <span className="code-swatch" style={{background: `#${colour}`}} />
            </li>
          )
        })}
      </ol>
    </section>
  )
})
