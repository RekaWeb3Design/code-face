// Draws and encodes a code poster off the page's main thread, so the page stays responsive.
import {drawPoster, posterColours, type PosterOptions} from './drawPoster'
import {darkenForPaper, paleCount} from './inkContrast'
import {blobToDataUrl, loadPosterFont, posterFontDataUrl} from './font'
import {svgPoster} from './svgPoster'

export type PosterRequest = {
  text: string
  // The painted picture (tinted style only): the working size for PNG and JPEG, larger for SVG.
  picture: {width: number; height: number; data: Uint8ClampedArray<ArrayBuffer>} | null
  options: PosterOptions
  count: number
  seed: number
}

export type PosterReply =
  | {kind: 'progress'; fraction: number}
  | {kind: 'done'; blob: Blob}
  | {kind: 'error'; message: string}

const reply = (message: PosterReply) => postMessage(message)

// The SVG's embedded picture. JPEG: it is only ever seen through the glyphs, and smooth blobs compress
// well; PNG would be several times larger for no visible gain.
const PICTURE_QUALITY = 0.92

type Picture = NonNullable<PosterRequest['picture']>

function encode(data: Uint8ClampedArray<ArrayBuffer>, size: Picture, type: 'image/jpeg' | 'image/png') {
  const canvas = new OffscreenCanvas(size.width, size.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('could not prepare the picture')
  ctx.putImageData(new ImageData(data, size.width, size.height), 0, 0)
  return canvas.convertToBlob({type, quality: PICTURE_QUALITY})
}

async function decode(blob: Blob): Promise<Uint8ClampedArray> {
  const bitmap = await createImageBitmap(blob)
  const {width, height} = bitmap // a closed bitmap reports 0 x 0
  const ctx = new OffscreenCanvas(width, height).getContext('2d')
  if (!ctx) throw new Error('could not check the picture')
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  return ctx.getImageData(0, 0, width, height).data
}

// On paper, pale parts of the picture are darkened so every glyph keeps 3:1 against it. JPEG can
// lighten a few pixels again, so the encoded picture is decoded and checked: if any pixel is under
// 3:1 it is darkened with a wider margin and tried again, and in the end embedded as PNG (lossless).
async function paperPicture(picture: Picture): Promise<Blob> {
  const paper = posterColours('paper').background
  for (const aim of [3.15, 3.4, 3.7]) {
    const data = picture.data.slice()
    darkenForPaper(data, paper, aim)
    const jpeg = await encode(data, picture, 'image/jpeg')
    if (paleCount(await decode(jpeg), paper) === 0) return jpeg
  }
  const data = picture.data.slice()
  darkenForPaper(data, paper)
  return encode(data, picture, 'image/png')
}

async function makeSvg(request: PosterRequest, font: Awaited<ReturnType<typeof loadPosterFont>>): Promise<Blob> {
  const {text, picture, options, count, seed} = request
  let pictureUrl: string | null = null
  if (options.style === 'tinted' && picture) {
    pictureUrl = await blobToDataUrl(
      options.background === 'paper' ? await paperPicture(picture) : await encode(picture.data, picture, 'image/jpeg'),
    )
  }
  reply({kind: 'progress', fraction: 0.6})
  const chunks = svgPoster({
    text,
    options,
    count,
    seed,
    font: {...font, dataUrl: await posterFontDataUrl()},
    picture: pictureUrl ? {dataUrl: pictureUrl} : null,
  })
  return new Blob(chunks, {type: 'image/svg+xml'})
}

onmessage = async (event: MessageEvent<PosterRequest>) => {
  const {text, picture, options, count, seed} = event.data
  try {
    const font = await loadPosterFont()
    const blob =
      options.format === 'svg'
        ? await makeSvg(event.data, font)
        : await drawPoster({
            text,
            picture: picture ? new ImageData(picture.data, picture.width, picture.height) : null,
            options,
            count,
            seed,
            font,
            onProgress: (fraction) => reply({kind: 'progress', fraction}),
          })
    reply({kind: 'done', blob})
  } catch (reason) {
    reply({kind: 'error', message: reason instanceof Error ? reason.message : String(reason)})
  }
}
