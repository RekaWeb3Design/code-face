// A lower blob limit for weak GPUs. WebGPU does not report speed, so this goes by what the adapter
// does report: a software adapter, or one that offers nothing beyond WebGPU's minimum limits (typical
// of phones and small integrated GPUs). The fit itself would run; it would just be very slow.

export type AdapterFacts = {
  isFallbackAdapter: boolean
  limits: {maxStorageBufferBindingSize: number; maxBufferSize: number; maxTextureDimension2D: number; maxComputeWorkgroupStorageSize: number}
}

export type BlobCap = {max: number; reason: string}

export const FALLBACK_MAX_BLOBS = 2000
export const LOW_LIMITS_MAX_BLOBS = 4000

// WebGPU's minimum ("default") limits for these four.
const MINIMUM = {maxStorageBufferBindingSize: 2 ** 27, maxBufferSize: 2 ** 28, maxTextureDimension2D: 8192, maxComputeWorkgroupStorageSize: 16384}

export function blobCap(adapter: AdapterFacts): BlobCap | null {
  if (adapter.isFallbackAdapter) {
    return {max: FALLBACK_MAX_BLOBS, reason: `This browser paints without a real GPU, so a fit is capped at ${FALLBACK_MAX_BLOBS.toLocaleString('en-US')} blobs.`}
  }
  const minimal = (Object.keys(MINIMUM) as (keyof typeof MINIMUM)[]).every((key) => adapter.limits[key] <= MINIMUM[key])
  if (minimal) {
    return {max: LOW_LIMITS_MAX_BLOBS, reason: `This GPU reports only basic limits, so a fit is capped at ${LOW_LIMITS_MAX_BLOBS.toLocaleString('en-US')} blobs to stay responsive.`}
  }
  return null
}
