import {BLEND_WGSL, FULLSCREEN_WGSL, LOAD_BLOB_WGSL} from '../renderer/shaders'
import {UNIFORMS_WGSL} from '../renderer/uniforms'

// THE loss, GPU side: per-pixel dL/dC without the 1 / (3 * pixels) factor (the gather applies it,
// so the values stay exact in a 16-bit float texture). L1: sign(C - T).
export const LOSS_GRAD_WGSL = /* wgsl */ `
${UNIFORMS_WGSL}
@group(0) @binding(0) var<uniform> U: Uniforms;
@group(0) @binding(1) var accum: texture_2d<f32>;
@group(0) @binding(2) var targetTex: texture_2d<f32>;
${BLEND_WGSL}
${FULLSCREEN_WGSL}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let px = vec2i(pos.xy);
  let c = resolveColor(textureLoad(accum, px, 0), U.bg, U.eps);
  let t = textureLoad(targetTex, px, 0).rgb;
  return vec4f(sign(c - t), 1.0);
}
`

// Backward pass: one invocation per blob. It walks the pixels of its own bounding box and
// sums the gradient of the loss for its 9 params. Boxes larger than maxSide x maxSide are
// subsampled on a jittered grid; each sample then stands for stride.x * stride.y pixels.
export const GATHER_WGSL = /* wgsl */ `
${UNIFORMS_WGSL}
@group(0) @binding(0) var<uniform> U: Uniforms;
@group(0) @binding(1) var<storage, read> params: array<f32>;
@group(0) @binding(2) var<storage, read_write> grads: array<f32>;
@group(0) @binding(3) var accum: texture_2d<f32>;
@group(0) @binding(4) var lossGrad: texture_2d<f32>;
${BLEND_WGSL}
${LOAD_BLOB_WGSL}

fn hash(x: u32) -> u32 {
  let s = x * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= U.count) {
    return;
  }
  let b = loadBlob(i);
  // Half size of the axis-aligned box around the rotated footprint ellipse.
  let ext = sqrt(U.qMax) * vec2f(
    length(b.rot * b.sigma),
    length(b.rot.yx * b.sigma),
  );
  // Pixels whose centre (x + 0.5) / longSide lies inside the box, clipped to the image.
  let lo = vec2i(clamp(ceil((b.mu - ext) * U.longSide - 0.5), vec2f(0.0), U.size));
  let hi = vec2i(clamp(floor((b.mu + ext) * U.longSide - 0.5), vec2f(-1.0), U.size - 1.0));

  var gMu = vec2f(0.0);
  var gLogSigma = vec2f(0.0);
  var gTheta = 0.0;
  var gColor = vec3f(0.0);
  var gA = 0.0;
  var pixelsPerSample = 0.0;
  if (all(hi >= lo)) {
    let n = vec2u(hi - lo + 1);
    let stride = (n + vec2u(U.maxSide - 1u)) / U.maxSide;
    let h = hash(i ^ hash(U.step));
    let first = lo + vec2i(vec2u(h % stride.x, hash(h) % stride.y));
    let jump = vec2i(stride);
    pixelsPerSample = f32(stride.x * stride.y);
    for (var y = first.y; y <= hi.y; y += jump.y) {
      for (var x = first.x; x <= hi.x; x += jump.x) {
        let px = vec2i(x, y);
        let wg = blobWeightGrad((vec2f(px) + 0.5) / U.longSide - b.mu, b, U.qMax);
        if (wg.dA == 0.0) {
          continue;
        }
        let acc = textureLoad(accum, px, 0);
        let c = resolveColor(acc, U.bg, U.eps);
        let inv = 1.0 / (acc.a + U.eps);
        let dLdC = textureLoad(lossGrad, px, 0).rgb;
        // dC/dw = (c_i - C) / (sum_w + eps),  dC/dc_i = w / (sum_w + eps)
        let dLdw = dot(dLdC, b.color - c) * inv;
        gColor += dLdC * (wg.w * inv);
        gMu += dLdw * wg.dMu;
        gLogSigma += dLdw * wg.dLogSigma;
        gTheta += dLdw * wg.dTheta;
        gA += dLdw * wg.dA;
      }
    }
  }
  let s = U.gradScale * pixelsPerSample;
  let o = i * P;
  grads[o] = s * gMu.x;
  grads[o + 1u] = s * gMu.y;
  grads[o + 2u] = s * gLogSigma.x;
  grads[o + 3u] = s * gLogSigma.y;
  grads[o + 4u] = s * gTheta;
  grads[o + 5u] = s * gColor.r;
  grads[o + 6u] = s * gColor.g;
  grads[o + 7u] = s * gColor.b;
  grads[o + 8u] = s * gA * b.a * (1.0 - b.a); // da/da_raw
}
`

// Adam step for all 9 params of one blob per invocation, then clamp to the allowed ranges.
export const ADAM_WGSL = /* wgsl */ `
${UNIFORMS_WGSL}
@group(0) @binding(0) var<uniform> U: Uniforms;
@group(0) @binding(1) var<storage, read_write> params: array<f32>;
@group(0) @binding(2) var<storage, read> grads: array<f32>;
@group(0) @binding(3) var<storage, read_write> adamM: array<f32>;
@group(0) @binding(4) var<storage, read_write> adamV: array<f32>;
@group(0) @binding(5) var<storage, read> birth: array<u32>; // step count at which each blob was added

const P = 9u;
const POSITION_MARGIN = 0.02; // blob centres may sit this far outside the image
const A_RAW_LIMIT = 8.0;
const FREE = 1e30;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= U.count) {
    return;
  }
  let extent = U.size / U.longSide;
  var lr = array<f32, 9>(U.lrA.x, U.lrA.y, U.lrA.z, U.lrA.w, U.lrB.x, U.lrB.y, U.lrB.z, U.lrB.w, U.lrAlpha);
  var lo = array<f32, 9>(
    -POSITION_MARGIN, -POSITION_MARGIN, U.logSigmaMin, U.logSigmaMin, -FREE, 0.0, 0.0, 0.0, -A_RAW_LIMIT,
  );
  var hi = array<f32, 9>(
    extent.x + POSITION_MARGIN, extent.y + POSITION_MARGIN, U.logSigmaMax, U.logSigmaMax, FREE, 1.0, 1.0, 1.0,
    A_RAW_LIMIT,
  );
  // Each blob counts its own Adam steps, so a blob added later starts with a proper first step.
  let t = f32(U.step - birth[i]);
  let c1 = 1.0 - pow(U.beta1, t);
  let c2 = 1.0 - pow(U.beta2, t);
  for (var k = 0u; k < P; k++) {
    let j = i * P + k;
    let g = grads[j];
    let m = U.beta1 * adamM[j] + (1.0 - U.beta1) * g;
    let v = U.beta2 * adamV[j] + (1.0 - U.beta2) * g * g;
    adamM[j] = m;
    adamV[j] = v;
    params[j] = clamp(params[j] - lr[k] * (m / c1) / (sqrt(v / c2) + U.adamEps), lo[k], hi[k]);
  }
}
`

// Sum of |C - T| over each image row (3 channels), for the asynchronous loss readback.
export const LOSS_ROWS_WGSL = /* wgsl */ `
${UNIFORMS_WGSL}
@group(0) @binding(0) var<uniform> U: Uniforms;
@group(0) @binding(1) var accum: texture_2d<f32>;
@group(0) @binding(2) var targetTex: texture_2d<f32>;
@group(0) @binding(3) var<storage, read_write> rowSums: array<f32>;
${BLEND_WGSL}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let y = id.x;
  if (y >= u32(U.size.y)) {
    return;
  }
  var sum = 0.0;
  for (var x = 0u; x < u32(U.size.x); x++) {
    let px = vec2i(i32(x), i32(y));
    let c = resolveColor(textureLoad(accum, px, 0), U.bg, U.eps);
    sum += dot(abs(c - textureLoad(targetTex, px, 0).rgb), vec3f(1.0));
  }
  rowSums[y] = sum;
}
`

// |C - T| summed over the 3 channels, one value per pixel, for the growth events.
export const ERROR_MAP_WGSL = /* wgsl */ `
${UNIFORMS_WGSL}
@group(0) @binding(0) var<uniform> U: Uniforms;
@group(0) @binding(1) var accum: texture_2d<f32>;
@group(0) @binding(2) var targetTex: texture_2d<f32>;
@group(0) @binding(3) var<storage, read_write> pixelError: array<f32>;
${BLEND_WGSL}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let y = id.x;
  let width = u32(U.size.x);
  if (y >= u32(U.size.y)) {
    return;
  }
  for (var x = 0u; x < width; x++) {
    let px = vec2i(i32(x), i32(y));
    let c = resolveColor(textureLoad(accum, px, 0), U.bg, U.eps);
    pixelError[y * width + x] = dot(abs(c - textureLoad(targetTex, px, 0).rgb), vec3f(1.0));
  }
}
`
