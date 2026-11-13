import {describe, expect, it} from 'vitest'
import {encodeBlobs} from '../code/blobCode'
import {P} from '../fitter/params'
import {codeLines, layoutFor} from './drawPoster'
import {FRAMES, framePixels, maxBlobsForPt, posterLayout, ptToPx, type FrameId, type Orientation} from './layout'

// The real shapes of a code file: 4 header lines (the longest 48 characters), 31-character blob lines.
const shape = {headerLines: 4, headerChars: 48, blobChars: 31, charAspect: 0.6}
const frames = Object.keys(FRAMES) as FrameId[]
const orientations: Orientation[] = ['portrait', 'landscape']
const counts = [1, 32, 1000, 2048, 8000, 20000, 50000]

describe('framePixels', () => {
  it('gives the 300 dpi pixel size of each frame', () => {
    expect(framePixels('a4', 'portrait')).toEqual({width: 2480, height: 3508})
    expect(framePixels('a3', 'landscape')).toEqual({width: 4961, height: 3508})
    expect(framePixels('30x40', 'portrait')).toEqual({width: 3543, height: 4724})
    expect(framePixels('50x70', 'portrait')).toEqual({width: 5906, height: 8268})
  })
})

describe('posterLayout', () => {
  for (const frame of frames) {
    for (const orientation of orientations) {
      it(`${frame} ${orientation}: places every line, none clipped, all inside the margins`, () => {
        const size = framePixels(frame, orientation)
        for (const blobLines of counts) {
          const layout = posterLayout({...size, ...shape, blobLines})
          const {textArea, lines, charWidthPx, lineHeightPx, fontPx} = layout
          expect(lines.length).toBe(shape.headerLines + blobLines)
          expect(fontPx).toBeGreaterThan(0)
          const right = textArea.x + textArea.width
          const bottom = textArea.y + textArea.height
          lines.forEach((line, i) => {
            const chars = i < shape.headerLines ? shape.headerChars : shape.blobChars
            expect(line.x).toBeGreaterThanOrEqual(textArea.x - 1e-6)
            expect(line.y).toBeGreaterThanOrEqual(textArea.y - 1e-6)
            expect(line.x + chars * charWidthPx).toBeLessThanOrEqual(right + 1e-6)
            expect(line.y + lineHeightPx).toBeLessThanOrEqual(bottom + 1e-6)
          })
          // The margins are real: the text area sits inside the frame with room on every side.
          expect(textArea.x).toBeGreaterThan(0)
          expect(right).toBeLessThan(size.width)
          expect(bottom).toBeLessThan(layout.footer.y)
          expect(layout.footer.y + layout.footer.fontPx).toBeLessThan(size.height)
        }
        // About 2 s alone (up to 57,000 lines checked one by one); more when the whole suite runs in parallel.
      }, 30000)
    }
  }

  it('keeps file order: down a column, then the next; no two lines on the same spot', () => {
    const layout = posterLayout({...framePixels('a3', 'portrait'), ...shape, blobLines: 8000})
    const blobs = layout.lines.slice(shape.headerLines)
    const seen = new Set<string>()
    for (let j = 0; j < blobs.length; j++) {
      const key = `${blobs[j].x.toFixed(3)},${blobs[j].y.toFixed(3)}`
      expect(seen.has(key)).toBe(false)
      seen.add(key)
      if (j > 0 && j % layout.rowsPerColumn !== 0) {
        expect(blobs[j].x).toBe(blobs[j - 1].x) // same column, one row down
        expect(blobs[j].y).toBeGreaterThan(blobs[j - 1].y)
      } else if (j > 0) {
        expect(blobs[j].x).toBeGreaterThan(blobs[j - 1].x) // next column, back at the top
      }
    }
    // Columns do not overlap: each starts after the previous one ends.
    const xs = [...new Set(blobs.map((line) => line.x))]
    for (let k = 1; k < xs.length; k++) expect(xs[k] - xs[k - 1]).toBeGreaterThanOrEqual(31 * layout.charWidthPx)
  })

  it('never makes the type larger when there are more blobs', () => {
    for (const frame of frames) {
      for (const orientation of orientations) {
        const size = framePixels(frame, orientation)
        let previous = Infinity
        for (let blobLines = 1; blobLines <= 50000; blobLines = Math.ceil(blobLines * 1.07)) {
          const {fontPx} = posterLayout({...size, ...shape, blobLines})
          expect(fontPx).toBeLessThanOrEqual(previous)
          previous = fontPx
        }
      }
    }
  })

  it('reports the type size in points (300 dpi)', () => {
    const layout = posterLayout({...framePixels('a4', 'portrait'), ...shape, blobLines: 8000})
    expect(layout.fontPt).toBeCloseTo((layout.fontPx * 72) / 300, 9)
    expect(ptToPx(12)).toBe(50)
  })

  it('finds the largest blob count that still gets the minimum type size', () => {
    const size = framePixels('a4', 'portrait')
    const n = maxBlobsForPt({...size, ...shape}, 5)
    expect(posterLayout({...size, ...shape, blobLines: n}).fontPt).toBeGreaterThanOrEqual(5)
    expect(posterLayout({...size, ...shape, blobLines: n + 1}).fontPt).toBeLessThan(5)
  })
})

describe('poster from a real code file', () => {
  const count = 2000
  const params = new Float32Array(count * P).map((_, k) => (k % P === 2 || k % P === 3 ? -5 : 0.5))
  const text = encodeBlobs({params, count, seed: 7, width: 288, height: 512, bg: [0.3, 0.2, 0.1]})

  it('draws exactly the lines of the file: the header and every blob line, in order', () => {
    const {header, blobs} = codeLines(text)
    expect([...header, ...blobs].join('\n') + '\n').toBe(text)
    expect(header.length).toBe(4)
    expect(blobs.length).toBe(count)
    const layout = layoutFor(text, {frame: 'a4', orientation: 'portrait', style: 'plain', background: 'dark', format: 'png'}, 0.6)
    expect(layout.lines.length).toBe(4 + count)
  })
})
