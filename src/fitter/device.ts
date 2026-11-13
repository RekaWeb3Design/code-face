import type {AdapterFacts} from './blobCap'

// Format of the accumulation target (rgb = sum w*c, a = sum w).
export type AccumFormat = 'rgba32float' | 'rgba16float'

// Returns null when WebGPU is not available. There is no CPU fallback. Also reports what the
// adapter says about itself, for the blob cap (blobCap.ts).
export async function requestDevice(): Promise<{device: GPUDevice; adapter: AdapterFacts} | null> {
  if (!navigator.gpu) return null
  const adapter = await navigator.gpu.requestAdapter({powerPreference: 'high-performance'})
  if (!adapter) return null
  // Additive blending into a 32-bit float target needs this optional feature.
  const requiredFeatures: GPUFeatureName[] = adapter.features.has('float32-blendable') ? ['float32-blendable'] : []
  const device = await adapter.requestDevice({requiredFeatures})
  // isFallbackAdapter moved from the adapter to adapter.info; read either.
  const info = adapter.info as GPUAdapterInfo & {isFallbackAdapter?: boolean}
  const isFallbackAdapter = Boolean(info?.isFallbackAdapter ?? (adapter as {isFallbackAdapter?: boolean}).isFallbackAdapter)
  return {device, adapter: {isFallbackAdapter, limits: adapter.limits}}
}

// The app fits with rgba32float when the device can blend into it. Otherwise it falls back to
// rgba16float, whose 11-bit mantissa measurably distorts the gradients (reduced precision).
export const defaultAccumFormat = (device: GPUDevice): AccumFormat =>
  device.features.has('float32-blendable') ? 'rgba32float' : 'rgba16float'
