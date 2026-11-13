import {describe, expect, it} from 'vitest'
import {encodeBlobs} from '../code/blobCode'
import {P} from '../fitter/params'
import {codeLines, layoutFor, posterFooter, type PosterOptions} from './drawPoster'
import {svgPoster} from './svgPoster'

// A real code file of `count` blobs.
function codeFile(count: number) {
  const params = new Float32Array(count * P)
  for (let i = 0; i < count; i++) params.set([(i % 97) / 97, (i % 89) / 89, -5, -4.5, i, 0.2, 0.5, 0.8, 1], i * P)
  return encodeBlobs({params, count, seed: 7, width: 288, height: 512, bg: [0.1, 0.2, 0.3]})
}

const font = {family: 'Code Face Mono', charAspect: 0.6, ascent: 1020 / 1320, dataUrl: 'data:font/woff2;base64,AAAA'}
const options = (more: Partial<PosterOptions> = {}): PosterOptions => ({
  frame: 'a4',
  orientation: 'portrait',
  style: 'plain',
  background: 'dark',
  format: 'svg',
  ...more,
})
const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const texts = (svg: string) => [...svg.matchAll(/<text x="([^"]+)" y="([^"]+)"[^>]*>([^<]*)<\/text>/g)]

describe('svgPoster', () => {
  const text = codeFile(500)
  const {header, blobs} = codeLines(text)

  it('has one <text> per code line, in file order, at the PNG layout positions, plus the footer', () => {
    const svg = svgPoster({text, options: options(), count: 500, seed: 7, font, picture: null}).join('')
    const found = texts(svg)
    const lines = [...header, ...blobs]
    expect(found.length).toBe(lines.length + 1)
    const layout = layoutFor(text, options(), font.charAspect)
    lines.forEach((line, i) => {
      expect(unescape(found[i][3])).toBe(line)
      expect(Number(found[i][1])).toBeCloseTo(layout.lines[i].x, 1)
      // The PNG places a line's top; the SVG its baseline, the font's ascent lower.
      expect(Number(found[i][2])).toBeCloseTo(layout.lines[i].y + font.ascent * layout.fontPx, 1)
    })
    expect(found[lines.length][3]).toBe(posterFooter(500, 7))
  })

  it('plain: text in the ink colour, no picture', () => {
    const svg = svgPoster({text, options: options(), count: 500, seed: 7, font, picture: null}).join('')
    expect(svg).toContain('<g fill="#d9d9d4"')
    expect(svg).not.toContain('<image')
    expect(svg).not.toContain('clipPath')
  })

  it('tinted: one picture, seen through the code as its clip path, on the chosen background', () => {
    const picture = {dataUrl: 'data:image/jpeg;base64,BBBB'}
    const svg = svgPoster({
      text,
      options: options({style: 'tinted', background: 'paper'}),
      count: 500,
      seed: 7,
      font,
      picture,
    }).join('')
    expect(svg.match(/<image /g)?.length).toBe(1)
    expect(svg).toContain('clip-path="url(#code)"')
    expect(svg).toContain(`xlink:href="${picture.dataUrl}"`)
    expect(svg).toContain('fill="#f3eee3"')
    // Every code line is inside the clip path; only the footer is outside it.
    const clip = svg.slice(svg.indexOf('<clipPath'), svg.indexOf('</clipPath>'))
    expect(texts(clip).length).toBe(header.length + blobs.length)
  })

  it('embeds the font with its licence in a well-formed comment, and sizes the page in mm', () => {
    const svg = svgPoster({text, options: options({orientation: 'landscape'}), count: 500, seed: 7, font, picture: null}).join('')
    expect(svg).toContain(`src:url(${font.dataUrl}) format('woff2')`)
    const comment = svg.slice(svg.indexOf('<!--') + 4, svg.indexOf('-->'))
    expect(comment).toContain('SIL Open Font License')
    expect(comment).toContain('Copyright 2020 The JetBrains Mono Project Authors')
    expect(comment).not.toContain('--')
    expect(svg).toContain('width="297mm" height="210mm" viewBox="0 0 3508 2480"')
  })

  it('escapes markup characters', () => {
    const svg = svgPoster({text: text.replace('Re-painted', 'a < b & c'), options: options(), count: 500, seed: 7, font, picture: null}).join('')
    expect(svg).toContain('a &lt; b &amp; c')
  })
})
