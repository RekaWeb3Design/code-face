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
