// Build time only (used by vite.config.ts): HTML pieces of the landing page made from the real demo code
// files, so the page's code lines are in the HTML from the start, before any script runs.
// Colours are SVG fill attributes, not inline styles: the landing's CSP has no 'unsafe-inline'.

const LINE = /^[0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{3} [0-9a-f]{3} [0-9a-f]{3} [0-9a-f]{6} [0-9a-f]{2}$/
const HEADER_LINES = 4

// The blob lines of a code file (index 0 is blob 1). Throws on anything that is not a blob line, so the
// page can only ever show real lines.
export function blobLines(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n').slice(HEADER_LINES)
  lines.forEach((line, i) => {
    if (!LINE.test(line)) throw new Error(`demo file: line ${i + HEADER_LINES + 1} is not a blob line`)
  })
  return lines
}

export const lineColour = (line: string) => line.slice(-9, -3)

export const blobNumber = (index: number) => String(index + 1).padStart(4, ' ')

export const swatch = (colour: string) =>
  `<svg class="sw" viewBox="0 0 1 1" aria-hidden="true" focusable="false"><rect width="1" height="1" fill="#${colour}"/></svg>`

// One line of the hero's live panel.
export const panelItem = (lines: readonly string[], index: number) =>
  `<li data-blob="${index}"><span class="ln">${blobNumber(index)}</span><code>${lines[index]}</code>${swatch(lineColour(lines[index]))}</li>`

// The hero panel's default lines: the newest `count` blobs of the file.
export function panelItems(lines: readonly string[], count: number): string {
  const start = Math.max(0, lines.length - count)
  return lines
    .slice(start)
    .map((_, k) => panelItem(lines, start + k))
    .join('\n')
}

// The faint field of code behind the hero: `rows` rows of `perRow` consecutive lines each.
export function fieldText(lines: readonly string[], rows: number, perRow: number): string {
  const out: string[] = []
  const step = Math.max(1, Math.floor(lines.length / (rows * perRow)))
  for (let r = 0; r < rows; r++) {
    const row: string[] = []
    for (let k = 0; k < perRow; k++) row.push(lines[((r * perRow + k) * step) % lines.length])
    out.push(row.join('   '))
  }
  return out.join('\n')
}

// Evenly spaced blob indices, for samples of a file.
export const spread = (total: number, count: number) =>
  Array.from({length: count}, (_, k) => Math.floor(((k + 0.5) * total) / count))

// Replaces each <!--demo:name--> marker; a marker without a value is an error.
export function fillMarkers(html: string, values: Record<string, string>): string {
  return html.replace(/<!--demo:([a-z-]+)-->/g, (_, name: string) => {
    if (!(name in values)) throw new Error(`index.html: no value for <!--demo:${name}-->`)
    return values[name]
  })
}

// Data for the build cursors' chips: blob number and colour of real lines spread over the file, skipping
// the darkest colours (a chip should stand out on the dark page).
export function chipData(lines: readonly string[], count: number): string {
  const bright = (index: number) => Math.max(...[0, 2, 4].map((k) => parseInt(lineColour(lines[index]).slice(k, k + 2), 16))) >= 0x60
  const candidates = spread(lines.length, count * 6).filter(bright)
  return spread(candidates.length, count)
    .map((k) => candidates[k])
    .map((index) => `<i data-blob="${index}" data-colour="${lineColour(lines[index])}"></i>`)
    .join('')
}

// Section 02: one real line taken apart, field by field, with what each field means.
export function anatomyHtml(lines: readonly string[], index: number): string {
  const line = lines[index]
  const names = ['x', 'y', 'w', 'h', 'ang', 'colour', 'op']
  const fields = line
    .split(' ')
    .map(
      (value, k) =>
        `<span class="fld f-${names[k]}"><code>${value}</code>${k === 5 ? swatch(value) : ''}<span class="fname">${names[k]}</span></span>`,
    )
    .join('')
  return [
    `<p class="anatomy-head">One line is one blob. This is blob ${index + 1} of the demo:</p>`,
    `<p class="ruler">${fields}</p>`,
    `<dl class="legend">`,
    `<div><dt>x y</dt><dd>where its centre sits, as a fraction of the picture's long side</dd></div>`,
    `<div><dt>w h</dt><dd>its size along its own two axes, on a log scale</dd></div>`,
    `<div><dt>ang</dt><dd>which way it is turned, 0 to 180 degrees</dd></div>`,
    `<div><dt>colour</dt><dd>red, green and blue, two hex digits each</dd></div>`,
    `<div><dt>op</dt><dd>how opaque it is, from 00 to ff</dd></div>`,
    `</dl>`,
  ].join('\n')
}

// Section 02: real lines to copy, one button each.
export function copyLinesHtml(lines: readonly string[], indices: readonly number[]): string {
  return indices
    .map((index) => {
      const line = lines[index]
      return (
        // The accessible name is the visible text with "Copy the line of blob" in front (label in name).
        `<li><button type="button" class="copy-line" data-blob="${index}" data-line="${line}">` +
        `<span class="sr-only">Copy the line of blob </span><span class="ln">${blobNumber(index)}</span> ` +
        `<code>${line}</code>${swatch(lineColour(line))}<span class="copied" aria-hidden="true">copied</span></button></li>`
      )
    })
    .join('\n')
}

// Section 01, card 3: the measured mistake of each demo stage against its blob count, both on log scales.
export function mistakeChart(stages: readonly {blobs: number; mistake: number}[]): string {
  const [x0, x1, y0, y1] = [26, 226, 18, 84]
  const lx = stages.map((s) => Math.log2(s.blobs))
  const ly = stages.map((s) => Math.log10(s.mistake))
  const [ax, bx] = [Math.min(...lx), Math.max(...lx)]
  const [ay, by] = [Math.max(...ly), Math.min(...ly)]
  const px = (v: number) => (x0 + ((v - ax) / (bx - ax)) * (x1 - x0)).toFixed(1)
  const py = (v: number) => (y0 + ((v - ay) / (by - ay)) * (y1 - y0)).toFixed(1)
  const points = stages.map((_, k) => `${px(lx[k])},${py(ly[k])}`)
  const pct = (m: number) => `${(m * 100).toFixed(2)}%`
  const first = stages[0]
  const last = stages[stages.length - 1]
  return [
    `<svg class="chart" viewBox="0 0 240 120" focusable="false">`,
    `<line class="axis" x1="${x0}" y1="100" x2="${x1}" y2="100"/>`,
    `<polyline class="curve" points="${points.join(' ')}"/>`,
    ...points.map((p) => `<circle class="dot" cx="${p.split(',')[0]}" cy="${p.split(',')[1]}" r="3"/>`),
    `<text class="lbl" x="${x0}" y="114">${first.blobs} blobs</text>`,
    `<text class="lbl" x="${x1}" y="114" text-anchor="end">${last.blobs.toLocaleString('en-US')}</text>`,
    `<text class="lbl val" x="${px(lx[0])}" y="${Number(py(ly[0])) - 8}">${pct(first.mistake)}</text>`,
    `<text class="lbl val" x="${Number(px(lx[lx.length - 1])) - 8}" y="${Number(py(ly[ly.length - 1])) + 12}" text-anchor="end">${pct(last.mistake)}</text>`,
    `</svg>`,
  ].join('')
}
