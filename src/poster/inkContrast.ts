// Tinted glyphs on the paper background: a light part of the picture would make pale glyphs that
// vanish into the paper. Every glyph colour is darkened, if needed, until it has at least
// MIN_CONTRAST : 1 against the paper (WCAG 2 contrast). Darkening scales the colour in linear light,
// which keeps its hue and saturation; colours that already contrast enough are left exactly as they are.

export const MIN_CONTRAST = 3
// Colours are darkened to this contrast, a little past the minimum, so that the SVG's JPEG picture
// (which can lighten a pixel slightly) usually stays above it; the SVG export checks and retries.
const AIM = 3.15

// 8-bit sRGB to linear light, as a table: the SVG's picture has millions of pixels.
const LINEAR = Float64Array.from({length: 256}, (_, c) => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
})
const toLinear = (c: number) => LINEAR[c]
const toSrgb = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)

export const luminance = (r: number, g: number, b: number) =>
  0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)

export const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

export const hexRgb = (hex: string): [number, number, number] => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16)) as [number, number, number]

// Returns a function that maps an 8-bit colour to one with at least `aim` (>= MIN_CONTRAST) against
// `paperHex` (which must be lighter than any colour that passes).
export function paperInk(paperHex: string, aim = AIM) {
  const paper = luminance(...hexRgb(paperHex))
  const most = (paper + 0.05) / aim - 0.05 // the largest luminance a glyph may have
  return (r: number, g: number, b: number): [number, number, number] => {
    const l = luminance(r, g, b)
    if (contrast(l, paper) >= aim) return [r, g, b]
    const k = most / l
    // Rounded down, so rounding can only darken further.
    return [r, g, b].map((c) => Math.floor(toSrgb(toLinear(c) * k))) as [number, number, number]
  }
}

// Darkens a whole picture in place (the SVG's embedded picture, on paper).
export function darkenForPaper(data: Uint8ClampedArray, paperHex: string, aim = AIM) {
  const ink = paperInk(paperHex, aim)
  for (let k = 0; k < data.length; k += 4) {
    const [r, g, b] = ink(data[k], data[k + 1], data[k + 2])
    data[k] = r
    data[k + 1] = g
    data[k + 2] = b
  }
}

// How many pixels of a picture have less than MIN_CONTRAST against the paper.
export function paleCount(data: Uint8ClampedArray, paperHex: string) {
  const paper = luminance(...hexRgb(paperHex))
  let pale = 0
  for (let k = 0; k < data.length; k += 4) if (contrast(luminance(data[k], data[k + 1], data[k + 2]), paper) < MIN_CONTRAST) pale++
  return pale
}
