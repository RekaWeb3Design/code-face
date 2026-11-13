import {readFileSync} from 'node:fs'
import {describe, expect, it} from 'vitest'

// The colour tokens, read from the stylesheet itself so the test follows any change to them.
const css = readFileSync(new URL('../app.css', import.meta.url), 'utf8')
const token = (name: string) => {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)
  if (!match) throw new Error(`token --${name} not found`)
  return match[1]
}

// WCAG 2 relative luminance and contrast ratio.
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((k) => {
    const c = parseInt(hex.slice(k, k + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('text contrast', () => {
  it('keeps every text colour at 4.5:1 or more on the backgrounds it is used on', () => {
    const pairs: [string, string][] = [
      ['text', 'bg'],
      ['muted', 'bg'],
      ['accent', 'bg'],
      ['error', 'bg'],
      ['text', 'raised'],
      ['muted', 'raised'],
      ['accent', 'raised'],
      ['on-accent', 'accent'],
    ]
    for (const [fg, bg] of pairs) {
      const ratio = contrast(token(fg), token(bg))
      expect(ratio, `${fg} on ${bg}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
    }
  })
})
