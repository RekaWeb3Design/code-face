import {describe, expect, it} from 'vitest'
import {P} from '../fitter/params'
import {blobWeight} from '../reference/blend'
import {readBlob} from '../reference/render'
import {blobEllipse, ellipseExtent, labelPlacement, spread, type Ellipse} from './blobGeometry'

// One blob: x, y, log_sx, log_sy, theta, r, g, b, a_raw.
const blob = (x: number, y: number, sx: number, sy: number, theta: number) =>
  Float32Array.from([x, y, Math.log(sx), Math.log(sy), theta, 1, 1, 1, 0])

// Where SVG puts a point (px, py) of the unrotated ellipse after rotate(angleDeg, cx, cy), y down.
function svgPoint(e: ReturnType<typeof blobEllipse>, px: number, py: number) {
  const a = (e.angleDeg * Math.PI) / 180
  return {x: e.cx + px * Math.cos(a) - py * Math.sin(a), y: e.cy + px * Math.sin(a) + py * Math.cos(a)}
}

describe('blobEllipse', () => {
  it('normalises by the long side on both axes, whatever the aspect ratio', () => {
    // Portrait 288x512: the long side is the height; x = 0.5625 is the right edge.
    const portrait = blobEllipse(blob(0.5625, 1, 0.01, 0.02, 0), 0, 512)
    expect(portrait.cx).toBeCloseTo(288, 3)
    expect(portrait.cy).toBeCloseTo(512, 3)
    // Landscape 512x341: the long side is the width, and the same scale applies to y.
    const landscape = blobEllipse(blob(1, 341 / 512, 0.01, 0.02, 0), 0, 512)
    expect(landscape.cx).toBeCloseTo(512, 3)
    expect(landscape.cy).toBeCloseTo(341, 3)
    // Radii: 2 sigma, in pixels of the long side, for both axes.
    expect(portrait.rx).toBeCloseTo(2 * 0.01 * 512, 3)
    expect(portrait.ry).toBeCloseTo(2 * 0.02 * 512, 3)
  })

  it('draws the same ellipse the fitter paints: every outline point is 2 sigma out, for any rotation', () => {
    const longSide = 512
    for (const theta of [0, 0.4, Math.PI / 2, -1.1, 2.7]) {
      const params = blob(0.4, 0.55, 0.06, 0.02, theta)
      const e = blobEllipse(params, 0, longSide)
      const b = readBlob(params, 0)
      for (let k = 0; k < 16; k++) {
        const t = (k / 16) * 2 * Math.PI
        const point = svgPoint(e, e.rx * Math.cos(t), e.ry * Math.sin(t))
        // The fitter's weight at that point is a * exp(-0.5 * 4): exactly 2 standard deviations.
        const w = blobWeight(point.x / longSide - b.x, point.y / longSide - b.y, b, Infinity)
        expect(w / b.a).toBeCloseTo(Math.exp(-2), 6)
      }
    }
  })

  it('turns from the x axis towards the y axis: a positive angle points the long axis down-right on screen', () => {
    const e = blobEllipse(blob(0.5, 0.5, 0.05, 0.01, 0.5), 0, 512)
    const end = svgPoint(e, e.rx, 0)
    expect(end.x).toBeGreaterThan(e.cx)
    expect(end.y).toBeGreaterThan(e.cy)
    expect(e.angleDeg).toBeCloseTo((0.5 * 180) / Math.PI, 9)
  })

  it('reads the right blob from a params array', () => {
    const params = new Float32Array(3 * P)
    params.set(blob(0.1, 0.2, 0.01, 0.01, 0), 0)
    params.set(blob(0.7, 0.3, 0.01, 0.01, 0), 2 * P)
    expect(blobEllipse(params, 2, 100).cx).toBeCloseTo(70, 4)
  })
})

describe('spread', () => {
  it('picks up to max evenly spaced indices', () => {
    expect(spread(5, 60)).toEqual([0, 1, 2, 3, 4])
    const picked = spread(2207, 60)
    expect(picked.length).toBe(60)
    expect(new Set(picked).size).toBe(60)
    expect(picked[0]).toBeGreaterThanOrEqual(0)
    expect(picked.at(-1)).toBeLessThan(2207)
  })
})

describe('labelPlacement', () => {
  const [W, H, f] = [288, 512, 512 / 30]
  const chars = 'blob 12345'.length
  // The label's box, from the same metrics the function assumes.
  const box = (p: {x: number; y: number}) => ({
    left: p.x - (chars * 0.6 * f) / 2,
    right: p.x + (chars * 0.6 * f) / 2,
    top: p.y - 0.8 * f,
    bottom: p.y + 0.25 * f,
  })

  it('keeps the label inside the picture wherever the blob is, even past the edges', () => {
    for (const cx of [-40, 0, 5, 60, 144, 280, 288, 330]) {
      for (const cy of [-40, 0, 8, 100, 256, 505, 512, 560]) {
        for (const r of [1, 20, 90, 400]) {
          for (const angleDeg of [0, 33, 90]) {
            const b = box(labelPlacement({cx, cy, rx: r, ry: r / 2, angleDeg}, W, H, f, chars))
            expect(b.left).toBeGreaterThanOrEqual(0)
            expect(b.right).toBeLessThanOrEqual(W)
            expect(b.top).toBeGreaterThanOrEqual(0)
            expect(b.bottom).toBeLessThanOrEqual(H)
          }
        }
      }
    }
  })

  it('puts the label above the blob when there is room, else below it', () => {
    const e: Ellipse = {cx: 144, cy: 256, rx: 20, ry: 10, angleDeg: 0}
    expect(box(labelPlacement(e, W, H, f, chars)).bottom).toBeLessThan(256 - 10)
    const nearTop: Ellipse = {...e, cy: 15}
    expect(box(labelPlacement(nearTop, W, H, f, chars)).top).toBeGreaterThan(15 + 10)
  })

  it('measures a turned ellipse by its bounding box', () => {
    const {hx, hy} = ellipseExtent({cx: 0, cy: 0, rx: 10, ry: 2, angleDeg: 90})
    expect(hx).toBeCloseTo(2)
    expect(hy).toBeCloseTo(10)
  })
})
