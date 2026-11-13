import type {FitSettings} from '../fitter/settings'

// One uniform block shared by every shader. Keep in sync with packUniforms below.
export const UNIFORMS_WGSL = /* wgsl */ `
struct Uniforms {
  size: vec2f,        //   0  image size in pixels
  longSide: f32,      //   8
  count: u32,         //  12
  bg: vec3f,          //  16
  eps: f32,           //  28
  lrA: vec4f,         //  32  x, y, log_sx, log_sy
  lrB: vec4f,         //  48  theta, r, g, b
  lrAlpha: f32,       //  64
  beta1: f32,         //  68
  beta2: f32,         //  72
  adamEps: f32,       //  76
  logSigmaMin: f32,   //  80
  logSigmaMax: f32,   //  84
  qMax: f32,          //  88
  gradScale: f32,     //  92  1 / (3 * width * height)
  maxSide: u32,       //  96
  step: u32,          // 100
}                     // 112 bytes
`

export const UNIFORM_BYTES = 112

export function packUniforms(s: FitSettings, step: number): ArrayBuffer {
  const buffer = new ArrayBuffer(UNIFORM_BYTES)
  const f = new Float32Array(buffer)
  const u = new Uint32Array(buffer)
  f[0] = s.width
  f[1] = s.height
  f[2] = Math.max(s.width, s.height)
  u[3] = s.count
  f.set(s.bg, 4)
  f[7] = s.eps
  f.set(s.lr, 8) // 9 floats: lrA, lrB, lrAlpha
  f[17] = s.beta1
  f[18] = s.beta2
  f[19] = s.adamEps
  f[20] = Math.log(s.sigmaMin)
  f[21] = Math.log(s.sigmaMax)
  f[22] = s.qMax
  f[23] = 1 / (3 * s.width * s.height)
  u[24] = s.maxSide
  u[25] = step
  return buffer
}
