import {describe, expect, it} from 'vitest'
import {MAX_PHOTO_BYTES, photoProblemMessage, problemAfterDecoding, problemBeforeDecoding} from './photoErrors'

const file = (name: string, type: string, size = 1e6) => ({name, type, size})

describe('photo errors', () => {
  it('accepts ordinary photos', () => {
    expect(problemBeforeDecoding(file('a.jpg', 'image/jpeg'))).toBeNull()
    expect(problemBeforeDecoding(file('a.webp', ''))).toBeNull() // some systems give no type
  })

  it('rejects files that are not images', () => {
    expect(problemBeforeDecoding(file('notes.pdf', 'application/pdf'))).toBe('not-image')
    expect(problemBeforeDecoding(file('clip.mp4', 'video/mp4'))).toBe('not-image')
  })

  it('rejects very large files before decoding', () => {
    expect(problemBeforeDecoding(file('big.jpg', 'image/jpeg', MAX_PHOTO_BYTES + 1))).toBe('too-large')
  })

  it('names HEIC when the browser cannot decode one, by type or by extension', () => {
    expect(problemAfterDecoding(file('IMG.HEIC', ''))).toBe('heic')
    expect(problemAfterDecoding(file('x', 'image/heif'))).toBe('heic')
    expect(problemAfterDecoding(file('scan.tiff', 'image/tiff'))).toBe('unsupported')
  })

  it('gives one line with a way forward, never "AI"', () => {
    for (const problem of ['not-image', 'heic', 'unsupported', 'too-large'] as const) {
      const message = photoProblemMessage(problem, file('p.heic', 'image/heic', 62e6))
      expect(message).not.toMatch(/\n|\bAI\b/)
      expect(message).toMatch(/[Cc]hoose/)
    }
    expect(photoProblemMessage('too-large', file('p.jpg', 'image/jpeg', 62e6))).toContain('62 MB, more than the 40 MB')
  })
})
