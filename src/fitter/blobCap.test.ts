import {describe, expect, it} from 'vitest'
import {blobCap, FALLBACK_MAX_BLOBS, LOW_LIMITS_MAX_BLOBS} from './blobCap'

const minimum = {maxStorageBufferBindingSize: 2 ** 27, maxBufferSize: 2 ** 28, maxTextureDimension2D: 8192, maxComputeWorkgroupStorageSize: 16384}

describe('blob cap', () => {
  it('caps a software adapter hardest', () => {
    expect(blobCap({isFallbackAdapter: true, limits: {...minimum, maxBufferSize: 2 ** 32}})?.max).toBe(FALLBACK_MAX_BLOBS)
  })
  it('caps an adapter with only the minimum limits', () => {
    expect(blobCap({isFallbackAdapter: false, limits: minimum})?.max).toBe(LOW_LIMITS_MAX_BLOBS)
  })
  it('leaves an adapter alone when any of the limits is higher', () => {
    expect(blobCap({isFallbackAdapter: false, limits: {...minimum, maxTextureDimension2D: 16384}})).toBeNull()
  })
  it('explains itself in one line', () => {
    expect(blobCap({isFallbackAdapter: false, limits: minimum})?.reason).toMatch(/^This GPU .*4,000 blobs.*\.$/)
  })
})
