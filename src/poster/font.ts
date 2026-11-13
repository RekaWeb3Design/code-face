// The poster font, bundled with the app so a poster looks the same on every machine and no font is
// fetched from anywhere else: JetBrains Mono, Regular, Latin subset (woff2 from @fontsource/jetbrains-mono
// 5.3.0), SIL Open Font License 1.1, see src/assets/fonts/JetBrainsMono-OFL.txt.
import fontUrl from '../assets/fonts/jetbrains-mono-latin-400-normal.woff2?url'

export const POSTER_FONT_FAMILY = 'Code Face Mono'

// charAspect: advance width of one character / font size. ascent: distance from the top of the em box
// (where the PNG and JPEG posters place each line, textBaseline 'top') down to the alphabetic baseline
// (where an SVG <text> is placed), / font size.
export type PosterFont = {family: string; charAspect: number; ascent: number}

let loading: Promise<PosterFont> | null = null

// Loads the font once and measures its character width (as a fraction of the font size). Works on the
// page and in the poster worker. Rejects if the font cannot be loaded: there is no fallback, a poster
// must not use another font.
export function loadPosterFont(): Promise<PosterFont> {
  loading ??= (async () => {
    const face = new FontFace(POSTER_FONT_FAMILY, `url(${fontUrl})`)
    await face.load()
    const fonts = (globalThis as {fonts?: FontFaceSet}).fonts ?? document.fonts
    fonts.add(face)
    const ctx = new OffscreenCanvas(1, 1).getContext('2d')
    if (!ctx) throw new Error('could not measure the poster font')
    ctx.font = `100px "${POSTER_FONT_FAMILY}"`
    const charAspect = ctx.measureText('0123456789abcdef'.repeat(4)).width / 64 / 100
    ctx.textBaseline = 'top'
    const top = ctx.measureText('H')
    // alphabeticBaseline is negative when the baseline lies below the 'top' line. Fall back to the
    // font's own ascent share of its height (1020 / 1320 for JetBrains Mono).
    const ascent = Number.isFinite(top.alphabeticBaseline)
      ? -top.alphabeticBaseline / 100
      : top.fontBoundingBoxAscent / (top.fontBoundingBoxAscent + top.fontBoundingBoxDescent)
    return {family: POSTER_FONT_FAMILY, charAspect, ascent}
  })().catch((reason) => {
    loading = null // let a later attempt try again
    throw reason
  })
  return loading
}

// The font file itself as a data: URL, for embedding in an SVG poster.
export async function posterFontDataUrl(): Promise<string> {
  const response = await fetch(fontUrl)
  if (!response.ok) throw new Error('could not read the poster font')
  return blobToDataUrl(new Blob([await response.arrayBuffer()], {type: 'font/woff2'}))
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('could not read the data'))
    reader.readAsDataURL(blob)
  })
}
