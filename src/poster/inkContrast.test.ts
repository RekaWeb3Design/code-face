import {describe, expect, it} from 'vitest'
import {contrast, darkenForPaper, hexRgb, luminance, MIN_CONTRAST, paleCount, paperInk} from './inkContrast'

const PAPER = '#f3eee3'
const paper = luminance(...hexRgb(PAPER))

describe('paperInk', () => {
  const ink = paperInk(PAPER)

  it('gives every colour at least 3:1 against the paper', () => {
    let worst = Infinity
    for (let r = 0; r < 256; r += 3)
      for (let g = 0; g < 256; g += 3)
        for (let b = 0; b < 256; b += 3) worst = Math.min(worst, contrast(luminance(...ink(r, g, b)), paper))
    for (const [r, g, b] of [[255, 255, 255], [243, 238, 227], [255, 255, 0], [0, 255, 255]])
      worst = Math.min(worst, contrast(luminance(...ink(r, g, b)), paper))
    expect(worst).toBeGreaterThanOrEqual(MIN_CONTRAST)
  })

  it('leaves colours that already contrast enough exactly as they are', () => {
    expect(ink(0, 0, 0)).toEqual([0, 0, 0])
    expect(ink(35, 33, 29)).toEqual([35, 33, 29]) // the plain ink
    expect(ink(120, 40, 30)).toEqual([120, 40, 30])
  })

  it('keeps the hue: a pale colour only gets darker, in the same proportions', () => {
    const [r, g, b] = ink(250, 200, 150)
    expect(r).toBeLessThan(250)
    expect(r).toBeGreaterThan(g)
    expect(g).toBeGreaterThan(b)
    expect(ink(255, 255, 255).every((c, _, all) => c === all[0])).toBe(true) // white becomes a grey
  })
})

describe('darkenForPaper and paleCount', () => {
  it('counts the pixels under 3:1 against the paper, and none are left after darkening', () => {
    const data = new Uint8ClampedArray([255, 255, 255, 255, 250, 200, 150, 255, 10, 20, 30, 255])
    expect(paleCount(data, PAPER)).toBe(2)
    darkenForPaper(data, PAPER)
    expect(paleCount(data, PAPER)).toBe(0)
  })

  it('darkens a picture in place, pixel by pixel, leaving alpha alone', () => {
    const data = new Uint8ClampedArray([255, 255, 255, 255, 10, 20, 30, 255])
    darkenForPaper(data, PAPER)
    expect(contrast(luminance(data[0], data[1], data[2]), paper)).toBeGreaterThanOrEqual(MIN_CONTRAST)
    expect([...data.slice(4)]).toEqual([10, 20, 30, 255])
    expect(data[3]).toBe(255)
  })
})
