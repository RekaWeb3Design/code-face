import type {Photo} from '../fitter/init'

// Decodes an image file and downscales it to the working resolution. Stays on this device.
export async function loadPhoto(file: Blob, longSide: number): Promise<Photo> {
  const full = await createImageBitmap(file, {imageOrientation: 'from-image'})
  const scale = Math.min(1, longSide / Math.max(full.width, full.height))
  const width = Math.max(1, Math.round(full.width * scale))
  const height = Math.max(1, Math.round(full.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', {willReadFrequently: true})
  if (!ctx) throw new Error('Could not create a 2D canvas to read the photo.')
  // Transparent pixels are flattened onto white.
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(full, 0, 0, width, height)
  full.close()
  return {width, height, data: ctx.getImageData(0, 0, width, height).data}
}
