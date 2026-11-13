import {Q_MAX} from '../fitter/params'
import {blobWeight} from '../reference/blend'
import {DEMO_ASPECT, DEMO_STAGES} from './demo'
import {blobNumber, lineColour} from './demoHtml'
import {fetchText, paintStage, type PaintedStage} from './painter'
import {decode} from './scramble'

// The hero: the demo picture painting itself stage by stage from its real code files, the live code
// panel and counters that follow the stage, and the small pointer interactions.

const HOLD_MS = 1500 // each stage, before the next
const HOLD_LAST_MS = 3800 // the finished picture, before the loop starts again
const FADE_MS = 450 // matches .frame canvas in landing.css
const PANEL_LINES = 14
const LAST = DEMO_STAGES.length - 1
const [ASPECT_W, ASPECT_H] = DEMO_ASPECT
const LONG = Math.max(ASPECT_W, ASPECT_H)
// The picture in blob coordinates (fractions of the long side).
const SPAN_X = ASPECT_W / LONG
const SPAN_Y = ASPECT_H / LONG

const $ = <T extends Element>(selector: string, root: ParentNode = document) => {
  const element = root.querySelector<T>(selector)
  if (!element) throw new Error(`landing: missing ${selector}`)
  return element
}

export const formatBlobs = (n: number) => Math.round(n).toLocaleString('en-US')
export const formatMistake = (m: number) => `${(m * 100).toFixed(2)}%`

export type Hero = {
  // The painted stage (fetched and drawn once, on first request).
  stage(index: number): Promise<PaintedStage>
}

export function initHero(reduced: boolean): Hero {
  const hero = $<HTMLElement>('.hero')
  const frame = $<HTMLElement>('.frame', hero)
  const canvases = [...frame.querySelectorAll('canvas')]
  const ring = $<SVGEllipseElement>('.ring', frame)
  const tag = $<HTMLElement>('.tag', frame)
  const items = [...hero.querySelectorAll<HTMLLIElement>('.panel-lines li')]
  const panelCount = $<HTMLElement>('.panel-count', hero)
  const countBlobs = $<HTMLElement>('#count-blobs')
  const countMistake = $<HTMLElement>('#count-mistake')

  // Device pixels for the picture's long side: sharp enough, and cheap enough to draw on the CPU.
  const longSide = Math.round(Math.min(768, Math.max(512, frame.clientWidth * Math.min(2, devicePixelRatio))))
  const painted: (PaintedStage | undefined)[] = []
  const pending = new Map<number, Promise<PaintedStage>>()
  const stage = (index: number) => {
    let promise = pending.get(index)
    if (!promise) {
      const meta = DEMO_STAGES[index]
      promise = fetchText(meta.file)
        .then((text) => paintStage(meta, text, canvases[index], longSide))
        .then((done) => {
          painted[index] = done
          onPainted(index)
          return done
        })
      pending.set(index, promise)
    }
    return promise
  }

  // ---- Stage loop -------------------------------------------------------------------------------
  let current = -1
  let timer = 0
  let onScreen = true
  let fadeTimer = 0

  function show(index: number) {
    const before = canvases[current]
    clearTimeout(fadeTimer)
    for (const canvas of canvases) canvas.classList.remove('prev')
    if (before && index !== current) {
      before.classList.replace('on', 'prev')
      fadeTimer = window.setTimeout(() => before.classList.remove('prev'), FADE_MS + 50)
    }
    canvases[index].classList.add('on')
    current = index
    const s = painted[index]!
    setCounters(s.meta.blobs, s.meta.mistake)
    panelCount.textContent = `${formatBlobs(s.meta.blobs)} blobs`
    hover.refresh()
  }

  const running = () => !reduced && onScreen && !document.hidden

  function plan() {
    if (timer || !running() || current < 0) return
    timer = window.setTimeout(advance, current === LAST ? HOLD_LAST_MS : HOLD_MS)
  }

  function advance() {
    timer = 0
    if (!running()) return
    const next = (current + 1) % DEMO_STAGES.length
    if (!painted[next]) return // onPainted() moves on once it is drawn
    show(next)
    plan()
  }

  function onPainted(index: number) {
    if (current < 0) {
      // The first stage to be ready is shown straight away.
      show(index)
      plan()
    } else if (index === (current + 1) % DEMO_STAGES.length && !timer) {
      plan()
    }
  }

  function pause() {
    clearTimeout(timer)
    timer = 0
  }

  if (reduced) {
    // The finished picture only, no loop.
    void stage(LAST).catch(() => {})
  } else {
    // Smallest first, so the picture shows almost at once; then the rest, one after another.
    void DEMO_STAGES.reduce<Promise<unknown>>((chain, _, i) => chain.then(() => stage(i)), Promise.resolve()).catch(() => {})
    new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting
      if (onScreen) plan()
      else pause()
    }).observe(hero)
    document.addEventListener('visibilitychange', () => (document.hidden ? pause() : plan()))
  }

  // ---- Counters ---------------------------------------------------------------------------------
  let shownBlobs = DEMO_STAGES[LAST].blobs
  let shownMistake = DEMO_STAGES[LAST].mistake
  let countRaf = 0
  function setCounters(blobs: number, mistake: number) {
    cancelAnimationFrame(countRaf)
    if (reduced) {
      countBlobs.textContent = formatBlobs(blobs)
      countMistake.textContent = formatMistake(mistake)
      shownBlobs = blobs
      shownMistake = mistake
      return
    }
    const [b0, m0] = [shownBlobs, shownMistake]
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 500)
      const e = 1 - (1 - t) ** 3
      shownBlobs = b0 + (blobs - b0) * e
      shownMistake = m0 + (mistake - m0) * e
      countBlobs.textContent = formatBlobs(shownBlobs)
      countMistake.textContent = formatMistake(shownMistake)
      if (t < 1) countRaf = requestAnimationFrame(step)
    }
    countRaf = requestAnimationFrame(step)
  }

  // ---- Panel ------------------------------------------------------------------------------------
  let panelKey = ''
  // Shows 14 consecutive lines: the newest blobs, or the lines around `centre`, which is highlighted.
  function setPanel(s: PaintedStage, centre: number | null) {
    const n = Math.min(PANEL_LINES, s.lines.length)
    const start = centre === null ? s.lines.length - n : Math.max(0, Math.min(s.lines.length - n, centre - 6))
    const key = `${s.meta.blobs}:${start}:${centre}`
    if (key === panelKey) return
    panelKey = key
    items.forEach((li, k) => {
      const index = start + k
      const line = s.lines[index]
      li.hidden = line === undefined
      if (line === undefined) return
      li.dataset.blob = String(index)
      li.classList.toggle('hl', index === centre)
      li.children[0].textContent = blobNumber(index)
      li.children[1].textContent = line
      li.querySelector('rect')!.setAttribute('fill', `#${lineColour(line)}`)
    })
  }

  // ---- Pointer: outline the blob under the pointer, and flash a panel line's blob -----------------
  const hover = (() => {
    let pointer: {x: number; y: number; w: number; h: number} | null = null
    let raf = 0
    let flashing: number | null = null

    function outline(s: PaintedStage, index: number, size: {w: number; h: number}, flash: boolean) {
      const b = s.blobs[index]
      const deg = (Math.atan2(b.sn, b.cs) * 180) / Math.PI
      ring.setAttribute('cx', String(b.x))
      ring.setAttribute('cy', String(b.y))
      ring.setAttribute('rx', String(2 * b.sx))
      ring.setAttribute('ry', String(2 * b.sy))
      ring.setAttribute('transform', `rotate(${deg} ${b.x} ${b.y})`)
      ring.classList.add('on')
      ring.classList.remove('flash')
      if (flash && !reduced) {
        void ring.getBoundingClientRect() // restarts the animation
        ring.classList.add('flash')
      }
      // The label sits above the ellipse (below it near the top edge), kept inside the picture.
      const reachY = 2 * Math.hypot(b.sx * b.sn, b.sy * b.cs)
      tag.textContent = `blob ${index + 1} · #${lineColour(s.lines[index])}`
      const px = (b.x / SPAN_X) * size.w
      let py = ((b.y - reachY) / SPAN_Y) * size.h - 24
      if (py < 4) py = ((b.y + reachY) / SPAN_Y) * size.h + 6
      const tw = tag.offsetWidth
      const x = Math.max(4, Math.min(size.w - tw - 4, px - tw / 2))
      const y = Math.max(4, Math.min(size.h - 24, py))
      tag.style.transform = `translate(${x}px, ${y}px)`
      tag.classList.add('on')
    }

    function clear() {
      ring.classList.remove('on', 'flash')
      tag.classList.remove('on')
    }

    // The blob that weighs most at the pointer: the one you are looking at.
    function blobAt(s: PaintedStage, x: number, y: number): number {
      let best = -1
      let bestWeight = 0
      for (let i = 0; i < s.blobs.length; i++) {
        const b = s.blobs[i]
        const w = blobWeight(x - b.x, y - b.y, b, Q_MAX)
        if (w > bestWeight) {
          bestWeight = w
          best = i
        }
      }
      return best
    }

    function update() {
      raf = 0
      const s = painted[current]
      if (!s) return
      if (flashing !== null) return
      if (!pointer) {
        clear()
        setPanel(s, null)
        return
      }
      const index = blobAt(s, pointer.x * SPAN_X, pointer.y * SPAN_Y)
      if (index < 0) {
        clear()
        setPanel(s, null)
        return
      }
      outline(s, index, pointer, false)
      setPanel(s, index)
    }

    const request = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }

    frame.addEventListener('pointermove', (event) => {
      const r = frame.getBoundingClientRect()
      pointer = {x: (event.clientX - r.left) / r.width, y: (event.clientY - r.top) / r.height, w: r.width, h: r.height}
      request()
    })
    frame.addEventListener('pointerleave', () => {
      pointer = null
      request()
    })

    const panel = $<HTMLElement>('.panel-lines', hero)
    panel.addEventListener('pointerover', (event) => {
      const li = (event.target as Element).closest<HTMLLIElement>('li[data-blob]')
      const s = painted[current]
      if (!li || !s) return
      const index = Number(li.dataset.blob)
      if (index === flashing) return
      flashing = index
      for (const other of items) other.classList.toggle('hl', other === li)
      panelKey = ''
      const r = frame.getBoundingClientRect()
      outline(s, index, {w: r.width, h: r.height}, true)
    })
    panel.addEventListener('pointerleave', () => {
      flashing = null
      for (const li of items) li.classList.remove('hl')
      request()
    })

    return {refresh: request}
  })()

  // ---- Headline, wordmark, background field -------------------------------------------------------
  if (!reduced) {
    const line = $<HTMLElement>('.decode', hero)
    void decode(line, line.textContent ?? '', 600)

    const wordmark = $<HTMLElement>('.wordmark')
    const parts = [$<HTMLElement>('.wm-a', wordmark), $<HTMLElement>('.wm-b', wordmark)]
    let busy = false
    const hexOnce = () => {
      if (busy) return
      busy = true
      void Promise.all(parts.map((p) => decode(p, p.textContent ?? '', 260, 140, true))).then(() => (busy = false))
    }
    wordmark.addEventListener('pointerenter', hexOnce)
    wordmark.addEventListener('focus', hexOnce)

    if (matchMedia('(hover: hover) and (pointer: fine)').matches) initLens(hero)
  }

  return {stage}
}

// A brighter copy of the background code in a round window that follows the pointer (transform only).
function initLens(hero: HTMLElement) {
  const field = $<HTMLElement>('.field', hero)
  const text = $<HTMLElement>('.field-text', field)
  const lens = document.createElement('div')
  lens.className = 'lens'
  const copy = text.cloneNode(true) as HTMLElement
  lens.append(copy)
  field.append(lens)
  const R = 180
  let at: {x: number; y: number} | null = null
  let raf = 0
  const move = () => {
    raf = 0
    if (!at) return
    lens.style.transform = `translate(${at.x - R}px, ${at.y - R}px)`
    copy.style.transform = `translate(${R - at.x}px, ${R - at.y}px)`
  }
  hero.addEventListener('pointermove', (event) => {
    const r = field.getBoundingClientRect()
    at = {x: event.clientX - r.left, y: event.clientY - r.top}
    lens.classList.add('on')
    if (!raf) raf = requestAnimationFrame(move)
  })
  hero.addEventListener('pointerleave', () => lens.classList.remove('on'))
}
