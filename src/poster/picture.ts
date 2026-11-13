import type {AccumFormat} from '../fitter/device'
import type {Fitter} from '../fitter/fitter'
import {defaultSettings} from '../fitter/settings'
import {createRenderer} from '../renderer/renderer'
import {packUniforms, UNIFORM_BYTES} from '../renderer/uniforms'

// The painted picture as pixels, at the working size, for the tinted poster. Uses the fitter's own
// renderer (its latest forward render) into an offscreen WebGPU canvas, then copies it to a 2D canvas.
export function renderPicture(device: GPUDevice, fitter: Fitter, width: number, height: number): ImageData {
  const gpuCanvas = new OffscreenCanvas(width, height)
  const context = gpuCanvas.getContext('webgpu') as GPUCanvasContext | null
  if (!context) throw new Error('Could not render the picture for the tinted poster.')
  context.configure({device, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: 'opaque'})
  fitter.draw(context.getCurrentTexture().createView())
  const bitmap = gpuCanvas.transferToImageBitmap()
  const copy = new OffscreenCanvas(width, height).getContext('2d')
  if (!copy) throw new Error('Could not read the picture for the tinted poster.')
  copy.drawImage(bitmap, 0, 0)
  bitmap.close()
  return copy.getImageData(0, 0, width, height)
}

// The painted picture drawn afresh from the blobs at `longSide` pixels on its long side (the SVG
// poster's embedded picture). Blob positions and sizes are fractions of the long side, so the same
// renderer draws the same picture at any size, only sharper. Nothing is fitted: no fitter is involved.
export function renderPictureAt(
  device: GPUDevice,
  params: Float32Array, // count * 9
  count: number,
  bg: [number, number, number],
  aspect: [number, number], // width : height of the picture
  longSide: number,
  accumFormat: AccumFormat,
): ImageData {
  const [aw, ah] = aspect
  const width = Math.max(1, Math.round((longSide * aw) / Math.max(aw, ah)))
  const height = Math.max(1, Math.round((longSide * ah) / Math.max(aw, ah)))
  const uniforms = device.createBuffer({size: UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST})
  const paramBuffer = device.createBuffer({
    size: Math.max(16, params.byteLength),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const renderer = createRenderer(device, {width, height, accumFormat, uniforms, params: paramBuffer})
  try {
    device.queue.writeBuffer(uniforms, 0, packUniforms(defaultSettings(width, height, count, bg), 0))
    device.queue.writeBuffer(paramBuffer, 0, params as Float32Array<ArrayBuffer>)
    const gpuCanvas = new OffscreenCanvas(width, height)
    const context = gpuCanvas.getContext('webgpu') as GPUCanvasContext | null
    if (!context) throw new Error('Could not render the picture for the poster.')
    context.configure({device, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: 'opaque'})
    const encoder = device.createCommandEncoder()
    renderer.encodeForward(encoder, count)
    renderer.encodeResolve(encoder, context.getCurrentTexture().createView())
    device.queue.submit([encoder.finish()])
    const bitmap = gpuCanvas.transferToImageBitmap()
    const copy = new OffscreenCanvas(width, height).getContext('2d')
    if (!copy) throw new Error('Could not read the picture for the poster.')
    copy.drawImage(bitmap, 0, 0)
    bitmap.close()
    return copy.getImageData(0, 0, width, height)
  } finally {
    renderer.destroy()
    uniforms.destroy()
    paramBuffer.destroy()
  }
}
