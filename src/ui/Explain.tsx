import {memo} from 'react'
import type {Caption} from './caption'
import type {LogEntry} from './eventLog'

type Props = {
  caption: Caption
  live: boolean // false before a fit: the intro text is not announced
  entries: (LogEntry & {id: number})[] // newest first
}

// Left column: what is happening now (the phase caption, the only polite live region) and a compact
// timeline of what happened so far.
export const Explain = memo(function Explain({caption, live, entries}: Props) {
  return (
    <section className="explain">
      <p className="accent-label">WHAT IS HAPPENING</p>
      <div className="caption" aria-live={live ? 'polite' : undefined} aria-atomic="true">
        <p className="headline">{caption.headline}</p>
        <p className="support">{caption.support}</p>
      </div>
      {entries.length > 0 && (
        <ol className="timeline" role="log" aria-live="off" aria-label="What happened so far">
          {entries.map((entry) => (
            <li key={entry.id}>
              <span className="tag">
                <span className="visually-hidden">{entry.tag === 'file' ? '' : 'step '}</span>
                {entry.tag}
              </span>
              <span className="text">{entry.text}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
})
