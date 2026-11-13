import {describe, expect, it} from 'vitest'
import {growthSchedule, growthStepLimit, sampleNewBlobs} from './growth'
import type {Photo} from './init'
import {B, G, LOG_SX, P, R, X, Y} from './params'
import {prng} from './prng'

function testPhoto(): Photo {
  const width = 64
  const height = 40
  const rand = prng(5)
  const data = new Uint8ClampedArray(width * height * 4)
  for (let k = 0; k < data.length; k++) data[k] = k % 4 === 3 ? 255 : Math.floor(rand() * 256)
  return {width, height, data}
}

// All the error sits in the 8x8 pixel block at x 40..47, y 16..23.
function testError(): Float32Array {
  const error = new Float32Array(64 * 40)
  for (let y = 16; y < 24; y++) for (let x = 40; x < 48; x++) error[y * 64 + x] = 0.5 + (x % 3) * 0.1
  return error
}

describe('growthSchedule', () => {
  // The step at which the active count reaches `active`.
  const stepAt = (events: {step: number; active: number}[], active: number) =>
    events.find((event) => event.active === active)?.step

  it('rises geometrically from the start to exactly the target', () => {
    const events = growthSchedule(32, 8000, 20, 1.3)
    expect(events.at(-1)?.active).toBe(8000)
    let previous = {step: 0, active: 32}
    for (const event of events) {
      expect(event.active).toBeGreaterThan(previous.active)
      expect(event.step).toBeGreaterThan(previous.step)
      // 4 events per doubling: each event multiplies the count by about 2^(1/4) = 1.19.
      expect(event.active / previous.active).toBeLessThan(1.3)
      previous = event
    }
  })

  it('gives each doubling ratio times the steps of the one before', () => {
    const events = growthSchedule(32, 8000, 20, 1.3)
    // Doubling k takes 20 * 1.3^k steps: 20, 26, 33.8, 43.9, ...
    expect(stepAt(events, 64)).toBe(20)
    expect(stepAt(events, 128)).toBe(46)
    expect(stepAt(events, 256)).toBe(Math.round(20 * (1 + 1.3 + 1.3 ** 2))) // 80
    const doublings = [64, 128, 256, 512, 1024, 2048, 4096].map((active) => stepAt(events, active) as number)
    for (let k = 1; k < doublings.length - 1; k++) {
      const thisOne = doublings[k + 1] - doublings[k]
      const before = doublings[k] - doublings[k - 1]
      expect(thisOne / before).toBeCloseTo(1.3, 1)
    }
    // The last event is the 32nd (8 doublings would be 8,192, capped at 8,000):
    // 20 * (1.3^8 - 1) / 0.3 = 477 steps.
    expect(events.length).toBe(32)
    expect(events.at(-1)?.step).toBe(477)
  })

  it('with ratio 1 doubles at a constant number of steps', () => {
    const events = growthSchedule(32, 8000, 40, 1)
    expect(stepAt(events, 64)).toBe(40)
    expect(stepAt(events, 128)).toBe(80)
    expect(stepAt(events, 4096)).toBe(280)
  })

  it('keeps at least one step between events, even with a tiny first doubling', () => {
    const events = growthSchedule(32, 8000, 1, 1.3)
    for (let k = 1; k < events.length; k++) expect(events[k].step).toBeGreaterThan(events[k - 1].step)
  })

  it('is the same every time (depends on its arguments only)', () => {
    expect(growthSchedule(32, 8000, 20, 1.3)).toEqual(growthSchedule(32, 8000, 20, 1.3))
  })

  it('is empty when the target is not above the start', () => {
    expect(growthSchedule(32, 32, 20, 1.3)).toEqual([])
    expect(growthSchedule(32, 20, 20, 1.3)).toEqual([])
  })
})

describe('sampleNewBlobs', () => {
  const photo = testPhoto()
  const error = testError()

  it('same seed + same event + same error map gives identical blobs', () => {
    const a = sampleNewBlobs(error, photo, 42, 3, 100, 160)
    const b = sampleNewBlobs(error, photo, 42, 3, 100, 160)
    expect(Array.from(a)).toEqual(Array.from(b))
    expect(a.length).toBe(60 * P)
  })

  it('a different seed or a different event gives different blobs', () => {
    const a = Array.from(sampleNewBlobs(error, photo, 42, 3, 100, 160))
    expect(Array.from(sampleNewBlobs(error, photo, 43, 3, 100, 160))).not.toEqual(a)
    expect(Array.from(sampleNewBlobs(error, photo, 42, 4, 100, 160))).not.toEqual(a)
  })

  it('places blobs where the error is, with the colour of the photo there and sigma for the new count', () => {
    const to = 160
    const blobs = sampleNewBlobs(error, photo, 42, 0, 100, to)
    const sigma = 0.5 * Math.sqrt(40 / 64 / to)
    for (let i = 0; i < 60; i++) {
      const px = Math.floor(blobs[i * P + X] * 64)
      const py = Math.floor(blobs[i * P + Y] * 64)
      expect(px).toBeGreaterThanOrEqual(40)
      expect(px).toBeLessThan(48)
      expect(py).toBeGreaterThanOrEqual(16)
      expect(py).toBeLessThan(24)
      const k = (py * 64 + px) * 4
      expect(blobs[i * P + R]).toBeCloseTo(photo.data[k] / 255, 6)
      expect(blobs[i * P + G]).toBeCloseTo(photo.data[k + 1] / 255, 6)
      expect(blobs[i * P + B]).toBeCloseTo(photo.data[k + 2] / 255, 6)
      expect(Math.exp(blobs[i * P + LOG_SX])).toBeCloseTo(sigma, 6)
    }
  })

  it('falls back to uniform positions when there is no error at all', () => {
    const blobs = sampleNewBlobs(new Float32Array(64 * 40), photo, 42, 0, 0, 50)
    for (let i = 0; i < 50; i++) {
      expect(blobs[i * P + X]).toBeLessThan(1)
      expect(blobs[i * P + Y]).toBeLessThan(40 / 64)
    }
  })
})

describe('growthStepLimit', () => {
  const events = growthSchedule(32, 8000, 20, 1.3)
  const minSeconds = 25
  const at = (k: number) => (k / events.length) * minSeconds // earliest time of event k (1-based)

  it('reaches each event no earlier than its share of the minimum growth time', () => {
    for (let k = 1; k <= events.length; k++) {
      expect(growthStepLimit(events, at(k) - 1e-6, minSeconds)).toBeLessThan(events[k - 1].step)
      if (k < events.length) expect(growthStepLimit(events, at(k), minSeconds)).toBe(events[k - 1].step)
    }
  })

  it('rises steadily with time and lifts the cap once growth is due to be complete', () => {
    let previous = -1
    for (let t = 0; t < minSeconds; t += 0.05) {
      const limit = growthStepLimit(events, t, minSeconds)
      expect(limit).toBeGreaterThanOrEqual(previous)
      previous = limit
    }
    expect(growthStepLimit(events, minSeconds, minSeconds)).toBe(Infinity)
    expect(growthStepLimit(events, 3, 0)).toBe(Infinity)
    expect(growthStepLimit([], 3, minSeconds)).toBe(Infinity)
  })
})
