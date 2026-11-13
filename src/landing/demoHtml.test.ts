import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {decodeBlobs} from '../code/blobCode'
import {DEMO_ASPECT, DEMO_STAGES} from './demo'
import {blobLines, fieldText, fillMarkers, lineColour, panelItems, spread} from './demoHtml'

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
