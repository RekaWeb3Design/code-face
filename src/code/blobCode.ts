import {A_RAW, B, G, LOG_SX, LOG_SY, P, R, THETA, X, Y} from '../fitter/params'

// Compact blob code, format 1: a printable text file that is the picture. A short header, then one
// fixed-width line per blob, 7 lowercase hex fields separated by single spaces:
//
//   CODE FACE 1
//   Re-painted from a photo with 8,000 blobs.
//   blobs 8000 seed 1 aspect 9:16 background 533f31
//   x    y    w   h   ang colour op
//   3a41 c207 9c3 a1e 2f1 d4a28c 9f
//
//   x, y    16 bits  centre, as a fraction of the image's long side, from -0.02 to 1.02
//   w, h    12 bits  size (sigma) along the blob's own two axes, log scale from 1/4096 to 1/4 of the long side
//   ang     12 bits  angle, 0 to 180 degrees (an ellipse turned by 180 degrees is the same ellipse)
//   colour   8 bits per channel, rrggbb
//   op       8 bits  opacity, 0 to 1
//
// Bit widths were chosen on the 288x512 test photo (8,000 blobs): the decoded blobs render with a mistake
// 0.011 percentage points above the unquantized ones. Changing a width or a range means a new version.

export const CODE_VERSION = 1
// Explains the columns of a blob line, aligned with them.
export const CODE_LEGEND = 'x    y    w   h   ang colour op'
const HEADER_LINES = 4
const LINE = /^([0-9a-f]{4}) ([0-9a-f]{4}) ([0-9a-f]{3}) ([0-9a-f]{3}) ([0-9a-f]{3}) ([0-9a-f]{6}) ([0-9a-f]{2})$/

const POSITION = {lo: -0.02, hi: 1.02, bits: 16}
const LOG2_SIZE = {lo: -12, hi: -2, bits: 12}
const ANGLE_BITS = 12
const COLOUR_BITS = 8
const OPACITY_BITS = 8
// Opacity is decoded inside the fitter's own limits for the raw param (sigmoid of -8 and 8).
const OPACITY_MIN = 1 / (1 + Math.exp(8))
const OPACITY_MAX = 1 - OPACITY_MIN

export type BlobPicture = {
  params: Float32Array // count * 9, in the fitter's layout (params.ts)
  count: number
  seed: number
  width: number // only the ratio matters; any size with the same aspect ratio decodes the same
  height: number
  bg: readonly number[] // background colour, rgb in 0..1
}

const hex = (value: number, bits: number) => value.toString(16).padStart(bits / 4, '0')
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))

// Linear quantization of [lo, hi] to 0 .. 2^bits - 1, clamped; NaN becomes lo.
function quantize(value: number, lo: number, hi: number, bits: number): number {
  const max = 2 ** bits - 1
  const q = Math.round(((value - lo) / (hi - lo)) * max)
  return Number.isNaN(q) ? 0 : Math.min(max, Math.max(0, q))
}

const dequantize = (q: number, lo: number, hi: number, bits: number) => lo + (q / (2 ** bits - 1)) * (hi - lo)

// Angle in [0, pi), cyclic: 2^bits steps around half a turn.
function quantizeAngle(theta: number): number {
  const steps = 2 ** ANGLE_BITS
  const turn = ((theta % Math.PI) + Math.PI) % Math.PI
  const q = Math.round((turn / Math.PI) * steps) % steps
  return Number.isNaN(q) ? 0 : q
}

// One blob as its fixed-width code line.
export function encodeLine(params: ArrayLike<number>, i: number): string {
  const o = i * P
  const colour = [R, G, B].map((k) => hex(quantize(params[o + k], 0, 1, COLOUR_BITS), COLOUR_BITS)).join('')
  return [
    hex(quantize(params[o + X], POSITION.lo, POSITION.hi, POSITION.bits), POSITION.bits),
    hex(quantize(params[o + Y], POSITION.lo, POSITION.hi, POSITION.bits), POSITION.bits),
    hex(quantize(params[o + LOG_SX] / Math.LN2, LOG2_SIZE.lo, LOG2_SIZE.hi, LOG2_SIZE.bits), LOG2_SIZE.bits),
    hex(quantize(params[o + LOG_SY] / Math.LN2, LOG2_SIZE.lo, LOG2_SIZE.hi, LOG2_SIZE.bits), LOG2_SIZE.bits),
    hex(quantizeAngle(params[o + THETA]), ANGLE_BITS),
    colour,
    hex(quantize(sigmoid(params[o + A_RAW]), 0, 1, OPACITY_BITS), OPACITY_BITS),
  ].join(' ')
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))

export function encodeBlobs(picture: BlobPicture): string {
  const {params, count, seed, width, height, bg} = picture
  const d = gcd(width, height)
  const background = bg.map((c) => hex(quantize(c, 0, 1, 8), 8)).join('')
  const lines = [
    `CODE FACE ${CODE_VERSION}`,
    `Re-painted from a photo with ${count.toLocaleString('en-US')} blobs.`,
    `blobs ${count} seed ${seed} aspect ${width / d}:${height / d} background ${background}`,
    CODE_LEGEND,
  ]
  for (let i = 0; i < count; i++) lines.push(encodeLine(params, i))
  return lines.join('\n') + '\n'
}

export type DecodedPicture = {
  params: Float32Array
  count: number
  seed: number
  aspect: [number, number] // width : height, reduced
  bg: [number, number, number]
}

// Inverse of encodeBlobs. Throws with the line number on anything malformed.
export function decodeBlobs(text: string): DecodedPicture {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n')
  const fail = (line: number, why: string): never => {
    throw new Error(`Not a Code Face file (line ${line}): ${why}`)
  }
  if (lines[0] !== `CODE FACE ${CODE_VERSION}`) fail(1, `expected "CODE FACE ${CODE_VERSION}"`)
  const meta = /^blobs (\d+) seed (\d+) aspect (\d+):(\d+) background ([0-9a-f]{6})$/.exec(lines[2] ?? '')
  if (!meta) return fail(3, 'expected "blobs <n> seed <n> aspect <w>:<h> background <rrggbb>"')
  const count = Number(meta[1])
  const aspect: [number, number] = [Number(meta[3]), Number(meta[4])]
  if (aspect[0] < 1 || aspect[1] < 1) fail(3, 'the aspect ratio must be positive')
  if (lines.length !== HEADER_LINES + count) fail(lines.length, `expected ${count} blob lines`)
  const bg = [0, 2, 4].map((k) => parseInt(meta[5].slice(k, k + 2), 16) / 255) as [number, number, number]

  const params = new Float32Array(count * P)
  for (let i = 0; i < count; i++) {
    const m = LINE.exec(lines[HEADER_LINES + i])
    if (!m) return fail(HEADER_LINES + i + 1, `expected "${CODE_LEGEND}" as 7 hex fields`)
    const field = (k: number) => parseInt(m[k], 16)
    const o = i * P
    params[o + X] = dequantize(field(1), POSITION.lo, POSITION.hi, POSITION.bits)
    params[o + Y] = dequantize(field(2), POSITION.lo, POSITION.hi, POSITION.bits)
    params[o + LOG_SX] = dequantize(field(3), LOG2_SIZE.lo, LOG2_SIZE.hi, LOG2_SIZE.bits) * Math.LN2
    params[o + LOG_SY] = dequantize(field(4), LOG2_SIZE.lo, LOG2_SIZE.hi, LOG2_SIZE.bits) * Math.LN2
    params[o + THETA] = (field(5) / 2 ** ANGLE_BITS) * Math.PI
    for (const [k, at] of [[R, 0], [G, 2], [B, 4]]) params[o + k] = parseInt(m[6].slice(at, at + 2), 16) / 255
    const a = Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, field(7) / (2 ** OPACITY_BITS - 1)))
    params[o + A_RAW] = Math.log(a / (1 - a))
  }
  return {params, count, seed: Number(meta[2]), aspect, bg}
}
