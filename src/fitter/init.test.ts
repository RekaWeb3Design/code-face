import {describe, expect, it} from 'vitest'
import {initBlobs, meanColor, startCount, type InitMode, type Photo} from './init'
import {A_RAW, B, G, LOG_SX, LOG_SY, P, R, THETA, X, Y} from './params'
import {prng} from './prng'

// 64x40 photo: noisy dark left half, noisy bright right half, so the strongest edge is at x = 32.
function testPhoto(): Photo {
  const width = 64
  const height = 40
  const rand = prng(123)
  const data = new Uint8ClampedArray(width * height * 4)
  for (let k = 0; k < width * height; k++) {
    const base = k % width < 32 ? 40 : 200
    for (let ch = 0; ch < 3; ch++) data[k * 4 + ch] = base + Math.floor(rand() * 10)
    data[k * 4 + 3] = 255
  }
  return {width, height, data}
}

// Share of the blobs whose centre lies in the 4 pixel columns around the edge at x = 32.
// Uniform sampling puts 4/64 = 6.25% there.
function shareNearEdge(params: Float32Array, count: number) {
  let near = 0
  for (let i = 0; i < count; i++) {
    const px = params[i * P + X] * 64
    if (px >= 30 && px < 34) near++
  }
  return near / count
}

describe('initBlobs', () => {
  const photo = testPhoto()
  const modes: InitMode[] = ['painting', 'blank', 'photo']

  for (const mode of modes) {
    it(`${mode}: same seed + same image + same mode gives identical params`, () => {
      const a = initBlobs(photo, 500, 42, mode)
      const b = initBlobs(photo, 500, 42, mode)
      expect(Array.from(a)).toEqual(Array.from(b))
    })

    it(`${mode}: a different seed gives different params`, () => {
      const a = initBlobs(photo, 500, 42, mode)
      const b = initBlobs(photo, 500, 43, mode)
      expect(Array.from(a)).not.toEqual(Array.from(b))
    })

    it(`${mode}: every blob is inside the image, isotropic, unrotated, half opaque`, () => {
      const count = 500
      const params = initBlobs(photo, count, 42, mode)
      for (let i = 0; i < count; i++) {
        const o = i * P
        expect(params[o + X]).toBeGreaterThanOrEqual(0)
        expect(params[o + X]).toBeLessThan(1)
        expect(params[o + Y]).toBeGreaterThanOrEqual(0)
        expect(params[o + Y]).toBeLessThan(40 / 64)
        expect(params[o + LOG_SX]).toBe(params[o + LOG_SY])
        expect(Number.isFinite(params[o + LOG_SX])).toBe(true)
        expect(params[o + THETA]).toBe(0)
        expect(params[o + A_RAW]).toBe(0)
      }
    })
  }

  it('painting starts with about 32 active blobs of the mean colour, sized for that count', () => {
    const active = startCount('painting', 8000)
    expect(active).toBe(32)
    expect(startCount('painting', 20)).toBe(20)
    expect(startCount('blank', 8000)).toBe(8000)
    expect(startCount('photo', 8000)).toBe(8000)
    const params = initBlobs(photo, active, 42, 'painting')
    expect(params.length).toBe(active * P)
    const mean = meanColor(photo)
    // sigma = 0.5 x the blob spacing at the ACTIVE count: 0.5 * sqrt(area / 32), area = 40 / 64.
    const sigma = 0.5 * Math.sqrt(40 / 64 / active)
    for (let i = 0; i < active; i++) {
      expect(params[i * P + R]).toBeCloseTo(mean[0], 6)
      expect(Math.exp(params[i * P + LOG_SX])).toBeCloseTo(sigma, 6)
    }
  })

  it('the two modes give different params for the same seed', () => {
    expect(Array.from(initBlobs(photo, 500, 42, 'blank'))).not.toEqual(Array.from(initBlobs(photo, 500, 42, 'photo')))
  })

  it('photo: each blob takes the colour of its pixel', () => {
    const count = 500
    const params = initBlobs(photo, count, 42, 'photo')
    for (let i = 0; i < count; i++) {
      const o = i * P
      const k = (Math.floor(params[o + Y] * 64) * 64 + Math.floor(params[o + X] * 64)) * 4
      expect(params[o + R]).toBeCloseTo(photo.data[k] / 255, 6)
      expect(params[o + G]).toBeCloseTo(photo.data[k + 1] / 255, 6)
      expect(params[o + B]).toBeCloseTo(photo.data[k + 2] / 255, 6)
    }
  })

  it('photo: puts more blobs on the edge than uniform sampling would', () => {
    expect(shareNearEdge(initBlobs(photo, 2000, 42, 'photo'), 2000)).toBeGreaterThan(0.25)
  })

  it('blank: every blob has the mean colour of the photo and the same sigma, larger than in photo mode', () => {
    const count = 500
    const params = initBlobs(photo, count, 42, 'blank')
    const mean = meanColor(photo)
    for (let i = 0; i < count; i++) {
      const o = i * P
      expect(params[o + R]).toBeCloseTo(mean[0], 6)
      expect(params[o + G]).toBeCloseTo(mean[1], 6)
      expect(params[o + B]).toBeCloseTo(mean[2], 6)
      expect(params[o + LOG_SX]).toBe(params[LOG_SX])
    }
    expect(params[LOG_SX]).toBeGreaterThan(initBlobs(photo, count, 42, 'photo')[LOG_SX])
  })

  it('blank: positions ignore the photo (uniform, not drawn to the edge)', () => {
    // 4 of 64 columns: 6.25% expected; with 2000 blobs one standard deviation is about 0.5%.
    const share = shareNearEdge(initBlobs(photo, 2000, 42, 'blank'), 2000)
    expect(share).toBeGreaterThan(0.04)
    expect(share).toBeLessThan(0.09)
    // Changing the pixels but not the size must not move a single blob.
    const other = {...photo, data: photo.data.map((v, k) => (k % 4 === 3 ? v : 255 - v))}
    const a = initBlobs(photo, 500, 42, 'blank')
    const b = initBlobs(other, 500, 42, 'blank')
    for (let i = 0; i < 500; i++) {
      expect(b[i * P + X]).toBe(a[i * P + X])
      expect(b[i * P + Y]).toBe(a[i * P + Y])
    }
  })
})
