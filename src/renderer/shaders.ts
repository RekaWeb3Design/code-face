import {UNIFORMS_WGSL} from './uniforms'

// THE blending formula, GPU side. The CPU twin is src/reference/blend.ts.
// To swap the formula, change blobWeight + blobWeightGrad + resolveColor here and there.
//
//   w_i(p) = a_i * exp(-0.5 * d^T * Sigma_i^-1 * d),  d = p - mu_i   (0 outside q < qMax)
//   C(p)   = (sum_i w_i*c_i + eps*bg) / (sum_i w_i + eps)
//
export const BLEND_WGSL = /* wgsl */ `
const P = 9u;

struct Blob {
  mu: vec2f,
  sigma: vec2f,
  rot: vec2f, // cos(theta), sin(theta)
  color: vec3f,
  a: f32,
}

fn blobWeight(d: vec2f, b: Blob, qMax: f32) -> f32 {
  let cs = b.rot.x;
  let sn = b.rot.y;
  let u = (cs * d.x + sn * d.y) / b.sigma.x;
  let v = (-sn * d.x + cs * d.y) / b.sigma.y;
  let q = u * u + v * v;
  if (q < qMax) {
    return b.a * exp(-0.5 * q);
  }
  return 0.0;
}

// Partial derivatives of blobWeight. dA is 0 only outside the footprint.
struct WeightGrad {
  w: f32,
  dMu: vec2f,
  dLogSigma: vec2f,
  dTheta: f32,
  dA: f32,
}

fn blobWeightGrad(d: vec2f, b: Blob, qMax: f32) -> WeightGrad {
  let cs = b.rot.x;
  let sn = b.rot.y;
  let u = (cs * d.x + sn * d.y) / b.sigma.x;
  let v = (-sn * d.x + cs * d.y) / b.sigma.y;
  let q = u * u + v * v;
  var g: WeightGrad;
  if (q < qMax) {
    let e = exp(-0.5 * q);
    let w = b.a * e;
    g.w = w;
    g.dMu = w * vec2f(u * cs / b.sigma.x - v * sn / b.sigma.y, u * sn / b.sigma.x + v * cs / b.sigma.y);
    g.dLogSigma = w * vec2f(u * u, v * v);
    g.dTheta = -w * u * v * (b.sigma.y / b.sigma.x - b.sigma.x / b.sigma.y);
    g.dA = e;
  }
  return g;
}

// acc = (sum w*c, sum w)
fn resolveColor(acc: vec4f, bg: vec3f, eps: f32) -> vec3f {
  return (acc.rgb + eps * bg) / (acc.a + eps);
}
`

// Reads one blob from `params: array<f32>` (9 floats per blob), which the including shader declares.
export const LOAD_BLOB_WGSL = /* wgsl */ `
fn loadBlob(i: u32) -> Blob {
  let o = i * P;
  var b: Blob;
  b.mu = vec2f(params[o], params[o + 1u]);
  b.sigma = exp(vec2f(params[o + 2u], params[o + 3u]));
  b.rot = vec2f(cos(params[o + 4u]), sin(params[o + 4u]));
  b.color = vec3f(params[o + 5u], params[o + 6u], params[o + 7u]);
  b.a = 1.0 / (1.0 + exp(-params[o + 8u]));
  return b;
}
`

export const FULLSCREEN_WGSL = /* wgsl */ `
@vertex
fn fullscreen(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  return vec4f(f32(vi & 1u) * 4.0 - 1.0, f32(vi >> 1u) * 4.0 - 1.0, 0.0, 1.0);
}
`

// Instanced quads covering each blob's footprint, additively blended: rgb = sum w*c, a = sum w.
export const FORWARD_WGSL = /* wgsl */ `
${UNIFORMS_WGSL}
@group(0) @binding(0) var<uniform> U: Uniforms;
@group(0) @binding(1) var<storage, read> params: array<f32>;
${BLEND_WGSL}
${LOAD_BLOB_WGSL}

struct VOut {
  @builtin(position) pos: vec4f,
  // The blob, unpacked once per vertex so the fragment shader needs no buffer reads or trig.
  @location(0) @interpolate(flat) muSigma: vec4f,
  @location(1) @interpolate(flat) rotA: vec3f,
  @location(2) @interpolate(flat) color: vec3f,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let b = loadBlob(ii);
  let corner = vec2f(f32(vi & 1u), f32(vi >> 1u)) * 2.0 - 1.0;
  // Footprint radius along each axis, padded by one pixel; the fragment shader does the exact test.
  let local = corner * (sqrt(U.qMax) * b.sigma + 1.0 / U.longSide);
  let px = (b.mu + vec2f(b.rot.x * local.x - b.rot.y * local.y, b.rot.y * local.x + b.rot.x * local.y)) * U.longSide;
  var o: VOut;
  o.pos = vec4f(px.x / U.size.x * 2.0 - 1.0, 1.0 - px.y / U.size.y * 2.0, 0.0, 1.0);
  o.muSigma = vec4f(b.mu, b.sigma);
  o.rotA = vec3f(b.rot, b.a);
  o.color = b.color;
  return o;
}

@fragment
fn fs(v: VOut) -> @location(0) vec4f {
  var b: Blob;
  b.mu = v.muSigma.xy;
  b.sigma = v.muSigma.zw;
  b.rot = v.rotA.xy;
  b.color = v.color;
  b.a = v.rotA.z;
  // v.pos.xy is the pixel centre (x + 0.5, y + 0.5).
  let w = blobWeight(v.pos.xy / U.longSide - b.mu, b, U.qMax);
  return vec4f(w * b.color, w);
}
`

// Accumulation texture -> final colour. The output is the same size as the accumulation texture.
export const RESOLVE_WGSL = /* wgsl */ `
${UNIFORMS_WGSL}
@group(0) @binding(0) var<uniform> U: Uniforms;
@group(0) @binding(1) var accum: texture_2d<f32>;
${BLEND_WGSL}
${FULLSCREEN_WGSL}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  return vec4f(resolveColor(textureLoad(accum, vec2i(pos.xy), 0), U.bg, U.eps), 1.0);
}
`
