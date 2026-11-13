import {describe, expect, it} from 'vitest'
import {A_RAW, B, G, LOG_SX, LOG_SY, P, R, THETA, X, Y} from '../fitter/params'
import {prng} from '../fitter/prng'
import {CODE_LEGEND, decodeBlobs, encodeBlobs, encodeLine} from './blobCode'

// Tolerances: half a quantization step of each field, plus float32 rounding (1e-6).
const F32 = 1e-6
const TOL = {
  position: 1.04 / 65535 / 2 + F32, // fraction of the long side
  logSize: ((10 / 4095) * Math.LN2) / 2 + F32, // natural log of sigma
  angle: Math.PI / 4096 / 2 + F32, // radians, modulo pi
  colour: 1 / 255 / 2 + F32,
  opacity: 1 / 255 / 2 + F32, // opacity a = sigmoid(raw)
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))
// Distance between two angles of an ellipse (modulo pi).
const angleGap = (a: number, b: number) => {
  const d = (((a - b) % Math.PI) + Math.PI) % Math.PI
  return Math.min(d, Math.PI - d)
}

// Random blobs inside the ranges the fitter allows (288x512 image, so x <= 0.5625).
function randomBlobs(count: number, seed: number): Float32Array {
  const rand = prng(seed)
  const params = new Float32Array(count * P)
  for (let i = 0; i < count; i++) {
    const o = i * P
    params[o + X] = -0.02 + rand() * 0.6025
    params[o + Y] = -0.02 + rand() * 1.04
    params[o + LOG_SX] = Math.log(0.3 / 512) + rand() * Math.log(0.15 / (0.3 / 512))
    params[o + LOG_SY] = Math.log(0.3 / 512) + rand() * Math.log(0.15 / (0.3 / 512))
    params[o + THETA] = (rand() - 0.5) * 4 * Math.PI // the fitter does not bound theta
    params[o + R] = rand()
    params[o + G] = rand()
    params[o + B] = rand()
    params[o + A_RAW] = (rand() - 0.5) * 16
  }
  return params
}

const picture = (params: Float32Array, count: number) => ({
  params,
  count,
  seed: 7,
  width: 288,
  height: 512,
  bg: [0.3244, 0.265, 0.1919],
})

describe('compact blob code', () => {
  it('round-trips every param within half a quantization step', () => {
    const count = 2000
    const params = randomBlobs(count, 3)
    const decoded = decodeBlobs(encodeBlobs(picture(params, count)))
    expect(decoded.count).toBe(count)
    const worst = {position: 0, logSize: 0, angle: 0, colour: 0, opacity: 0}
    for (let i = 0; i < count; i++) {
      const o = i * P
      const d = decoded.params
      for (const k of [X, Y]) worst.position = Math.max(worst.position, Math.abs(d[o + k] - params[o + k]))
      for (const k of [LOG_SX, LOG_SY]) worst.logSize = Math.max(worst.logSize, Math.abs(d[o + k] - params[o + k]))
      worst.angle = Math.max(worst.angle, angleGap(d[o + THETA], params[o + THETA]))
      for (const k of [R, G, B]) worst.colour = Math.max(worst.colour, Math.abs(d[o + k] - params[o + k]))
      // Opacities beyond the fitter's raw limits of +-8 cannot come back; these blobs stay inside them.
      worst.opacity = Math.max(worst.opacity, Math.abs(sigmoid(d[o + A_RAW]) - sigmoid(params[o + A_RAW])))
    }
    for (const key of Object.keys(TOL) as (keyof typeof TOL)[]) expect(worst[key], key).toBeLessThanOrEqual(TOL[key])
  })

  it('keeps the header: blob count, seed, reduced aspect ratio, background within half a step', () => {
    const text = encodeBlobs(picture(randomBlobs(3, 1), 3))
    expect(text.split('\n').slice(0, 4)).toEqual([
      'CODE FACE 1',
      'Re-painted from a photo with 3 blobs.',
      'blobs 3 seed 7 aspect 9:16 background 534431',
      CODE_LEGEND,
    ])
    const decoded = decodeBlobs(text)
    expect(decoded.seed).toBe(7)
    expect(decoded.aspect).toEqual([9, 16])
    ;[0.3244, 0.265, 0.1919].forEach((c, k) => expect(Math.abs(decoded.bg[k] - c)).toBeLessThanOrEqual(TOL.colour))
  })

  it('writes one fixed-width line per blob, aligned with the legend', () => {
    const count = 500
    const lines = encodeBlobs(picture(randomBlobs(count, 9), count)).trimEnd().split('\n')
    expect(lines.length).toBe(4 + count)
    for (const line of lines.slice(4)) {
      expect(line).toMatch(/^[0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{3} [0-9a-f]{3} [0-9a-f]{3} [0-9a-f]{6} [0-9a-f]{2}$/)
      expect(line.length).toBe(CODE_LEGEND.length)
    }
  })

  it('is stable: encoding the decoded blobs gives the same text again', () => {
    const text = encodeBlobs(picture(randomBlobs(800, 4), 800))
    const decoded = decodeBlobs(text)
    const again = encodeBlobs({...decoded, width: 9, height: 16})
    expect(again).toBe(text)
  })

  it('clamps out-of-range and non-finite values instead of producing a broken line', () => {
    const params = new Float32Array(P)
    params.set([5, -3, 10, -40, Number.NaN, 2, -1, Number.NaN, 50])
    const line = encodeLine(params, 0)
    expect(line).toBe('ffff 0000 fff 000 000 ff0000 ff')
  })

  it('reads Windows line endings and a missing final newline', () => {
    const text = encodeBlobs(picture(randomBlobs(5, 2), 5))
    expect(decodeBlobs(text.replace(/\n/g, '\r\n')).count).toBe(5)
    expect(decodeBlobs(text.trimEnd()).count).toBe(5)
  })

  it('rejects malformed files with the line number', () => {
    const text = encodeBlobs(picture(randomBlobs(5, 2), 5))
    const lines = text.split('\n')
    expect(() => decodeBlobs(text.replace('CODE FACE 1', 'CODE FACE 2'))).toThrow(/line 1/)
    expect(() => decodeBlobs(text.replace('blobs 5', 'blobs 6'))).toThrow(/expected 6 blob lines/)
    const bad = [...lines]
    bad[6] = bad[6].replace(/^./, 'g')
    expect(() => decodeBlobs(bad.join('\n'))).toThrow(/line 7/)
    expect(() => decodeBlobs('hello')).toThrow(/line 1/)
  })
})
