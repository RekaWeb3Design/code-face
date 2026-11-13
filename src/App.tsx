import {useEffect, useMemo, useRef, useState, type DragEvent} from 'react'
import {blobCap, type BlobCap} from './fitter/blobCap'
import {defaultAccumFormat, requestDevice, type AccumFormat} from './fitter/device'
import {createFitter, type Fitter} from './fitter/fitter'
import {growthSchedule, sampleNewBlobs} from './fitter/growth'
import {initBlobs, meanColor, startCount, type InitMode, type Photo} from './fitter/init'
import {P} from './fitter/params'
import {runLoop, type Growth, type Loop, type LoopStats} from './fitter/runLoop'
import {runSelfTest, type SelfTestResult} from './fitter/selfTest'
import {defaultSettings, GROWTH_DOUBLING_RATIO, GROWTH_FIRST_DOUBLING_STEPS} from './fitter/settings'
import {decodeBlobs, encodeBlobs} from './code/blobCode'
import {createBlobPicker} from './code/codeSample'
import {caption, fitPhase, type CaptionState} from './ui/caption'
import {CodePanel} from './ui/CodePanel'
import {milestoneCrossed, nextEntry, type FitEvent, type LogEntry} from './ui/eventLog'
import {Explain} from './ui/Explain'
import {Counters} from './ui/Counters'
import {BlobOverlay, type GrowthOutlines} from './ui/BlobOverlay'
import {blobEllipse, spread} from './ui/blobGeometry'
import {prefersReducedMotion} from './ui/motion'
import {MistakeChart, type MistakePoint} from './ui/MistakeChart'
import {loadPhoto} from './ui/loadPhoto'
import {photoProblemMessage, problemAfterDecoding, problemBeforeDecoding} from './ui/photoErrors'
import {saveText} from './ui/saveText'
import type {PosterOptions} from './poster/drawPoster'
import {makePosterInWorker} from './poster/makePoster'
import {renderPicture, renderPictureAt} from './poster/picture'
import {PosterExport} from './ui/PosterExport'
import {DevTools} from './ui/DevTools'
import {Header} from './ui/Header'

const WORKING_SIZE = 512 // px, long side
const MIN_BLOBS = 1000
const MAX_BLOBS = 50000
// Developer tools (self-test, accumulation format, readouts, start modes) only with ?dev in the URL.
const DEV = new URLSearchParams(location.search).has('dev')
// Dev only, for the landing's demo files: ?dev&stages=32,128,512,2048,8000 saves the code file of one
// painting at each of these active blob counts (just before the next growth event, and when done).
const STAGES = DEV ? (new URLSearchParams(location.search).get('stages') ?? '').split(',').map(Number).filter((n) => n > 0) : []
// Dev only: ?dev&lowgpu behaves as if the GPU reported only WebGPU's minimum limits.
const SIMULATE_LOW_LIMITS = DEV && new URLSearchParams(location.search).has('lowgpu')
const LOG_EVERY_MS = 1500 // at most one new event-log entry this often
const LOG_KEEP = 40 // entries kept in the log
const CHART_KEEP = 600 // points kept for the mistake chart (halved when full)
const OUTLINES_PER_GROWTH = 60 // new blobs outlined at each growth event
const OUTLINE_MS = 1100
const SVG_PICTURE_SIDE = 2048 // px, long side of the picture embedded in a tinted SVG poster // how long a growth outline stays (it fades over about a second)

type Gpu = 'checking' | 'missing' | GPUDevice
// viewing: showing an opened code file; nothing is fitted.
type Phase = 'idle' | 'running' | 'paused' | 'done' | 'viewing'

// Growth time as m:ss.
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
const fileSize = (bytes: number) =>
  bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`

// A button that opens the photo chooser. The same file can be chosen again.
function PhotoPicker({label, onFile}: {label: string; onFile: (file: File | undefined) => void}) {
  return (
    <label className="button-like">
      <input
        type="file"
        accept="image/*"
        onChange={(event) => {
          onFile(event.target.files?.[0])
          event.target.value = ''
        }}
      />
      <span>{label}</span>
    </label>
  )
}

// Saves the first `count` blobs as stage-<count>.txt (dev tool for the landing's demo files).
function saveStage(fitter: Fitter, count: number, seed: number, photo: Photo, bg: [number, number, number]) {
  fitter.readParams().then((params) => {
    const text = encodeBlobs({params: params.subarray(0, count * P), count, seed, width: photo.width, height: photo.height, bg})
    saveText(`stage-${String(count).padStart(5, '0')}.txt`, text)
  }, console.error)
}

export function App() {
  const [gpu, setGpu] = useState<Gpu>('checking')
  const [photo, setPhoto] = useState<Photo | null>(null)
  const [photoName, setPhotoName] = useState('')
  // The chosen file itself, for the thumbnail and its size before a fit starts.
  const [photoFile, setPhotoFile] = useState<{url: string; bytes: number} | null>(null)
  const [blobs, setBlobs] = useState(8000)
  const [seed, setSeed] = useState(1)
  const [initMode, setInitMode] = useState<InitMode>('painting')
  const [phase, setPhase] = useState<Phase>('idle')
  const [step, setStep] = useState(0)
  const [fitBlobs, setFitBlobs] = useState(0) // active blobs
  const [targetBlobs, setTargetBlobs] = useState(0)
  // What the captions describe: how the current fit started, and how it stopped by itself.
  const [fitStart, setFitStart] = useState<{mode: InitMode; active: number}>({mode: 'painting', active: 0})
  const [doneInfo, setDoneInfo] = useState<CaptionState['done']>(null)
  const latestStats = useRef<LoopStats | null>(null)
  // The event log: real fit events wait here and become at most one entry every LOG_EVERY_MS.
  const pendingEvents = useRef<FitEvent[]>([])
  const lastLogEntry = useRef(0)
  const [logEntries, setLogEntries] = useState<(LogEntry & {id: number})[]>([])
  const [stats, setStats] = useState<LoopStats | null>(null)
  // Mistake readbacks for the chart.
  const [history, setHistory] = useState<MistakePoint[]>([])
  // For the code panel: blobs with this index or higher are new since the previous readback.
  const [newFrom, setNewFrom] = useState(Infinity)
  const lastActive = useRef<number | null>(null)
  // Dev override of the accumulation format; null = the default for this device.
  const [accumChoice, setAccumChoice] = useState<AccumFormat | null>(null)
  const [error, setError] = useState('')
  // Set when the GPU device was lost (not destroyed by the app): the message, and whether a new
  // device is being requested.
  // A lower blob limit on weak GPUs, with the reason shown next to the blob count.
  const [cap, setCap] = useState<BlobCap | null>(null)
  const maxBlobs = cap?.max ?? MAX_BLOBS
  const [deviceLost, setDeviceLost] = useState<{message: string; reconnecting: boolean} | null>(null)
  // After a device loss with a photo loaded: start the fit again once the new device is there.
  const restartAfterLoss = useRef(false)
  // Dev only: lets a simulated loss (a real destroy()) count as a loss.
  const simulatingLoss = useRef(false)
  const [selfTest, setSelfTest] = useState<SelfTestResult | 'running' | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // The running fit, with what its code file needs (the seed and photo it was started with).
  const run = useRef<{
    fitter: Fitter
    loop: Loop
    seed: number
    width: number
    height: number
    bg: [number, number, number]
  } | null>(null)
  const [saving, setSaving] = useState(false)
  // Fitting time spent growing (pauses excluded); null when the fit does not grow.
  const [growthSeconds, setGrowthSeconds] = useState<number | null>(null)
  const growthDone = useRef(false)
  // Picture size in its own pixels (the canvas), for the outline overlay.
  const [pictureSize, setPictureSize] = useState<[number, number]>([1, 1])
  const [growthOutlines, setGrowthOutlines] = useState<GrowthOutlines[]>([])
  const [hoveredBlob, setHoveredBlob] = useState<number | null>(null)
  // Width : height of what the stage shows (the photo being fitted, or an opened code file).
  const [pictureAspect, setPictureAspect] = useState<[number, number]>([1, 1])
  // Set while an opened code file is shown.
  const [openedFile, setOpenedFile] = useState<{count: number; seed: number} | null>(null)

  function stopRun() {
    run.current?.loop.stop()
    run.current?.fitter.destroy()
    run.current = null
    setPhase('idle')
  }

  function fail(reason: unknown) {
    stopRun()
    setError(reason instanceof Error ? reason.message : String(reason))
  }

  // Asks for a GPU device and watches it. A device can be lost at any time (driver reset, sleep,
  // too much work); the app then offers to start again on a new one.
  function connectGpu(isCancelled: () => boolean = () => false) {
    requestDevice().then(
      (found) => {
        if (isCancelled()) return
        const device = found?.device
        setGpu(device ?? 'missing')
        setDeviceLost(null)
        if (!found || !device) return
        const minimal = {maxStorageBufferBindingSize: 0, maxBufferSize: 0, maxTextureDimension2D: 0, maxComputeWorkgroupStorageSize: 0}
        const newCap = blobCap(SIMULATE_LOW_LIMITS ? {isFallbackAdapter: false, limits: minimal} : found.adapter)
        setCap(newCap)
        if (newCap) setBlobs((count) => Math.min(count, newCap.max))
        device.lost.then((info) => {
          if (info.reason === 'destroyed' && !simulatingLoss.current) return
          simulatingLoss.current = false
          stopRun()
          setError('')
          setDeviceLost({message: 'The GPU stopped responding, so the painting was lost.', reconnecting: false})
        })
        device.addEventListener('uncapturederror', (event) => fail(event.error.message))
        if (DEV) {
          ;(window as {codeFaceSimulateDeviceLoss?: () => void}).codeFaceSimulateDeviceLoss = () => {
            simulatingLoss.current = true
            device.destroy()
          }
        }
      },
      () => {
        if (!isCancelled()) setGpu('missing')
      },
    )
  }

  useEffect(() => {
    let cancelled = false
    connectGpu(() => cancelled)
    return () => {
      cancelled = true
      run.current?.loop.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function restartGpu() {
    setDeviceLost((lost) => lost && {...lost, reconnecting: true})
    restartAfterLoss.current = photo !== null
    connectGpu()
  }

  // The new device is there: start the loaded photo again.
  useEffect(() => {
    if (typeof gpu === 'string' || deviceLost || !restartAfterLoss.current) return
    restartAfterLoss.current = false
    start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpu, deviceLost])

  // Releases the next log entry when one is due; newest entries first.
  useEffect(() => {
    const timer = setInterval(() => {
      const now = performance.now()
      if (now - lastLogEntry.current < LOG_EVERY_MS) return
      const next = nextEntry(pendingEvents.current)
      if (!next) return
      pendingEvents.current = next.rest
      lastLogEntry.current = now
      setLogEntries((entries) => [{id: now, ...next.entry}, ...entries].slice(0, LOG_KEEP))
    }, 250)
    return () => clearInterval(timer)
  }, [])

  async function openFile(file: File | undefined) {
    if (!file) return
    const problem = problemBeforeDecoding(file)
    if (problem) {
      setError(photoProblemMessage(problem, file))
      return
    }
    try {
      const loaded = await loadPhoto(file, WORKING_SIZE)
      stopRun()
      setError('')
      setStep(0)
      setFitBlobs(0)
      setStats(null)
      setPhoto(loaded)
      setPhotoName(file.name)
      setPhotoFile((previous) => {
        if (previous) URL.revokeObjectURL(previous.url)
        return {url: URL.createObjectURL(file), bytes: file.size}
      })
    } catch {
      setError(photoProblemMessage(problemAfterDecoding(file), file))
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault()
    const file = event.dataTransfer.files[0]
    if (file && (file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt'))) openCode(file)
    else openFile(file)
  }

  // Opens a code file and shows the picture it describes. Nothing is fitted: there is no photo to fit to.
  async function openCode(file: File | undefined) {
    const canvas = canvasRef.current
    if (!file || typeof gpu === 'string' || !canvas) return
    let decoded: ReturnType<typeof decodeBlobs>
    try {
      decoded = decodeBlobs(await file.text())
    } catch (reason) {
      setError(`Could not open "${file.name}". ${reason instanceof Error ? reason.message : String(reason)}`)
      return
    }
    stopRun()
    setError('')
    try {
      const [aw, ah] = decoded.aspect
      const width = Math.max(1, Math.round((WORKING_SIZE * aw) / Math.max(aw, ah)))
      const height = Math.max(1, Math.round((WORKING_SIZE * ah) / Math.max(aw, ah)))
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('webgpu') as GPUCanvasContext | null
      if (!context) throw new Error('Could not get a WebGPU canvas context.')
      context.configure({device: gpu, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: 'opaque'})
      // The renderer needs a target image: a flat one in the background colour. It is never fitted to.
      const flat = new Uint8ClampedArray(width * height * 4)
      const bg8 = decoded.bg.map((c) => Math.round(c * 255))
      for (let k = 0; k < width * height; k++) flat.set([bg8[0], bg8[1], bg8[2], 255], k * 4)
      const settings = defaultSettings(width, height, decoded.count, decoded.bg)
      const fitter = createFitter(gpu, settings, flat, decoded.params, defaultAccumFormat(gpu))
      fitter.draw(context.getCurrentTexture().createView())
      const idle: Loop = {setPaused() {}, stop() {}}
      run.current = {fitter, loop: idle, seed: decoded.seed, width: aw, height: ah, bg: decoded.bg}
      // The code panel shows the same evenly spaced sample as after a fit, read from the file.
      const blobIndices = createBlobPicker(decoded.count)(decoded.count)
      const blobs = new Float32Array(blobIndices.length * P)
      blobIndices.forEach((i, k) => blobs.set(decoded.params.subarray(i * P, i * P + P), k * P))
      const fileStats: LoopStats = {
        step: 0,
        active: decoded.count,
        loss: Number.NaN,
        stepsPerSecond: null,
        sigma: null,
        blobIndices,
        blobs,
      }
      latestStats.current = null
      lastActive.current = null
      setNewFrom(Infinity)
      setStats(fileStats)
      setStep(0)
      setFitBlobs(decoded.count)
      setTargetBlobs(decoded.count)
      setDoneInfo(null)
      setPictureAspect([aw, ah])
      setPictureSize([width, height])
      setGrowthOutlines([])
      setHoveredBlob(null)
      setOpenedFile({count: decoded.count, seed: decoded.seed})
      setGrowthSeconds(null)
      setHistory([])
      pendingEvents.current = [{kind: 'opened', count: decoded.count, seed: decoded.seed, name: file.name}]
      lastLogEntry.current = 0
      setLogEntries([])
      setPhase('viewing')
    } catch (reason) {
      fail(reason)
    }
  }

  function start(choice: AccumFormat | null = accumChoice) {
    const canvas = canvasRef.current
    if (typeof gpu === 'string' || !photo || !canvas) return
    const format = choice ?? defaultAccumFormat(gpu)
    stopRun()
    setError('')
    const count = Math.round(Math.min(maxBlobs, Math.max(MIN_BLOBS, blobs || 0)))
    setBlobs(count)
    try {
      // The canvas keeps the fit resolution; CSS scales it to the available area.
      canvas.width = photo.width
      canvas.height = photo.height
      const context = canvas.getContext('webgpu') as GPUCanvasContext | null
      if (!context) throw new Error('Could not get a WebGPU canvas context.')
      context.configure({device: gpu, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: 'opaque'})
      // All blobs are allocated up front; every size limit follows the ACTIVE count.
      const active = startCount(initMode, count)
      const params = new Float32Array(count * P)
      params.set(initBlobs(photo, active, seed, initMode))
      const bg = meanColor(photo)
      const settingsFor = (blobCount: number) => defaultSettings(photo.width, photo.height, blobCount, bg)
      const fitter = createFitter(gpu, settingsFor(active), photo.data, params, format)
      // Painting mode: the active count grows towards the target; new blobs go where the error is.
      const growth: Growth | null =
        active < count
          ? {
              events: growthSchedule(active, count, GROWTH_FIRST_DOUBLING_STEPS, GROWTH_DOUBLING_RATIO),
              sample: (error, from, event, index) => {
                // The copy is queued before grow() writes the new blobs, so it holds the first `from` blobs
                // exactly as fitted at this active count.
                if (STAGES.includes(from)) saveStage(fitter, from, seed, photo, bg)
                const added = sampleNewBlobs(error, photo, seed, index, from, event.active)
                // Outline some of the new blobs, from the params just made here (no extra readback).
                if (!prefersReducedMotion()) {
                  const longSide = Math.max(photo.width, photo.height)
                  const picks = spread(added.length / P, OUTLINES_PER_GROWTH)
                  const id = performance.now()
                  const ellipses = picks.map((k) => blobEllipse(added, k, longSide))
                  setGrowthOutlines((groups) => [...groups, {id, ellipses}])
                  setTimeout(() => setGrowthOutlines((groups) => groups.filter((g) => g.id !== id)), OUTLINE_MS)
                }
                return added
              },
              settingsFor,
              onGrown: (atStep, added, total) => {
                pendingEvents.current.push({kind: 'grow', step: atStep, added, total})
                if (total === count) {
                  pendingEvents.current.push({kind: 'refining', step: atStep, total})
                  growthDone.current = true
                }
              },
            }
          : null
      const loop = runLoop(
        gpu,
        fitter,
        DEV, // the blob-size summary is a dev readout
        createBlobPicker(count), // the blobs the code panel shows
        growth,
        () => fitter.draw(context.getCurrentTexture().createView()),
        (steps, activeBlobs, seconds) => {
          setStep(steps)
          setFitBlobs(activeBlobs)
          if (growth && !growthDone.current) setGrowthSeconds(seconds)
        },
        (next) => {
          const below = latestStats.current && milestoneCrossed(latestStats.current.loss, next.loss)
          if (below) pendingEvents.current.push({kind: 'milestone', step: next.step, below, loss: next.loss})
          setNewFrom(lastActive.current ?? Infinity)
          lastActive.current = next.active
          latestStats.current = next
          setStats(next)
          setHistory((points) => {
            const kept = points.length >= CHART_KEEP ? points.filter((_, i) => i % 2 === 0) : points
            return [...kept, {step: next.step, loss: next.loss}]
          })
        },
        (reason) => {
          if (STAGES.includes(count)) saveStage(fitter, count, seed, photo, bg)
          // The readback that triggered the stop is the latest one.
          const last = latestStats.current
          setDoneInfo({reason, step: last?.step ?? 0, loss: last?.loss ?? Number.NaN})
          pendingEvents.current.push({kind: 'done', step: last?.step ?? 0, reason, loss: last?.loss ?? Number.NaN})
          setPhase('done')
        },
        fail,
      )
      lastActive.current = null
      latestStats.current = null
      setNewFrom(Infinity)
      setFitStart({mode: initMode, active})
      setDoneInfo(null)
      setOpenedFile(null)
      setPictureAspect([photo.width, photo.height])
      setPictureSize([photo.width, photo.height])
      setGrowthOutlines([])
      setHoveredBlob(null)
      growthDone.current = false
      setGrowthSeconds(growth ? 0 : null)
      setHistory([])
      pendingEvents.current = [{kind: 'start', mode: initMode, active}]
      lastLogEntry.current = 0
      setLogEntries([])
      run.current = {fitter, loop, seed, width: photo.width, height: photo.height, bg}
      setStep(0)
      setFitBlobs(active)
      setTargetBlobs(count)
      setStats(null)
      setPhase('running')
    } catch (reason) {
      fail(reason)
    }
  }

  // Pause while running; resume from a pause or from an automatic stop.
  function togglePause() {
    if (!run.current || phase === 'viewing') return
    run.current.loop.setPaused(phase === 'running')
    if (phase === 'done') {
      setDoneInfo(null)
      pendingEvents.current.push({kind: 'resumed', step: run.current.fitter.steps})
    }
    setPhase(phase === 'running' ? 'paused' : 'running')
  }

  // Saves the blobs as they are now (running, paused or done) as a code file.
  async function downloadCode() {
    const current = run.current
    if (!current || saving) return
    setSaving(true)
    try {
      const count = current.fitter.active
      const params = (await current.fitter.readParams()).subarray(0, count * P)
      saveText(`code-face-${current.seed}-${count}.txt`, encodeBlobs({...current, params, count}))
    } catch (reason) {
      setError(`Could not save the code: ${reason instanceof Error ? reason.message : String(reason)}`)
    } finally {
      setSaving(false)
    }
  }

  // Draws the code poster from the blobs as they are now. Pauses a running fit first, so the code and
  // the picture tinting it are the same state.
  async function makePoster(
    options: PosterOptions,
    onProgress: (fraction: number) => void,
    isCancelled: () => boolean,
  ) {
    const current = run.current
    const canvas = canvasRef.current
    if (!current || !canvas || typeof gpu === 'string') throw new Error('there is no picture yet')
    if (phase === 'running') togglePause()
    const count = current.fitter.active
    const params = (await current.fitter.readParams()).subarray(0, count * P)
    const text = encodeBlobs({...current, params, count})
    // Tinted: the PNG and JPEG take each character's colour from the working-size picture; the SVG
    // embeds the picture itself, so it is drawn afresh from the blobs at SVG_PICTURE_SIDE.
    const picture =
      options.style !== 'tinted'
        ? null
        : options.format === 'svg'
          ? renderPictureAt(gpu, params, count, current.bg, [canvas.width, canvas.height], SVG_PICTURE_SIDE, accumChoice ?? defaultAccumFormat(gpu))
          : renderPicture(gpu, current.fitter, canvas.width, canvas.height)
    const blob = await makePosterInWorker(
      {text, picture: picture && {width: picture.width, height: picture.height, data: picture.data}, options, count, seed: current.seed},
      onProgress,
      isCancelled,
    )
    const extension = {svg: 'svg', png: 'png', jpeg: 'jpg'}[options.format]
    return {blob, name: `code-face-${current.seed}-${count}-${options.frame}-${options.orientation}.${extension}`}
  }

  function changeAccumFormat(format: AccumFormat) {
    setAccumChoice(format)
    if (run.current) start(format)
  }

  async function selfTestClick() {
    if (typeof gpu === 'string') return
    setSelfTest('running')
    try {
      setSelfTest(await runSelfTest(gpu))
    } catch (reason) {
      setSelfTest(null)
      setError(`Self-test crashed: ${reason instanceof Error ? reason.message : String(reason)}`)
    }
  }

  // (A hook: it must run on every render, before the early returns below.)
  // The hovered code line's blob, from the same readback the line shows.
  const hovered = useMemo(() => {
    const at = hoveredBlob !== null && stats ? stats.blobIndices.indexOf(hoveredBlob) : -1
    return at >= 0 && stats ? {index: hoveredBlob!, ellipse: blobEllipse(stats.blobs, at, Math.max(...pictureSize))} : null
  }, [hoveredBlob, stats, pictureSize])

  if (gpu === 'checking') return <main className="message">Checking for WebGPU…</main>
  if (gpu === 'missing') {
    return (
      <main className="message">
        <h1>Code Face needs WebGPU</h1>
        <p>
          This browser or device does not offer WebGPU, and there is no slower fallback. Try a current version of
          Chrome or Edge on a computer, or Safari 26 or newer.
        </p>
        <p>
          <a href="/">Back to the Code Face home page</a>
        </p>
      </main>
    )
  }

  // Portrait (or square): explanations | picture | code. Landscape: picture on top, the other two below.
  const layout = pictureAspect[0] > pictureAspect[1] ? 'landscape' : 'portrait'
  const accumFormat = accumChoice ?? defaultAccumFormat(gpu)
  const captionState: CaptionState = {
    mode: fitStart.mode,
    startActive: fitStart.active,
    target: targetBlobs,
    active: fitBlobs,
    done: phase === 'done' ? doneInfo : null,
    file: phase === 'viewing' ? openedFile : null,
  }
  const currentPhase = phase === 'idle' ? null : fitPhase(captionState)
  // The footer's first action. Done: "Keep refining" is secondary, so the poster download is the only
  // accent button on screen. Viewing a code file: a loaded photo can still be started from here.
  const primary =
    phase === 'running'
      ? {label: 'Pause', action: togglePause, accent: true}
      : phase === 'paused'
        ? {label: 'Resume', action: togglePause, accent: true}
        : phase === 'done'
          ? {label: 'Keep refining', action: togglePause, accent: false}
          : phase === 'viewing' && photo
            ? {label: 'Start', action: () => start(), accent: false}
            : null

  return (
    <div className="shell">
      <Header phase={currentPhase} />

      <main
        className={`stage ${phase === 'idle' ? 'portrait idle' : layout}`}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
      >
        <Explain
          live={phase !== 'idle'}
          caption={
            phase !== 'idle'
              ? caption(captionState)
              : photo
                ? {headline: 'Ready when you are.', support: `${photoName} is loaded; press Start to watch it being painted.`}
                : {headline: 'Drop a photo to begin.', support: 'It is re-painted right here in your browser; nothing is uploaded.'}
          }
          entries={phase === 'idle' ? [] : logEntries}
        />

        <section className="centre">
          <div className="picture">
            <div className="frame" style={{'--ar': pictureAspect[0] / pictureAspect[1]} as React.CSSProperties}>
              <canvas ref={canvasRef} className={phase === 'idle' ? 'hidden' : ''} aria-label="Blob painting of your photo" />
              {phase !== 'idle' && (
                <BlobOverlay width={pictureSize[0]} height={pictureSize[1]} growth={growthOutlines} hovered={hovered} />
              )}
            </div>
            {phase === 'idle' &&
              (photo && photoFile ? (
                <div className="drop loaded">
                  <div className="drop-text">
                    <p>Press Start, or drop another photo.</p>
                    <p className="muted">
                      {photoName} · {fileSize(photoFile.bytes)}
                    </p>
                  </div>
                  <div className="thumb">
                    <img src={photoFile.url} alt={`The loaded photo, ${photoName}`} />
                  </div>
                  <div className="drop-actions">
                    <button className="primary" onClick={() => start()}>
                      Start
                    </button>
                    <PhotoPicker label="Another photo" onFile={openFile} />
                  </div>
                </div>
              ) : (
                <label className="drop">
                  <input type="file" accept="image/*" onChange={(event) => openFile(event.target.files?.[0])} />
                  <span>Drop a photo here, or click to choose one. It never leaves this device.</span>
                </label>
              ))}
          </div>
          {phase !== 'idle' && (
            <>
              <Counters
                blobs={fitBlobs}
                target={targetBlobs}
                step={phase === 'viewing' ? null : step}
                mistake={stats && Number.isFinite(stats.loss) ? stats.loss : null}
              />
              {phase !== 'viewing' && <MistakeChart points={history} />}
            </>
          )}
        </section>

        <section className="code-column">
          <CodePanel
            stats={phase === 'idle' ? null : stats}
            newFrom={newFrom}
            hovered={hoveredBlob}
            onHover={setHoveredBlob}
          />
          {(phase === 'done' || phase === 'paused' || phase === 'viewing') && run.current && (
            <div className="downloads">
              <PosterExport
                count={fitBlobs}
                header={encodeBlobs({...run.current, params: new Float32Array(0), count: fitBlobs})
                  .split('\n')
                  .slice(0, 4)}
                disabled={saving}
                make={makePoster}
              />
              <button className="secondary" onClick={downloadCode} disabled={saving}>
                {saving ? 'Saving…' : 'Code as text'}
              </button>
              <p className="muted">
                This text file is your picture: every blob is in it. Open it here again with "Open code file" to see
                the picture.
              </p>
            </div>
          )}
        </section>
      </main>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {deviceLost && (
        <p className="error" role="alert">
          {deviceLost.message}{' '}
          <button onClick={restartGpu} disabled={deviceLost.reconnecting}>
            {deviceLost.reconnecting ? 'Restarting…' : photo ? 'Restart the painting' : 'Restart the GPU'}
          </button>
        </p>
      )}

      <footer className="bar">
        <div className="bar-file">
          <label className="button-like quiet">
            <input
              type="file"
              accept=".txt,text/plain"
              onChange={(event) => {
                openCode(event.target.files?.[0])
                event.target.value = '' // the same file can be opened again
              }}
            />
            <span>Open code file</span>
          </label>
        </div>
        {/* Before a fit the frame holds Start and Another photo; no second set down here. */}
        <div className="bar-actions">
          {phase !== 'idle' && (
            <>
              {primary && (
                <button className={primary.accent ? 'primary' : ''} onClick={primary.action}>
                  {primary.label}
                </button>
              )}
              {phase !== 'viewing' && <button onClick={() => start()}>Restart</button>}
              <PhotoPicker label={photo ? 'Another photo' : 'Choose photo'} onFile={openFile} />
            </>
          )}
        </div>
        <div className="bar-settings">
          <label>
            <span className="label">BLOBS</span>
            <input
              type="number"
              min={MIN_BLOBS}
              max={maxBlobs}
              aria-describedby={cap ? 'blob-cap' : undefined}
              step={1000}
              value={blobs}
              onChange={(event) => setBlobs(event.target.valueAsNumber)}
            />
          </label>
          <label>
            <span className="label">SEED</span>
            <input
              type="number"
              min={0}
              step={1}
              value={seed}
              onChange={(event) => setSeed(Math.max(0, Math.floor(event.target.valueAsNumber || 0)))}
            />
          </label>
          {cap && (
            <p className="cap-note" id="blob-cap">
              {cap.reason}
            </p>
          )}
          <p className="growth-time">
            <span className="label">GROWTH</span> {growthSeconds === null ? '–' : clock(growthSeconds)}
          </p>
        </div>
      </footer>

      {DEV && (
        <DevTools
          stats={stats}
          accumFormat={accumFormat}
          canChooseAccum={gpu.features.has('float32-blendable')}
          onAccumFormat={changeAccumFormat}
          initMode={initMode}
          onInitMode={setInitMode}
          selfTest={selfTest}
          canRunSelfTest={phase !== 'running'}
          onSelfTest={selfTestClick}
        />
      )}
    </div>
  )
}
