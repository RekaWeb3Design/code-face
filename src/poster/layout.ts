// Layout of a code poster: the header lines as a band at the top, then every blob line in file order,
// down the first column, then the next. Pure: only numbers in, numbers out.

export const DPI = 300
export const FRAMES = {
  a4: {label: 'A4', mm: [210, 297]},
  a3: {label: 'A3', mm: [297, 420]},
  '30x40': {label: '30 × 40 cm', mm: [300, 400]},
  '50x70': {label: '50 × 70 cm', mm: [500, 700]},
} as const
export type FrameId = keyof typeof FRAMES
export type Orientation = 'portrait' | 'landscape'

const LINE_HEIGHT = 1.2 // in font sizes
const COLUMN_GAP_CHARS = 2
const MARGIN = 0.06 // of the frame's short side
const FOOTER_PT = 8
const FOOTER_GAP = 1.5 // footer font sizes between the text and the footer line
export const MIN_READABLE_PT = 5

export const pxToPt = (px: number) => (px * 72) / DPI
export const ptToPx = (pt: number) => (pt * DPI) / 72

export function framePixels(frame: FrameId, orientation: Orientation): {width: number; height: number} {
  const [a, b] = FRAMES[frame].mm.map((mm) => Math.round((mm / 25.4) * DPI))
  return orientation === 'portrait' ? {width: a, height: b} : {width: b, height: a}
}

export type Rect = {x: number; y: number; width: number; height: number}

export type PosterLayout = {
  width: number
  height: number
  fontPx: number
  fontPt: number
  lineHeightPx: number
  charWidthPx: number
  columns: number
  rowsPerColumn: number
  // Top-left corner of every text line, header lines first, then blob lines in file order.
  lines: {x: number; y: number}[]
  textArea: Rect // the box inside the margins that the text may use
  block: Rect // the box the text actually covers (the tinted style fits the picture to it)
  footer: {x: number; y: number; fontPx: number}
}

export type LayoutInput = {
  width: number
  height: number
  headerLines: number
  headerChars: number // longest header line
  blobLines: number
  blobChars: number // every blob line has this many characters
  charAspect: number // advance width of one character / font size, measured from the font
}

export function posterLayout(input: LayoutInput): PosterLayout {
  const {width, height, headerLines, headerChars, blobLines, blobChars, charAspect} = input
  const margin = Math.round(MARGIN * Math.min(width, height))
  const footerPx = ptToPx(FOOTER_PT)
  const textArea: Rect = {
    x: margin,
    y: margin,
    width: width - 2 * margin,
    height: height - 2 * margin - footerPx * (1 + FOOTER_GAP),
  }
  // Rows above the blob columns: the header and one empty line.
  const topRows = headerLines > 0 ? headerLines + 1 : 0
  const headerLimit = headerChars > 0 ? textArea.width / (headerChars * charAspect) : Infinity

  // Try every column count; keep the one that allows the largest font (fewer columns on a tie).
  let best = {fontPx: 0, columns: 1, rows: Math.max(1, blobLines)}
  for (let columns = 1; columns <= Math.max(1, blobLines); columns++) {
    const rows = Math.max(1, Math.ceil(blobLines / columns))
    if (columns > 1 && Math.ceil(blobLines / (columns - 1)) === rows) continue // same rows, wider: never better
    const widthLimit = textArea.width / (charAspect * (columns * blobChars + (columns - 1) * COLUMN_GAP_CHARS))
    const heightLimit = textArea.height / (LINE_HEIGHT * (topRows + rows))
    const fontPx = Math.min(widthLimit, heightLimit, headerLimit)
    if (fontPx > best.fontPx) best = {fontPx, columns, rows}
  }
  // A hair smaller than the exact limit, so rounding can never push a line over the edge.
  const fontPx = best.fontPx * (1 - 1e-9)
  const charWidthPx = fontPx * charAspect
  const lineHeightPx = fontPx * LINE_HEIGHT
  const rows = best.rows
  const columns = Math.max(1, Math.ceil(blobLines / rows)) // columns actually used
  const columnStep = (blobChars + COLUMN_GAP_CHARS) * charWidthPx
  const blocksWidth = Math.max(
    headerChars * charWidthPx,
    columns * blobChars * charWidthPx + (columns - 1) * COLUMN_GAP_CHARS * charWidthPx,
  )
  const blockHeight = (topRows + Math.min(rows, blobLines)) * lineHeightPx
  // Centred across the frame, from the top of the text area.
  const left = textArea.x + (textArea.width - blocksWidth) / 2

  const lines: {x: number; y: number}[] = []
  for (let i = 0; i < headerLines; i++) lines.push({x: left, y: textArea.y + i * lineHeightPx})
  for (let j = 0; j < blobLines; j++) {
    const column = Math.floor(j / rows)
    lines.push({x: left + column * columnStep, y: textArea.y + (topRows + (j % rows)) * lineHeightPx})
  }
  return {
    width,
    height,
    fontPx,
    fontPt: pxToPt(fontPx),
    lineHeightPx,
    charWidthPx,
    columns,
    rowsPerColumn: rows,
    lines,
    textArea,
    block: {x: left, y: textArea.y, width: blocksWidth, height: blockHeight},
    footer: {x: margin, y: height - margin - footerPx, fontPx: footerPx},
  }
}

// The largest blob count whose poster still has type of at least `minPt` points, or 0 if none.
export function maxBlobsForPt(input: Omit<LayoutInput, 'blobLines'>, minPt: number): number {
  let lo = 0
  let hi = 1
  while (posterLayout({...input, blobLines: hi}).fontPt >= minPt && hi < 1e7) hi *= 2
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (posterLayout({...input, blobLines: mid}).fontPt >= minPt) lo = mid
    else hi = mid
  }
  return lo
}
