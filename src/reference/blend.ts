// THE blending formula, CPU side. The GPU twin is BLEND_WGSL in src/renderer/shaders.ts.
// To swap the formula, change blobWeight + blobWeightGrad + resolveColor here and there.
//
//   w_i(p) = a_i * exp(-0.5 * d^T * Sigma_i^-1 * d),  d = p - mu_i   (0 outside q < qMax)
//   C(p)   = (sum_i w_i*c_i + eps*bg) / (sum_i w_i + eps)

export type Blob = {
  x: number
  y: number
  sx: number
  sy: number
  cs: number // cos(theta)
  sn: number // sin(theta)
  r: number
  g: number
  b: number
  a: number
}

export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))

export function blobWeight(dx: number, dy: number, blob: Blob, qMax: number): number {
  const {cs, sn} = blob
  const u = (cs * dx + sn * dy) / blob.sx
  const v = (-sn * dx + cs * dy) / blob.sy
  const q = u * u + v * v
  return q < qMax ? blob.a * Math.exp(-0.5 * q) : 0
}

// Partial derivatives of blobWeight.
// out = [w, dw/dx, dw/dy, dw/dlog_sx, dw/dlog_sy, dw/dtheta, dw/da].
// The derivative ignores the motion of the qMax cut-off boundary.
export function blobWeightGrad(dx: number, dy: number, blob: Blob, qMax: number, out: Float64Array): void {
  const {cs, sn} = blob
  const u = (cs * dx + sn * dy) / blob.sx
  const v = (-sn * dx + cs * dy) / blob.sy
  const q = u * u + v * v
  if (!(q < qMax)) {
    out.fill(0)
    return
  }
  const e = Math.exp(-0.5 * q)
  const w = blob.a * e
  out[0] = w
  out[1] = w * ((u * cs) / blob.sx - (v * sn) / blob.sy)
  out[2] = w * ((u * sn) / blob.sx + (v * cs) / blob.sy)
  out[3] = w * u * u
  out[4] = w * v * v
  out[5] = -w * u * v * (blob.sy / blob.sx - blob.sx / blob.sy)
  out[6] = e
}

export function resolveColor(sumWC: number, sumW: number, bg: number, eps: number): number {
  return (sumWC + eps * bg) / (sumW + eps)
}
