// The cursor relay that builds everything below the hero.
//
// Every marked element ([data-build]: a label, heading, paragraph, visual, legend row, code line, poster image,
// footer item) waits at the nearest screen edge, turned and a little smaller. When it comes within 20 % of the
// viewport's bottom it joins one queue, in document order. A shared pool of cursors (each an arrow with a chip
// "blob N" in that blob's colour, from real lines of the demo file) works the queue: a free cursor goes to the
// element at the edge, grabs it (the arrow shrinks, the element gets an outline in the cursor's colour),
// carries it along a gentle curve to its slot, drops it with a small overshoot and takes the next job at once.
// Containers ([data-build-box]: card backgrounds and borders) fade in first so the slots are visible.
//
// Rules: native scrolling, never touched (no pinning, no scrubbing); transform and opacity only, plus the grab
// outline (paint only); the content is in its final place in the HTML, so the layout never moves (CLS 0). Nothing
// is skipped because scrolling is fast: an element is placed instantly only when it has left the view before
// its turn, or when keyboard focus lands in it. With reduced motion this module is not started at all.
//
// The pool is `count` cursors (12 on desktop, 4 on phones). While jobs back up, up to `helpers` more join from
// off-screen so that a section is assembled within about 2.5 s even during steady scrolling; they leave again
// when the work is done and never park in the gutters.
//
// When there is no work and no scrolling for a moment, the cursors park in two columns in the side gutters
// (only where the gutter is wide enough not to touch text; otherwise just off-screen). In the hero they idle:
// a small drift, and now and then one of them points at the picture or the live code panel.
//
// ?debug-build slows everything 4x and logs every job; ?build-log keeps the log (window.__buildLog) at full speed.

const PARAMS = new URLSearchParams(location.search)
const DEBUG = PARAMS.has('debug-build')
const LOG = DEBUG || PARAMS.has('build-log')
const SLOW = DEBUG ? 4 : 1

const QUEUE_LINE = 0.8 // queued once its slot's top is above 80 % of the viewport height
const START_GAP_MS = 40 * SLOW // between two jobs starting, so the relay reads as hands, not a burst
const GO_MS = [120, 210].map((ms) => ms * SLOW) // empty trip to the next element, by distance
const GRAB_MS = 70 * SLOW
const CARRY_MS = [450, 650].map((ms) => ms * SLOW) // by distance
const SETTLE_MS = 140 * SLOW
const OVERSHOOT = 0.015 // of the carried distance, past the slot, before settling
const STANDBY_MS = 200 * SLOW
const QUIET_MS = 700 // no scroll and no work for this long: park
const PARK_MS = 650 * SLOW
const POINT_EVERY_MS = 3400
const POINT_MOVE_MS = 560
const POINT_HOLD_MS = 900
const START_SCALE = 0.94

// The arrow: 26 px wide; its tip is this far from the element's top-left corner.
const TIP = 1.6
const CHIP_ROOM = 112 // px from the arrow's tip to the far end of its chip
// Off-screen waiting places for an arrow's tip: far enough out that no part of the arrow or its chip shows
// (on the right the chip sits to the arrow's left).
const OFF_LEFT = -CHIP_ROOM - 16
const OFF_RIGHT = CHIP_ROOM + 16

type Chip = {blob: number; colour: string}
type Point = {x: number; y: number}

type Item = {
  el: HTMLElement
  id: string
  box: boolean
  // Slot, in document coordinates, measured without any transform.
  left: number
  top: number
  w: number
  h: number
  side: -1 | 1 // nearest screen edge: left or right
  // Start pose (offset from the slot), and the grab point relative to the element's centre.
  dx: number
  dy: number
  rot: number
  ax: number
  ay: number
  state: 'pending' | 'queued' | 'active' | 'placed'
  queuedAt: number
  log?: BuildLog
}

type Job = {item: Item; phase: 'go' | 'grab' | 'carry' | 'settle'; t0: number; from: Point; goMs: number; carryMs: number}

type Move = {from: Point; to: () => Point; t0: number; ms: number; then: 'parked' | 'standby' | 'pointing' | 'back'}

type Cursor = {
  el: HTMLElement
  label: string
  colour: string
  x: number
  y: number
  slot: number // its parking place
  mode: 'parked' | 'standby' | 'moving' | 'job' | 'pointing'
  job: Job | null
  move: Move | null
  holdUntil: number
  flipped: boolean
  grabbing: boolean
}

type BuildLog = {
  id: string
  cursor: string
  dx: number
  dy: number
  rot: number
  queuedAt: number
  startAt: number
  placedAt: number
  goMs: number
  carryMs: number
  instant: boolean
}

declare global {
  interface Window {
    __buildLog?: BuildLog[]
  }
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const easeOut = (t: number) => 1 - (1 - t) ** 2
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// Small deterministic numbers in 0..1, different for every element.
function noise(k: number): number {
  const s = Math.sin(k * 12.9898 + 4.1) * 43758.5453
  return s - Math.floor(s)
}

// Black or white text on the chip, whichever reads better on the blob's colour.
function chipText(colour: string): string {
  const [r, g, b] = [0, 2, 4].map((k) => parseInt(colour.slice(k, k + 2), 16) / 255)
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  return (L + 0.05) / 0.05 >= 1.05 / (L + 0.05) ? '#0d0e10' : '#ffffff'
}

const ARROW =
  '<svg class="arrow" viewBox="0 0 16 20" aria-hidden="true" focusable="false"><path d="M1 1v15.5l4.2-3.9 2.7 6.2 2.6-1.1-2.7-6.1H14z"/></svg>'

function describe(el: HTMLElement): string {
  const where = el.closest('section, footer')
  const place = where?.id || where?.tagName.toLowerCase() || 'page'
  const what = el.tagName.toLowerCase() + (el.classList[0] ? `.${el.classList[0]}` : '')
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 28)
  return `${place}/${what}${text ? ` "${text}"` : ''}`
}

export function initCursors(chips: readonly Chip[], count: number, helpers: number): void {
  const elements = [...document.querySelectorAll<HTMLElement>('[data-build], [data-build-box]')]
  if (elements.length === 0 || chips.length === 0) return
  if (LOG) window.__buildLog = []

  // ---- Cursors -----------------------------------------------------------------------------------
  const layer = document.createElement('div')
  layer.className = 'cursors'
  layer.setAttribute('aria-hidden', 'true')
  const cursors: Cursor[] = chips.slice(0, count + helpers).map((chip, i) => {
    const el = document.createElement('div')
    el.className = 'cursor'
    el.innerHTML = ARROW
    const label = document.createElement('span')
    label.className = 'chip'
    label.textContent = `blob ${chip.blob + 1}`
    label.style.background = `#${chip.colour}`
    label.style.color = chipText(chip.colour)
    el.append(label)
    layer.append(el)
    return {el, label: `blob ${chip.blob + 1}`, colour: `#${chip.colour}`, x: -100, y: -100, slot: i, mode: 'parked', job: null, move: null, holdUntil: 0, flipped: false, grabbing: false}
  })
  document.body.append(layer)

  // ---- Geometry ----------------------------------------------------------------------------------
  let vw = document.documentElement.clientWidth
  let vh = window.innerHeight
  // Where parked cursors' tips sit, in from the screen's side; null when the gutter is too narrow for an
  // arrow and its chip without touching text (they then park just off-screen).
  let gutterX: number | null = null

  function measureViewport() {
    vw = document.documentElement.clientWidth
    vh = window.innerHeight
    const pageGutter = clamp(vw * 0.04, 16, 40)
    const margin = Math.max(0, (vw - 1240) / 2) + pageGutter // free space beside the text
    const room = margin - CHIP_ROOM - 8 // the furthest in a tip can sit with its chip clear of the text
    gutterX = room >= 16 ? clamp(room, 16, 96) : null
    if (gutterX !== null && room >= 48) gutterX = clamp(room * 0.4, 48, 96) // wide screens: 48-96 px in
  }

  // Parking place `slot`, in viewport coordinates: two columns, left and right.
  const base = Math.min(count, cursors.length)
  const isHelper = (c: Cursor) => c.slot >= base

  function parkPoint(slot: number): Point {
    if (slot >= base) return {x: slot % 2 === 0 ? OFF_LEFT : vw + OFF_RIGHT, y: vh * (0.15 + 0.7 * noise(slot))} // helpers wait off-screen
    const perSide = Math.ceil(base / 2)
    const right = slot >= perSide
    const row = right ? slot - perSide : slot
    const y = vh * 0.18 + ((vh * 0.64) / Math.max(1, perSide - 1)) * row
    if (gutterX === null) return {x: right ? vw + OFF_RIGHT : OFF_LEFT, y}
    return {x: right ? vw - gutterX - 26 : gutterX, y}
  }

  // Standby next to the work: the gutter on the cursor's side, at its height (off-screen if no gutter).
  function standbyPoint(c: Cursor): Point {
    if (isHelper(c)) return parkPoint(c.slot)
    const right = c.x > vw / 2
    const y = clamp(c.y, vh * 0.12, vh * 0.88)
    if (gutterX === null) return {x: right ? vw + OFF_RIGHT : OFF_LEFT, y}
    return {x: right ? vw - gutterX - 26 : gutterX, y}
  }

  // ---- Items -------------------------------------------------------------------------------------
  const items: Item[] = elements.map((el) => ({
    el,
    id: describe(el),
    box: el.hasAttribute('data-build-box'),
    left: 0,
    top: 0,
    w: 0,
    h: 0,
    side: -1,
    dx: 0,
    dy: 0,
    rot: 0,
    ax: 0,
    ay: 0,
    state: 'pending',
    queuedAt: 0,
  }))

  const poseOf = (it: Item, k: number) => ({tx: it.dx * k, ty: it.dy * k, rot: it.rot * k, s: lerp(1, START_SCALE, k)})
  const transformOf = (tx: number, ty: number, rot: number, s: number) =>
    `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) rotate(${rot.toFixed(2)}deg) scale(${s.toFixed(4)})`

  // The grab point in document coordinates for a pose (rotation and scale about the element's centre).
  function grabPoint(it: Item, tx: number, ty: number, rot: number, s: number): Point {
    const r = (rot * Math.PI) / 180
    const [cs, sn] = [Math.cos(r), Math.sin(r)]
    return {
      x: it.left + it.w / 2 + tx + s * (cs * it.ax - sn * it.ay),
      y: it.top + it.h / 2 + ty + s * (sn * it.ax + cs * it.ay),
    }
  }

  // Start pose: at the nearest screen edge, partly off-screen, turned 6 to 12 degrees, scale 0.94.
  function plan(it: Item, k: number) {
    const centre = it.left + it.w / 2
    const side: -1 | 1 = Math.abs(centre - vw / 2) < vw * 0.06 ? (k % 2 === 0 ? -1 : 1) : centre < vw / 2 ? -1 : 1
    it.side = side
    const overhang = Math.min(it.w * 0.22, 140) // how far it pokes out of the screen
    const startLeft = side < 0 ? -overhang : vw + overhang - it.w
    it.dx = startLeft - it.left
    it.dy = (noise(k) - 0.5) * 24
    it.rot = side * (6 + 6 * noise(k + 0.5))
    // Held on the part that is on screen, a little in from the screen's edge.
    const inset = Math.min(it.w * 0.32, 160)
    it.ax = clamp(side < 0 ? overhang + inset - it.w / 2 : it.w / 2 - overhang - inset, -it.w / 2 + 4, it.w / 2 - 4)
    it.ay = Math.min(it.h / 2, 18) - it.h / 2
  }

  function measureItems() {
    const sy = window.scrollY
    for (const it of items) {
      if (it.state !== 'pending') continue
      const r = it.el.getBoundingClientRect()
      it.left = r.left
      it.top = r.top + sy
      it.w = r.width
      it.h = r.height
    }
    items.sort((a, b) => a.top - b.top || a.left - b.left)
    items.forEach((it, k) => it.state === 'pending' && !it.box && plan(it, k))
  }

  function applyStart(it: Item) {
    if (it.box) it.el.classList.add('box-wait')
    else {
      const p = poseOf(it, 1)
      it.el.style.transform = transformOf(p.tx, p.ty, p.rot, p.s)
    }
  }

  // ---- Queue ----------------------------------------------------------------------------------------
  const queue: Item[] = []
  let nextStart = 0
  let lastScroll = performance.now()
  let lastWork = performance.now()

  function place(it: Item, instant: boolean, now: number) {
    if (it.state === 'placed') return
    const owner = cursors.find((c) => c.job?.item === it)
    it.el.style.transform = ''
    it.el.style.willChange = ''
    it.el.classList.remove('held', 'box-wait')
    it.el.style.removeProperty('--grab')
    it.state = 'placed'
    const qi = queue.indexOf(it)
    if (qi >= 0) queue.splice(qi, 1)
    if (it.log) {
      it.log.placedAt = Math.round(now)
      it.log.instant = instant
    } else if (LOG && !it.box) {
      window.__buildLog!.push({id: it.id, cursor: '-', dx: 0, dy: 0, rot: 0, queuedAt: Math.round(it.queuedAt || now), startAt: -1, placedAt: Math.round(now), goMs: 0, carryMs: 0, instant})
    }
    if (owner) {
      owner.job = null
      setGrab(owner, false)
      afterJob(owner, now)
    }
    lastWork = now
  }

  // Queue what has come within reach; place at once what has already gone past.
  function scan(now: number) {
    const sy = window.scrollY
    const atBottom = sy + vh >= document.documentElement.scrollHeight - 2
    const line = sy + vh * (atBottom ? 1 : QUEUE_LINE)
    for (const it of items) {
      if (it.state !== 'pending' || it.top > line) continue
      if (it.top + it.h < sy) {
        place(it, true, now)
        continue
      }
      if (it.box) {
        place(it, false, now) // the container fades in (CSS transition on opacity)
        continue
      }
      it.state = 'queued'
      it.queuedAt = now
      queue.push(it)
    }
    // Queued or moving elements whose slot has left the view are placed at once.
    for (const it of items) {
      if (it.state !== 'queued' && it.state !== 'active') continue
      if (it.top + it.h < sy || it.top > sy + vh) place(it, true, now)
    }
  }

  // ---- Jobs -------------------------------------------------------------------------------------------
  function pickupView(it: Item): Point {
    const p = poseOf(it, 1)
    const g = grabPoint(it, p.tx, p.ty, p.rot, p.s)
    return {x: g.x, y: g.y - window.scrollY}
  }

  function setGrab(c: Cursor, on: boolean) {
    if (c.grabbing === on) return
    c.grabbing = on
    c.el.classList.toggle('grab', on)
  }

  function startJob(c: Cursor, it: Item, now: number) {
    const target = pickupView(it)
    const d = Math.hypot(target.x - c.x, target.y - c.y)
    // While the page is scrolling the element is on screen for about a second only: the quick end of each range.
    const scrolling = now - lastScroll < 150
    const goMs = scrolling ? GO_MS[0] : lerp(GO_MS[0], GO_MS[1], clamp(d / 900, 0, 1))
    const carryMs = scrolling ? CARRY_MS[0] : lerp(CARRY_MS[0], CARRY_MS[1], clamp(Math.hypot(it.dx, it.dy) / (vw * 0.6), 0, 1))
    c.job = {item: it, phase: 'go', t0: now, from: {x: c.x, y: c.y}, goMs, carryMs}
    c.move = null
    c.mode = 'job'
    it.state = 'active'
    it.el.style.willChange = 'transform' // its own layer before it moves
    it.el.style.setProperty('--grab', c.colour)
    if (LOG) {
      it.log = {
        id: it.id,
        cursor: c.label,
        dx: Math.round(it.dx),
        dy: Math.round(it.dy),
        rot: +it.rot.toFixed(1),
        queuedAt: Math.round(it.queuedAt),
        startAt: Math.round(now),
        placedAt: 0,
        goMs: Math.round(goMs),
        carryMs: Math.round(carryMs),
        instant: false,
      }
      window.__buildLog!.push(it.log)
      if (DEBUG) {
        console.info(
          `[build] ${it.id} <- ${c.label}: start offset dx ${it.log.dx}px dy ${it.log.dy}px ` +
            `(${((Math.abs(it.dx) / vw) * 100).toFixed(0)}% of the width), rot ${it.log.rot}deg, scale ${START_SCALE}; ` +
            `go ${it.log.goMs} ms, carry ${it.log.carryMs} ms`,
        )
      }
    }
  }

  function afterJob(c: Cursor, now: number) {
    c.mode = 'standby'
    if (queue.length > 0) return // the assigner hands it the next job in this frame
    c.move = {from: {x: c.x, y: c.y}, to: () => standbyPoint(c), t0: now, ms: STANDBY_MS, then: 'standby'}
    c.mode = 'moving'
  }

  function assign(now: number) {
    while (queue.length > 0 && now >= nextStart) {
      const free = cursors.filter((c) => c.mode !== 'job')
      if (free.length === 0) return
      const it = queue[0]
      const target = pickupView(it)
      // The nearest free cursor of the pool; a helper only when the whole pool is busy.
      const distance = (c: Cursor) => Math.hypot(c.x - target.x, c.y - target.y) + (isHelper(c) ? 1e6 : 0)
      free.sort((a, b) => distance(a) - distance(b))
      queue.shift()
      startJob(free[0], it, now)
      nextStart = now + START_GAP_MS
    }
  }

  function stepJob(c: Cursor, now: number) {
    const job = c.job!
    const it = job.item
    if (job.phase === 'go') {
      const t = clamp((now - job.t0) / job.goMs, 0, 1)
      const target = pickupView(it)
      const e = easeInOut(t)
      c.x = lerp(job.from.x, target.x, e)
      c.y = lerp(job.from.y, target.y, e)
      if (t >= 1) {
        job.phase = 'grab'
        job.t0 = now
        setGrab(c, true)
        it.el.classList.add('held')
      }
      return
    }
    if (job.phase === 'grab') {
      const target = pickupView(it)
      c.x = target.x
      c.y = target.y
      if (now - job.t0 >= GRAB_MS) {
        job.phase = 'carry'
        job.t0 = now
      }
      return
    }
    // Carry: a quadratic curve that lifts a little, to just past the slot; then settle back into it.
    let tx: number
    let ty: number
    let rot: number
    let s: number
    if (job.phase === 'carry') {
      const t = clamp((now - job.t0) / job.carryMs, 0, 1)
      const e = easeInOut(t)
      const [ex, ey] = [-OVERSHOOT * it.dx, -OVERSHOOT * it.dy]
      const lift = Math.min(90, Math.abs(it.dx) * 0.16)
      const [cx, cy] = [it.dx * 0.45, it.dy * 0.5 - lift]
      tx = (1 - e) * (1 - e) * it.dx + 2 * (1 - e) * e * cx + e * e * ex
      ty = (1 - e) * (1 - e) * it.dy + 2 * (1 - e) * e * cy + e * e * ey
      rot = lerp(it.rot, -it.rot * 0.08, e)
      s = lerp(START_SCALE, 1.01, e)
      if (t >= 1) {
        job.phase = 'settle'
        job.t0 = now
      }
    } else {
      const t = clamp((now - job.t0) / SETTLE_MS, 0, 1)
      const e = easeOut(t)
      tx = lerp(-OVERSHOOT * it.dx, 0, e)
      ty = lerp(-OVERSHOOT * it.dy, 0, e)
      rot = lerp(-it.rot * 0.08, 0, e)
      s = lerp(1.01, 1, e)
      if (t >= 1) {
        place(it, false, now)
        return
      }
    }
    it.el.style.transform = transformOf(tx, ty, rot, s)
    const g = grabPoint(it, tx, ty, rot, s)
    c.x = g.x
    c.y = g.y - window.scrollY
  }

  // ---- Idle: park after a quiet moment; in the hero, drift and point ---------------------------------
  const hero = document.querySelector<HTMLElement>('.hero')
  const frame = document.querySelector<HTMLElement>('.frame')
  const panel = document.querySelector<HTMLElement>('.panel')
  let heroVisible = false
  let nextPoint = performance.now() + POINT_EVERY_MS
  let pointTurn = 0

  function idle(now: number) {
    const working = queue.length > 0 || cursors.some((c) => c.mode === 'job')
    if (working) return
    if (now - Math.max(lastScroll, lastWork) > QUIET_MS) {
      for (const c of cursors) {
        if (c.mode === 'standby' || (c.mode === 'moving' && c.move?.then === 'standby')) {
          c.move = {from: {x: c.x, y: c.y}, to: () => parkPoint(c.slot), t0: now, ms: PARK_MS, then: 'parked'}
          c.mode = 'moving'
        }
      }
    }
    // Pointing: in the hero only, with visible parking and every cursor at rest.
    if (!heroVisible || gutterX === null || document.hidden || now < nextPoint) return
    if (!cursors.every((c) => c.mode === 'parked')) return
    nextPoint = now + POINT_EVERY_MS
    const perSide = Math.ceil(base / 2)
    const right = cursors.filter((c) => c.slot >= perSide && !isHelper(c)) // the right column never crosses the hero's text
    if (right.length === 0) return
    const c = right[Math.floor(noise(now) * right.length)]
    const atPanel = pointTurn++ % 2 === 1 && panel !== null
    const r = (atPanel ? panel : frame)?.getBoundingClientRect()
    if (!r) return
    // The tip rests on the picture's right edge, or on the panel's swatch column; the arrow and its chip (kept on
    // the arrow's right while pointing) lie over the photo, never over text.
    const to: Point = atPanel
      ? {x: r.right - 9, y: r.top + r.height * 0.55}
      : {x: r.right - 10, y: r.top + r.height * (0.3 + 0.4 * noise(now + 1))}
    c.move = {from: {x: c.x, y: c.y}, to: () => to, t0: now, ms: POINT_MOVE_MS, then: 'pointing'}
    c.mode = 'moving'
  }

  function stepMove(c: Cursor, now: number) {
    const m = c.move!
    const t = clamp((now - m.t0) / m.ms, 0, 1)
    const e = easeInOut(t)
    const to = m.to()
    c.x = lerp(m.from.x, to.x, e)
    c.y = lerp(m.from.y, to.y, e)
    if (t < 1) return
    c.move = null
    if (m.then === 'pointing') {
      c.mode = 'pointing'
      c.holdUntil = now + POINT_HOLD_MS
    } else if (m.then === 'back' || m.then === 'parked') c.mode = 'parked'
    else c.mode = 'standby'
  }

  // ---- Paint ------------------------------------------------------------------------------------------
  function paint(c: Cursor, now: number) {
    let {x, y} = c
    if (c.mode === 'parked' && heroVisible && gutterX !== null && !isHelper(c)) {
      // A little life while waiting in the hero: a slow drift of a few pixels.
      x += Math.sin(now / 900 + c.slot * 1.3) * 3
      y += Math.cos(now / 1100 + c.slot * 1.7) * 4
    }
    c.el.style.transform = `translate3d(${(x - TIP).toFixed(1)}px, ${(y - TIP).toFixed(1)}px, 0)`
    const pointing = c.mode === 'pointing' || c.move?.then === 'pointing' || c.move?.then === 'back'
    const flip = x > vw / 2 && !pointing
    if (flip !== c.flipped) {
      c.flipped = flip
      c.el.classList.toggle('flip', flip)
    }
  }

  // ---- The loop: one requestAnimationFrame loop, stopped when nothing moves -----------------------------
  let raf = 0
  function wake() {
    if (!raf) raf = requestAnimationFrame(tick)
  }

  function tick(now: number) {
    raf = 0
    scan(now)
    assign(now)
    let busy = queue.length > 0
    for (const c of cursors) {
      if (c.mode === 'job' && c.job) {
        stepJob(c, now)
        busy = true
      } else if (c.move) {
        stepMove(c, now)
        busy = true
      } else if (c.mode === 'pointing') {
        busy = true
        if (now >= c.holdUntil) {
          c.move = {from: {x: c.x, y: c.y}, to: () => parkPoint(c.slot), t0: now, ms: POINT_MOVE_MS, then: 'back'}
          c.mode = 'moving'
        }
      } else if (c.mode === 'standby') busy = true // waits near the work until it is quiet
      paint(c, now)
    }
    idle(now)
    const heroLife = heroVisible && gutterX !== null && !document.hidden
    if (busy || heroLife) wake()
  }

  // ---- Start ------------------------------------------------------------------------------------------
  // Everything already above the queue line when the page opens stays as it is (the hero, and anything a
  // reload or a link scrolled into view).
  measureViewport()
  measureItems()
  {
    const line = window.scrollY + vh * QUEUE_LINE
    for (const it of items) {
      if (it.top <= line) it.state = 'placed'
      else applyStart(it)
    }
  }
  for (const c of cursors) {
    const p = parkPoint(c.slot)
    c.x = p.x
    c.y = p.y
    paint(c, 0)
  }

  if (hero) {
    new IntersectionObserver(
      ([entry]) => {
        heroVisible = entry.intersectionRatio > 0.35
        wake()
      },
      {threshold: [0, 0.35, 0.6]},
    ).observe(hero)
  }

  window.addEventListener(
    'scroll',
    () => {
      lastScroll = performance.now()
      wake()
    },
    {passive: true},
  )

  let resizeTimer = 0
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(() => {
      const now = performance.now()
      for (const it of items) if (it.state === 'queued' || it.state === 'active') place(it, true, now)
      for (const it of items) {
        if (it.state !== 'pending') continue
        it.el.style.transform = ''
        it.el.classList.remove('box-wait')
      }
      measureViewport()
      measureItems()
      for (const it of items) if (it.state === 'pending') applyStart(it)
      for (const c of cursors) {
        c.job = null
        setGrab(c, false)
        c.move = {from: {x: c.x, y: c.y}, to: () => parkPoint(c.slot), t0: now, ms: PARK_MS, then: 'parked'}
        c.mode = 'moving'
      }
      wake()
    }, 200)
  })

  // Keyboard focus never lands on an element that is not in its place: it, and its container, are placed at once.
  document.addEventListener('focusin', (event) => {
    const now = performance.now()
    let node: Element | null = event.target instanceof Element ? event.target : null
    while (node) {
      const it = items.find((i) => i.el === node)
      if (it) place(it, true, now)
      node = node.parentElement
    }
  })

  document.addEventListener('visibilitychange', wake)
  wake()
}
