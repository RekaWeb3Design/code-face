import {LOG_SX, LOG_SY, P, THETA, X, Y} from '../fitter/params'

// A blob as an ellipse in picture pixels (y down), ready for SVG:
// <ellipse cx cy rx ry transform="rotate(angleDeg cx cy)"/>.
export type Ellipse = {cx: number; cy: number; rx: number; ry: number; angleDeg: number}

// Blob `i` of a params array (9 floats per blob, positions and sizes as fractions of the long side)
// as the ellipse `sigmas` standard deviations out from its centre. rx lies along the blob's own first
// axis, which the fitter turns by theta from the x axis towards the y axis (downwards on screen).
export function blobEllipse(params: ArrayLike<number>, i: number, longSide: number, sigmas = 2): Ellipse {
  const o = i * P
  return {
    cx: params[o + X] * longSide,
    cy: params[o + Y] * longSide,
    rx: sigmas * Math.exp(params[o + LOG_SX]) * longSide,
    ry: sigmas * Math.exp(params[o + LOG_SY]) * longSide,
    angleDeg: (params[o + THETA] * 180) / Math.PI,
  }
}

// Up to `max` evenly spaced blobs of a params array.
export function spread(count: number, max: number): number[] {
  const n = Math.min(count, max)
  return Array.from({length: n}, (_, k) => Math.floor(((k + 0.5) * count) / n))
}

// Half the width and height of an ellipse's axis-aligned bounding box.
export function ellipseExtent(e: Ellipse): {hx: number; hy: number} {
  const a = (e.angleDeg * Math.PI) / 180
  const [c, s] = [Math.cos(a), Math.sin(a)]
  return {hx: Math.hypot(e.rx * c, e.ry * s), hy: Math.hypot(e.rx * s, e.ry * c)}
}

// Where the "blob N" label goes (centre x, baseline y), always wholly inside a width x height picture:
// above the blob if there is room, else below it, else as close as the frame allows. The label is
// `chars` monospace characters of `fontSize` (advance about 0.6 em, ascent 0.8 em, descent 0.25 em).
export function labelPlacement(
  e: Ellipse,
  width: number,
  height: number,
  fontSize: number,
  chars: number,
): {x: number; y: number} {
  const pad = fontSize * 0.3
  const ascent = fontSize * 0.8
  const descent = fontSize * 0.25
  const half = Math.min((chars * 0.6 * fontSize) / 2, width / 2 - pad)
  const {hy} = ellipseExtent(e)
  const gap = fontSize * 0.5
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi))
  const above = e.cy - hy - gap - descent
  const below = e.cy + hy + gap + ascent
  const top = pad + ascent // smallest baseline that keeps the label inside
  const bottom = height - pad - descent // largest
  const fits = (y: number) => y >= top && y <= bottom
  const y = fits(above) ? above : fits(below) ? below : clamp(above, top, bottom)
  return {x: clamp(e.cx, pad + half, width - pad - half), y}
}
