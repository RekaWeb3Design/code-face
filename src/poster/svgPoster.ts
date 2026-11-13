// The code poster as SVG: the same layout and the same lines as the PNG and JPEG posters, but every code
// line is a real <text> element in the embedded font, so it stays sharp at any print size.
//   plain:  the text filled with the ink colour.
//   tinted: the painted picture as one embedded raster image, seen only through the code: the text is
//           the image's clip path, so glyph edges are vector-sharp and their colours come from the picture.
// Pure: strings in, strings out (the picture and the font arrive already encoded as data: URLs).
import licence from '../assets/fonts/JetBrainsMono-OFL.txt?raw'
import {codeLines, layoutFor, posterColours, posterFooter, type PosterOptions} from './drawPoster'
import {FRAMES} from './layout'

export type SvgInput = {
  text: string // the code file, exactly as "Download code" saves it
  options: PosterOptions
  count: number
  seed: number
  font: {family: string; charAspect: number; ascent: number; dataUrl: string}
  picture: {dataUrl: string} | null // tinted style only; cover-fitted to the block of text like the raster tint
}

// Two decimals of a 300 dpi pixel are far below anything a printer resolves.
const num = (value: number) => String(Math.round(value * 100) / 100)

export const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// XML comments may not contain "--" or end in "-".
const commentSafe = (s: string) => {
  while (s.includes('--')) s = s.replace(/--/g, '- -')
  return s.replace(/-$/, '- ')
}

// The SVG file as a list of chunks (join them, or hand them to a Blob as they are).
export function svgPoster(input: SvgInput): string[] {
  const {text, options, count, seed, font, picture} = input
  const {header, blobs} = codeLines(text)
  const lines = [...header, ...blobs]
  const layout = layoutFor(text, options, font.charAspect)
  const colours = posterColours(options.background)
  const [a, b] = FRAMES[options.frame].mm
  const [mmW, mmH] = options.orientation === 'portrait' ? [a, b] : [b, a]
  const family = `'${font.family}', 'JetBrains Mono', monospace`
  const baseline = font.ascent * layout.fontPx // from a line's top to its baseline
  const tinted = options.style === 'tinted' && picture !== null

  const out: string[] = []
  out.push(
    `<?xml version="1.0" encoding="UTF-8"?>\n`,
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" ` +
      `width="${mmW}mm" height="${mmH}mm" viewBox="0 0 ${layout.width} ${layout.height}" xml:space="preserve">\n`,
    `<!--\nCode Face poster. The type is JetBrains Mono Regular (Latin subset), embedded below under the SIL Open\n` +
      `Font License 1.1, which allows embedding the font in documents. Its notice and licence:\n\n` +
      `${commentSafe(licence.trim())}\n-->\n`,
    `<title>Code Face poster · ${count} blobs · seed ${seed}</title>\n`,
    `<defs>\n<style>@font-face{font-family:'${font.family}';src:url(${font.dataUrl}) format('woff2');}` +
      `text{white-space:pre;}</style>\n`,
  )
  // The text attributes sit on the parent (the clip path or a group) and are inherited by every line.
  const textAttrs = `font-family="${family}" font-size="${num(layout.fontPx)}"`
  const lineElements = () => {
    const chunk: string[] = []
    for (let i = 0; i < lines.length; i++) {
      const {x, y} = layout.lines[i]
      chunk.push(`<text x="${num(x)}" y="${num(y + baseline)}">${escapeXml(lines[i])}</text>\n`)
      if (chunk.length === 1000) out.push(chunk.splice(0).join(''))
    }
    out.push(chunk.join(''))
  }
  if (tinted) {
    out.push(`<clipPath id="code" ${textAttrs}>\n`)
    lineElements()
    out.push(`</clipPath>\n`)
  }
  out.push(`</defs>\n`)
  out.push(`<rect width="${layout.width}" height="${layout.height}" fill="${colours.background}"/>\n`)
  if (tinted) {
    const {block} = layout
    out.push(
      `<image clip-path="url(#code)" x="${num(block.x)}" y="${num(block.y)}" width="${num(block.width)}" ` +
        `height="${num(block.height)}" preserveAspectRatio="xMidYMid slice" xlink:href="${picture.dataUrl}"/>\n`,
    )
  } else {
    out.push(`<g fill="${colours.ink}" ${textAttrs}>\n`)
    lineElements()
    out.push(`</g>\n`)
  }
  const footerBaseline = layout.footer.y + font.ascent * layout.footer.fontPx
  out.push(
    `<text x="${num(layout.footer.x)}" y="${num(footerBaseline)}" fill="${colours.footer}" font-family="${family}" ` +
      `font-size="${num(layout.footer.fontPx)}">${escapeXml(posterFooter(count, seed))}</text>\n`,
    `</svg>\n`,
  )
  return out
}
