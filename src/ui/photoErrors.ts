// What to tell the user when a chosen file cannot become the photo to paint. One line each, always
// with a way forward. Pure, so the wording is tested.

// The fit works on a 512 px copy, so a bigger file only costs memory while it is decoded.
export const MAX_PHOTO_BYTES = 40e6

export type PhotoProblem = 'not-image' | 'heic' | 'unsupported' | 'too-large'

const mb = (bytes: number) => `${Math.round(bytes / 1e6)} MB`
const extension = (name: string) => /\.([a-z0-9]+)$/i.exec(name)?.[1].toLowerCase() ?? ''
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp', 'heic', 'heif', 'tif', 'tiff', 'svg', 'ico', 'jxl']

export const isHeic = (file: {name: string; type: string}) =>
  /^image\/hei[cf]/.test(file.type) || ['heic', 'heif'].includes(extension(file.name))

const looksLikeImage = (file: {name: string; type: string}) =>
  file.type.startsWith('image/') || IMAGE_EXTENSIONS.includes(extension(file.name))

// Checked before decoding.
export function problemBeforeDecoding(file: {name: string; type: string; size: number}): PhotoProblem | null {
  if (!looksLikeImage(file)) return 'not-image'
  if (file.size > MAX_PHOTO_BYTES) return 'too-large'
  return null
}

// The browser could not decode the file.
export const problemAfterDecoding = (file: {name: string; type: string}): PhotoProblem =>
  isHeic(file) ? 'heic' : 'unsupported'

export function photoProblemMessage(problem: PhotoProblem, file: {name: string; size: number}): string {
  const name = `"${file.name}"`
  switch (problem) {
    case 'not-image':
      return `${name} is not a photo. Choose a JPEG, PNG or WebP image.`
    case 'heic':
      return `${name} is a HEIC photo, which this browser cannot open. Save it as JPEG or PNG and choose it again.`
    case 'unsupported':
      return `This browser cannot open ${name} as an image. Choose a JPEG, PNG or WebP image.`
    case 'too-large':
      return `${name} is ${mb(file.size)}, more than the ${mb(MAX_PHOTO_BYTES)} Code Face accepts. Save a smaller copy (4,000 px across is plenty) and choose it again.`
  }
}
