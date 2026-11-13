import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {decodeBlobs} from '../code/blobCode'
import {DEMO_ASPECT, DEMO_BACKGROUND, DEMO_STAGES, HERO_LAST} from './demo'
import {blobLines, fieldText, fillMarkers, lineColour, panelItems, spread} from './demoHtml'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const demoFile = (file: string) => readFileSync(resolve(import.meta.dirname, '../../public', file.slice(1)), 'utf8')

describe('landing demo files', () => {
  it('are real code files with the blob counts and aspect the page expects', () => {
    for (const stage of DEMO_STAGES) {
      const picture = decodeBlobs(demoFile(stage.file))
      expect(picture.count).toBe(stage.blobs)
      expect(picture.aspect).toEqual(DEMO_ASPECT)
      expect(blobLines(demoFile(stage.file))).toHaveLength(stage.blobs)
    }
  })

  it('have mistakes that fall stage by stage', () => {
    const mistakes = DEMO_STAGES.map((s) => s.mistake)
    expect([...mistakes].sort((a, b) => b - a)).toEqual(mistakes)
  })
})

describe('landing HTML from the demo files', () => {
  const lines = blobLines(demoFile('/demo/stage-00032.txt'))

  it('makes panel lines of real blobs, numbered from 1, with their colour', () => {
    const html = panelItems(lines, 3)
    expect(html.split('\n')).toHaveLength(3)
    expect(html).toContain(`<span class="ln">  32</span><code>${lines[31]}</code>`)
    expect(html).toContain(`fill="#${lineColour(lines[31])}"`)
    expect(html).not.toContain('style=')
  })

  it('makes a field of rows of real lines', () => {
    const rows = fieldText(lines, 4, 3).split('\n')
    expect(rows).toHaveLength(4)
    for (const row of rows) for (const line of row.split('   ')) expect(lines).toContain(line)
  })

  it('spreads samples over the file', () => {
    expect(spread(8000, 4)).toEqual([1000, 3000, 5000, 7000])
  })

  it('refuses a marker it has no value for and lines that are not blob lines', () => {
    expect(fillMarkers('a<!--demo:x-->b', {x: '1'})).toBe('a1b')
    expect(() => fillMarkers('<!--demo:y-->', {})).toThrow()
    expect(() => blobLines('CODE FACE 1\n-\n-\n-\nnot a line\n')).toThrow()
  })
})

describe('landing page and demo data agree', () => {
  const css = read('src/landing/landing.css')
  const html = read('index.html')
  const [w, h] = DEMO_ASPECT
  const long = Math.max(w, h)
  const loopEnd = DEMO_STAGES[HERO_LAST]
  const count = (n: number) => n.toLocaleString('en-US')

  it('frames and thumbnails have the aspect ratio and background of the demo', () => {
    expect(css).toContain(`aspect-ratio: ${w} / ${h};`)
    expect(css).not.toContain('aspect-ratio: 512 / 341')
    expect(css.toLowerCase()).toContain(`background: ${DEMO_BACKGROUND};`)
    const header = demoFile('/demo/stage-08000.txt').replace(/\r/g, '').split('\n')[2]
    expect(header).toContain(`background ${DEMO_BACKGROUND.slice(1)}`)
    expect(html).toContain(`viewBox="0 0 ${w / long} ${h / long}"`)
  })

  it('the hero starts on the last stage of the loop', () => {
    expect(html).toContain(`<dd id="count-blobs">${count(loopEnd.blobs)}</dd>`)
    expect(html).toContain(`<dd id="count-mistake">${(loopEnd.mistake * 100).toFixed(2)}%</dd>`)
    expect(html).toContain(`<span class="panel-count">${count(loopEnd.blobs)} blobs</span>`)
  })
})
