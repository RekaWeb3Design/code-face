import {describe, expect, it} from 'vitest'
import {decodeBlobs, encodeBlobs} from '../code/blobCode'
import {EPS, P, Q_MAX, THETA, X, Y} from '../fitter/params'
import {prng} from '../fitter/prng'
import {forward} from '../reference/render'
import {pictureSize, renderBlobs} from './drawCode'

// A code file of random blobs, some rotated, some reaching over the picture's edges.
function randomCode(count: number, seed: number, width: number, height: number): string {
  const rand = prng(seed)
  const params = new Float32Array(count * P)
  for (let i = 0; i < count; i++) {
    const o = i * P
    params[o + X] = -0.02 + 1.04 * rand()
    params[o + Y] = (-0.02 + 1.04 * rand()) * (height / width)
    params[o + 2] = Math.log(0.01 + 0.12 * rand())
    params[o + 3] = Math.log(0.01 + 0.12 * rand())
    params[o + THETA] = (rand() - 0.5) * Math.PI
    for (let ch = 5; ch < 8; ch++) params[o + ch] = rand()
    params[o + 8] = (rand() - 0.5) * 8
  }
  return encodeBlobs({params, count, seed, width, height, bg: [0.3, 0.4, 0.2]})
}

// The CPU reference's picture as bytes, the way the renderer rounds it.
function referenceBytes(text: string, width: number, height: number): Uint8ClampedArray {
  const picture = decodeBlobs(text)
  const {color} = forward(picture.params, picture.count, {width, height, bg: picture.bg, eps: EPS, qMax: Q_MAX})
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let k = 0; k < width * height; k++) {
    for (let ch = 0; ch < 3; ch++) rgba[k * 4 + ch] = Math.round(color[k * 3 + ch] * 255)
    rgba[k * 4 + 3] = 255
  }
  return rgba
}

describe('landing renderer', () => {
  it('gives the same bytes as the CPU reference (landscape)', () => {
    const text = randomCode(60, 3, 48, 32)
    const [width, height] = pictureSize(decodeBlobs(text).aspect, 48)
    expect([width, height]).toEqual([48, 32])
    expect(Array.from(renderBlobs(decodeBlobs(text), width, height))).toEqual(Array.from(referenceBytes(text, width, height)))
  })

  it('gives the same bytes as the CPU reference (portrait, drawn larger than the file was made)', () => {
    const text = randomCode(40, 9, 9, 16)
    const [width, height] = pictureSize(decodeBlobs(text).aspect, 40)
    expect([width, height]).toEqual([23, 40])
    expect(Array.from(renderBlobs(decodeBlobs(text), width, height))).toEqual(Array.from(referenceBytes(text, width, height)))
  })

  it('shows the background where there are no blobs', () => {
    const text = encodeBlobs({params: new Float32Array(0), count: 0, seed: 1, width: 4, height: 3, bg: [1, 0, 0.5]})
    const rgba = renderBlobs(decodeBlobs(text), 4, 3)
    expect(Array.from(rgba.subarray(0, 4))).toEqual([255, 0, 128, 255])
  })
})
