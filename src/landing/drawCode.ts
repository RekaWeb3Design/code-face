import {decodeBlobs, type DecodedPicture} from '../code/blobCode'
import {EPS, Q_MAX} from '../fitter/params'
import {blobWeight, resolveColor} from '../reference/blend'
import {readBlob} from '../reference/render'

// Draws a code file on a 2D canvas, for the landing page: no WebGPU, no fitting. It uses the CPU
// reference's own blend (src/reference/blend.ts), so it gives the same picture as forward() in
// src/reference/render.ts. The only difference is speed: each blob only visits the pixels in its
// 3-sigma box, where forward() visits every pixel (outside the box the weight is 0 anyway).

// The picture's size in pixels for a given long side, from the file's aspect ratio.
export function pictureSize(aspect: readonly [number, number], longSide: number): [number, number] {
  const [aw, ah] = aspect
  const long = Math.max(aw, ah)
  return [Math.max(1, Math.round((longSide * aw) / long)), Math.max(1, Math.round((longSide * ah) / long))]
}

// RGBA bytes (opaque) of the decoded blobs at width x height.
export function renderBlobs(picture: DecodedPicture, width: number, height: number): Uint8ClampedArray<ArrayBuffer> {
  const steps = renderBlobsInSteps(picture, width, height)
  for (;;) {
    const next = steps.next()
    if (next.done) return next.value
  }
}

// The same picture, made in small steps: it yields after every blob and after every row of the final
// pass, so the landing can spread the work over frames and never hold up scrolling.
export function* renderBlobsInSteps(
  picture: DecodedPicture,
  width: number,
  height: number,
): Generator<void, Uint8ClampedArray<ArrayBuffer>, void> {
  const {params, count, bg} = picture
  const longSide = Math.max(width, height)
  const sumWC = new Float64Array(width * height * 3)
  const sumW = new Float64Array(width * height)
  const reach = Math.sqrt(Q_MAX)
  for (let i = 0; i < count; i++) {
    const blob = readBlob(params, i)
    // Half extents of the rotated 3-sigma ellipse, in pixels, plus a pixel of slack.
    const ex = reach * Math.hypot(blob.sx * blob.cs, blob.sy * blob.sn) * longSide + 1
    const ey = reach * Math.hypot(blob.sx * blob.sn, blob.sy * blob.cs) * longSide + 1
    const cx = blob.x * longSide - 0.5
    const cy = blob.y * longSide - 0.5
    const x0 = Math.max(0, Math.floor(cx - ex))
    const x1 = Math.min(width - 1, Math.ceil(cx + ex))
    const y0 = Math.max(0, Math.floor(cy - ey))
    const y1 = Math.min(height - 1, Math.ceil(cy + ey))
    for (let py = y0; py <= y1; py++) {
      const dy = (py + 0.5) / longSide - blob.y
      for (let px = x0; px <= x1; px++) {
        const w = blobWeight((px + 0.5) / longSide - blob.x, dy, blob, Q_MAX)
        if (w === 0) continue
        const k = py * width + px
        sumW[k] += w
        sumWC[k * 3] += w * blob.r
        sumWC[k * 3 + 1] += w * blob.g
        sumWC[k * 3 + 2] += w * blob.b
      }
    }
    yield
  }
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let py = 0; py < height; py++) {
    for (let k = py * width; k < (py + 1) * width; k++) {
      for (let ch = 0; ch < 3; ch++) rgba[k * 4 + ch] = Math.round(resolveColor(sumWC[k * 3 + ch], sumW[k], bg[ch], EPS) * 255)
      rgba[k * 4 + 3] = 255
    }
    yield
  }
  return rgba
}

// Decodes a code file and draws it on the canvas at the given long side (the canvas is resized).
export function drawCode(canvas: HTMLCanvasElement, text: string, longSide: number): DecodedPicture {
  const picture = decodeBlobs(text)
  const [width, height] = pictureSize(picture.aspect, longSide)
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create a 2D canvas.')
  ctx.putImageData(new ImageData(renderBlobs(picture, width, height), width, height), 0, 0)
  return picture
}
