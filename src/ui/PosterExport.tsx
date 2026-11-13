import {useEffect, useMemo, useRef, useState} from 'react'
import {PosterCancelled, type PosterOptions} from '../poster/drawPoster'
import {loadPosterFont} from '../poster/font'
import {
  FRAMES,
  framePixels,
  maxBlobsForPt,
  MIN_READABLE_PT,
  posterLayout,
  type FrameId,
  type Orientation,
} from '../poster/layout'
import {saveBlob} from './saveText'

type Props = {
  count: number // blob lines the poster will have
  header: string[] // the code file's header lines, exactly
  disabled: boolean
  // Makes the poster file; may pause the fit first. Rejects with PosterCancelled when cancelled.
  make: (
    options: PosterOptions,
    onProgress: (fraction: number) => void,
    isCancelled: () => boolean,
  ) => Promise<{blob: Blob; name: string}>
}

type Status =
  | {kind: 'idle'}
  | {kind: 'working'; progress: number}
  | {kind: 'saved'; name: string; bytes: number; seconds: number}
  | {kind: 'cancelled'}
  | {kind: 'failed'; message: string}

const n = (value: number) => value.toLocaleString('en-US')

// "Download code poster": the code file drawn as an image.
export function PosterExport({count, header, disabled, make}: Props) {
  const [options, setOptions] = useState<PosterOptions>({
    frame: 'a4',
    orientation: 'portrait',
    style: 'tinted',
    background: 'dark',
    format: 'svg',
  })
  const [charAspect, setCharAspect] = useState<number | null>(null)
  const [status, setStatus] = useState<Status>({kind: 'idle'})
  const cancelled = useRef(false)

  useEffect(() => {
    loadPosterFont().then(
      (font) => setCharAspect(font.charAspect),
      () => setStatus({kind: 'failed', message: 'The poster font could not be loaded, so no poster can be made.'}),
    )
  }, [])

  const size = framePixels(options.frame, options.orientation)
  const [a, b] = FRAMES[options.frame].mm
  const mm = options.orientation === 'portrait' ? [a, b] : [b, a]
  const shape = {
    ...size,
    headerLines: header.length,
    headerChars: Math.max(...header.map((line) => line.length)),
    blobChars: 31,
    charAspect: charAspect ?? 0.6,
  }
  const fontPt = useMemo(
    () => (charAspect ? posterLayout({...shape, blobLines: count}).fontPt : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [charAspect, count, options.frame, options.orientation, shape.headerChars],
  )
  const readableUpTo = useMemo(
    () => (fontPt !== null && fontPt < MIN_READABLE_PT ? maxBlobsForPt(shape, MIN_READABLE_PT) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fontPt],
  )

  const set = <K extends keyof PosterOptions>(key: K, value: PosterOptions[K]) =>
    setOptions((current) => ({...current, [key]: value}))

  async function run() {
    cancelled.current = false
    setStatus({kind: 'working', progress: 0})
    const started = performance.now()
    try {
      const {blob, name} = await make(
        options,
        (progress) => setStatus({kind: 'working', progress}),
        () => cancelled.current,
      )
      saveBlob(name, blob)
      setStatus({kind: 'saved', name, bytes: blob.size, seconds: (performance.now() - started) / 1000})
    } catch (reason) {
      if (reason instanceof PosterCancelled) {
        setStatus({kind: 'cancelled'})
        return
      }
      const why = reason instanceof Error ? reason.message : String(reason)
      setStatus({
        kind: 'failed',
        message:
          options.format === 'svg'
            ? `Could not make the ${FRAMES[options.frame].label} ${options.orientation} SVG: ${why}. Nothing was saved.`
            : `Could not make the ${FRAMES[options.frame].label} ${options.orientation} image ` +
              `(${n(size.width)} × ${n(size.height)} px): ${why}. Nothing was saved. Try a smaller frame or SVG.`,
      })
    }
  }

  const working = status.kind === 'working'
  return (
    <details className="poster">
      <summary className="primary-summary">Download code poster</summary>
      <p className="poster-intro">
        The whole code file, every blob line, for print:{' '}
        {options.format === 'svg' ? 'vector text that stays sharp at any size.' : 'an image at 300 dpi.'}
      </p>
      <label>
        Frame
        <select value={options.frame} disabled={working} onChange={(e) => set('frame', e.target.value as FrameId)}>
          {(Object.keys(FRAMES) as FrameId[]).map((frame) => (
            <option key={frame} value={frame}>
              {FRAMES[frame].label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Orientation
        <select
          value={options.orientation}
          disabled={working}
          onChange={(e) => set('orientation', e.target.value as Orientation)}
        >
          <option value="portrait">portrait</option>
          <option value="landscape">landscape</option>
        </select>
      </label>
      <label>
        Style
        <select
          value={options.style}
          disabled={working}
          onChange={(e) => set('style', e.target.value as PosterOptions['style'])}
        >
          <option value="tinted">tinted by the picture</option>
          <option value="plain">plain</option>
        </select>
      </label>
      <label>
        Background
        <select
          value={options.background}
          disabled={working}
          onChange={(e) => set('background', e.target.value as PosterOptions['background'])}
        >
          <option value="dark">dark</option>
          <option value="paper">paper</option>
        </select>
      </label>
      <label>
        Format
        <select
          value={options.format}
          disabled={working}
          onChange={(e) => set('format', e.target.value as PosterOptions['format'])}
        >
          <option value="svg">SVG (vector)</option>
          <option value="png">PNG</option>
          <option value="jpeg">JPEG</option>
        </select>
      </label>
      <p className="poster-size">
        {options.format === 'svg' ? `${mm[0]} × ${mm[1]} mm` : `${n(size.width)} × ${n(size.height)} px`} ·{' '}
        {n(count)} lines of code · type{' '}
        {fontPt === null ? '…' : `${fontPt.toFixed(1)} pt`}
      </p>
      {readableUpTo !== null && (
        <p className="poster-warning">
          Below {MIN_READABLE_PT} pt the code reads as texture rather than text.{' '}
          {readableUpTo > 0
            ? `With ${n(readableUpTo)} blobs or fewer it would be ${MIN_READABLE_PT} pt or larger on this frame.`
            : 'Try a larger frame.'}
        </p>
      )}
      {working ? (
        <div className="poster-progress">
          <progress value={status.progress} max={1} aria-label="Drawing the poster" />
          <span>{Math.round(status.progress * 100)}%</span>
          <button onClick={() => (cancelled.current = true)}>Cancel</button>
        </div>
      ) : (
        <button onClick={run} disabled={disabled || charAspect === null}>
          Download poster
        </button>
      )}
      <p className="poster-status">
        {status.kind === 'saved' &&
          `Saved ${status.name} (${(status.bytes / 1e6).toFixed(1)} MB) in ${status.seconds.toFixed(1)} s.`}
        {status.kind === 'cancelled' && 'Cancelled; nothing was saved.'}
      </p>
      {status.kind === 'failed' && (
        <p className="error" role="alert">
          {status.message}
        </p>
      )}
    </details>
  )
}
