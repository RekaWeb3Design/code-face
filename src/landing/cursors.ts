// The cursors that build the sections below the hero. Each cursor is an arrow with a chip "blob N" in that
// blob's colour, taken from real lines of the demo file. Idle cursors wait, faint, in two columns at the
// viewport's left and right edges, only where the margin is wide enough not to cover any text.
//
// When a marked section ([data-build-section]) scrolls into view, each of its marked parts ([data-build])
// gets a cursor that flies to it and drags it from a small offset and turn into place; parts start 60 ms
// apart and a section takes about 0.6 s. Scrolling fast, or a section that is already passed, finishes it
// at once. Once per section per page load.
//
// Rules: transform and opacity only; one requestAnimationFrame loop that stops when nothing moves;
// native scrolling, never touched. Content is already in its place in the HTML: before a section is built
// its parts are only shifted and turned (transform), never faded, so the layout never moves and the text
// always keeps its full contrast.

const STAGGER_MS = 60
const FLY_MS = 190
const DRAG_MS = 250
const RETURN_MS = 320
const FAST_SCROLL = 2.2 // px per ms: faster than this, a section is finished at once
const PARKED_OPACITY = 0.38

type Chip = {blob: number; colour: string}

type Cursor = {
  el: HTMLElement
  x: number
  y: number
  fromX: number // where the current flight started
  fromY: number
  park: {x: number; y: number; visible: boolean; chip: boolean}
  move: {fromX: number; fromY: number; t0: number; ms: number; to: () => {x: number; y: number}} | null
  queue: Part[]
  busy: boolean
}

type Part = {
  el: HTMLElement
  dx: number
  dy: number
  rot: number
  // Grab point in document coordinates, measured untransformed when the section starts.
  ax: number
  ay: number
  start: number // planned start time
  phase: 'waiting' | 'fly' | 'drag' | 'done'
  t0: number
  cursor: Cursor | null
}

type Section = {el: HTMLElement; parts: Part[]; state: 'idle' | 'building' | 'built'}

const ease = (t: number) => 1 - (1 - t) ** 3
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

// Small deterministic offsets, different for every part.
function offsetFor(k: number): {dx: number; dy: number; rot: number} {
  const s = Math.sin(k * 12.9898 + 4.1) * 43758.5453
  const r = s - Math.floor(s)
  const side = k % 2 === 0 ? -1 : 1
  return {dx: side * (28 + 36 * r), dy: 26 + 22 * (1 - r), rot: side * (2.5 + 3.5 * r)}
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

export function initCursors(chips: readonly Chip[], count: number): void {
  const sections: Section[] = [...document.querySelectorAll<HTMLElement>('[data-build-section]')].map((el) => ({
    el,
    parts: [],
    state: 'idle',
  }))
  if (sections.length === 0 || chips.length === 0) return

  const layer = document.createElement('div')
  layer.className = 'cursors'
  layer.setAttribute('aria-hidden', 'true')
  const cursors: Cursor[] = chips.slice(0, count).map((chip) => {
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
    return {el, x: 0, y: 0, fromX: 0, fromY: 0, park: {x: 0, y: 0, visible: false, chip: false}, move: null, queue: [], busy: false}
  })
  document.body.append(layer)

  // ---- Parking -----------------------------------------------------------------------------------
  function placeParking() {
    const vw = document.documentElement.clientWidth
    const vh = window.innerHeight
    const gutter = Math.min(40, Math.max(16, vw * 0.04))
    const margin = Math.max(0, (vw - 1240) / 2) + gutter // free space beside the text
    const chip = margin >= 112
    const visible = margin >= 34
    const perSide = Math.ceil(cursors.length / 2)
    cursors.forEach((c, i) => {
      const right = i >= perSide
      const row = right ? i - perSide : i
      const y = vh * 0.2 + ((vh * 0.6) / Math.max(1, perSide - 1)) * row
      const x = right ? vw - 22 : 8
      c.park = {x: visible ? x : right ? vw + 30 : -60, y, visible, chip}
      c.el.classList.toggle('flip', right)
      if (!c.busy) {
        c.x = c.park.x
        c.y = c.park.y
        c.move = null
        paintCursor(c, false)
      }
    })
  }

  function paintCursor(c: Cursor, active: boolean) {
    c.el.style.transform = `translate3d(${c.x}px, ${c.y}px, 0)`
    c.el.classList.toggle('active', active)
    c.el.classList.toggle('no-chip', !active && !c.park.chip)
    c.el.style.opacity = active ? '1' : c.park.visible ? String(PARKED_OPACITY) : '0'
  }

  placeParking()
  window.addEventListener('resize', placeParking)

  // ---- Parts' starting state -----------------------------------------------------------------------
  // Sections already on screen or above it when the page opens stay as they are.
  const vh = window.innerHeight
  for (const section of sections) {
    const rect = section.el.getBoundingClientRect()
    if (rect.top < vh) {
      section.state = 'built'
      continue
    }
    section.parts = [...section.el.querySelectorAll<HTMLElement>('[data-build]')].map((el, k) => {
      const {dx, dy, rot} = offsetFor(k + sections.indexOf(section) * 7)
      el.style.transform = `translate(${dx}px, ${dy}px) rotate(${rot}deg)`
      return {el, dx, dy, rot, ax: 0, ay: 0, start: 0, phase: 'waiting', t0: 0, cursor: null}
    })
  }

  // ---- Scroll speed (a passive listener that only notes numbers) ------------------------------------
  let lastY = window.scrollY
  let lastT = performance.now()
  let speed = 0
  window.addEventListener(
    'scroll',
    () => {
      const now = performance.now()
      const dt = Math.max(1, now - lastT)
      speed = 0.6 * speed + 0.4 * (Math.abs(window.scrollY - lastY) / dt)
      lastY = window.scrollY
      lastT = now
    },
    {passive: true},
  )
  const scrollSpeed = () => (performance.now() - lastT > 120 ? 0 : speed)

  // ---- Building ----------------------------------------------------------------------------------
  function finish(section: Section) {
    for (const part of section.parts) {
      part.el.style.transform = ''
      part.el.style.willChange = ''
      part.phase = 'done'
      if (part.cursor) release(part.cursor, true)
    }
    for (const c of cursors) c.queue = c.queue.filter((p) => !section.parts.includes(p))
    section.state = 'built'
  }

  function start(section: Section, now: number) {
    section.state = 'building'
    // Where each part really sits, without writing anything first: the offset turns the part about its
    // centre and moves it by (dx, dy), so its box's centre minus (dx, dy) is the untransformed centre.
    const scrollY = window.scrollY
    for (const part of section.parts) {
      const r = part.el.getBoundingClientRect()
      const [w, h] = [part.el.offsetWidth, part.el.offsetHeight]
      const left = r.left + r.width / 2 - part.dx - w / 2
      const top = r.top + r.height / 2 - part.dy - h / 2
      part.ax = left + Math.min(36, w / 3)
      part.ay = top + scrollY + Math.min(18, h / 3)
    }
    section.parts.forEach((part, k) => {
      // Its own compositor layer while it moves, so moving it never repaints it.
      part.el.style.willChange = 'transform'
      part.start = now + k * STAGGER_MS
      const cursor = cursors[k % cursors.length]
      cursor.queue.push(part)
    })
    wake()
  }

  function release(c: Cursor, instant: boolean) {
    c.busy = false
    const next = c.queue[0]
    if (next && !instant) return
    if (instant) {
      c.x = c.park.x
      c.y = c.park.y
      c.move = null
      paintCursor(c, false)
      return
    }
    c.move = {fromX: c.x, fromY: c.y, t0: performance.now(), ms: RETURN_MS, to: () => c.park}
  }

  const view = (part: Part) => ({x: part.ax, y: part.ay - window.scrollY})

  let raf = 0
  function wake() {
    if (!raf) raf = requestAnimationFrame(tick)
  }

  function tick(now: number) {
    raf = 0
    let moving = false

    for (const section of sections) {
      if (section.state !== 'building') continue
      const r = section.el.getBoundingClientRect()
      if (r.bottom < 0 || r.top > window.innerHeight || scrollSpeed() > FAST_SCROLL) {
        finish(section)
        continue
      }
      if (section.parts.every((p) => p.phase === 'done')) section.state = 'built'
    }

    for (const c of cursors) {
      // Pick up the next part once it is due.
      if (!c.busy && c.queue.length > 0 && now >= c.queue[0].start) {
        const part = c.queue.shift()!
        part.cursor = c
        part.phase = 'fly'
        part.t0 = now
        c.busy = true
        c.move = null
        c.fromX = c.x
        c.fromY = c.y
      }
      const part = c.busy ? findPart(c) : null
      if (part) {
        moving = true
        const target = view(part)
        if (part.phase === 'fly') {
          const t = Math.min(1, (now - part.t0) / FLY_MS)
          const e = easeInOut(t)
          c.x = c.fromX + (target.x + part.dx - c.fromX) * e
          c.y = c.fromY + (target.y + part.dy - c.fromY) * e
          if (t >= 1) {
            part.phase = 'drag'
            part.t0 = now
          }
        } else if (part.phase === 'drag') {
          const t = Math.min(1, (now - part.t0) / DRAG_MS)
          const k = 1 - ease(t)
          part.el.style.transform = t >= 1 ? '' : `translate(${part.dx * k}px, ${part.dy * k}px) rotate(${part.rot * k}deg)`
          c.x = target.x + part.dx * k
          c.y = target.y + part.dy * k
          if (t >= 1) {
            part.el.style.willChange = ''
            part.phase = 'done'
            part.cursor = null
            release(c, false)
          }
        }
        paintCursor(c, true)
      } else if (c.move) {
        moving = true
        const t = Math.min(1, (now - c.move.t0) / c.move.ms)
        const e = easeInOut(t)
        const to = c.move.to()
        c.x = c.move.fromX + (to.x - c.move.fromX) * e
        c.y = c.move.fromY + (to.y - c.move.fromY) * e
        if (t >= 1) c.move = null
        paintCursor(c, t < 0.6)
      } else if (c.queue.length > 0) {
        moving = true // waiting for its next part's start time
      }
    }

    if (moving || sections.some((s) => s.state === 'building')) wake()
  }

  function findPart(c: Cursor): Part | null {
    for (const section of sections) {
      for (const part of section.parts) if (part.cursor === c && part.phase !== 'done') return part
    }
    return null
  }

  // ---- Trigger -----------------------------------------------------------------------------------
  const observer = new IntersectionObserver(
    (entries) => {
      const now = performance.now()
      for (const entry of entries) {
        const section = sections.find((s) => s.el === entry.target)
        if (!section || section.state !== 'idle') continue
        const passed = entry.boundingClientRect.bottom < 0
        if (!entry.isIntersecting && !passed) continue
        observer.unobserve(section.el)
        // Sections above this one that were jumped over (a link to #poster, say) are simply finished.
        for (const before of sections.slice(0, sections.indexOf(section))) {
          if (before.state === 'idle') {
            observer.unobserve(before.el)
            finish(before)
          }
        }
        if (passed || scrollSpeed() > FAST_SCROLL) finish(section)
        else start(section, now)
      }
    },
    {rootMargin: '0px 0px -30% 0px', threshold: 0},
  )
  for (const section of sections) if (section.state === 'idle') observer.observe(section.el)

  // Keyboard focus never lands on a part that is still out of place: the section is finished at once.
  document.addEventListener('focusin', (event) => {
    const section = sections.find((s) => s.state !== 'built' && s.el.contains(event.target as Node))
    if (!section) return
    observer.unobserve(section.el)
    finish(section)
  })
}
