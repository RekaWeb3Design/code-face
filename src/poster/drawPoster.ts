import {paperInk} from './inkContrast'
import {framePixels, posterLayout, type FrameId, type Orientation, type PosterLayout} from './layout'

export type PosterOptions = {
  frame: FrameId
  orientation: Orientation
  style: 'plain' | 'tinted' // tinted: each character in the picture's colour at its spot
  background: 'dark' | 'paper'
  format: 'svg' | 'png' | 'jpeg'
}

const COLOURS = {
  dark: {background: '#111214', ink: '#d9d9d4', footer: '#7b7d80'},
  paper: {background: '#f3eee3', ink: '#23211d', footer: '#8a8579'},
}
export const posterColours = (background: PosterOptions['background']) => COLOURS[background]

// The line at the foot of every poster, whatever its format.
export const posterFooter = (count: number, seed: number) =>
  `CODE FACE · re-painted from a photo with ${count.toLocaleString('en-US')} blobs · seed ${seed}`
const SLICE_MS = 12 // draw for this long, then let the page breathe

export class PosterCancelled extends Error {}

export type DrawInput = {
  text: string // the code file, exactly as "Download code" saves it
  picture: ImageData | null // the painted picture, needed for the tinted style
  options: PosterOptions
  count: number
  seed: number
  font: {family: string; charAspect: number}
  onProgress?: (fraction: number) => void
  isCancelled?: () => boolean
}

// Splits a code file into its header lines and blob lines.
export function codeLines(text: string) {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n')
  return {header: lines.slice(0, 4), blobs: lines.slice(4)}
}

export function layoutFor(text: string, options: PosterOptions, charAspect: number): PosterLayout {
  const {header, blobs} = codeLines(text)
  return posterLayout({
    ...framePixels(options.frame, options.orientation),
    headerLines: header.length,
    headerChars: Math.max(...header.map((line) => line.length)),
    blobLines: blobs.length,
    blobChars: Math.max(0, ...blobs.map((line) => line.length)),
    charAspect,
  })
}

// Draws the PNG or JPEG code poster and encodes it (svgPoster.ts makes the SVG). Resolves with the finished file, or throws: nothing partial.
export async function drawPoster(input: DrawInput): Promise<Blob> {
  const {text, picture, options, count, seed, font, onProgress, isCancelled} = input
  if (options.format === 'svg') throw new Error('an SVG poster is made by svgPoster')
  const {header, blobs} = codeLines(text)
  const lines = [...header, ...blobs]
  const layout = layoutFor(text, options, font.charAspect)
  const colours = COLOURS[options.background]

  let canvas: OffscreenCanvas
  try {
    canvas = new OffscreenCanvas(layout.width, layout.height)
  } catch {
    throw new Error('the browser could not create a canvas this large')
  }
  try {
    const ctx = canvas.getContext('2d', {alpha: false})
    if (!ctx) throw new Error('the browser could not create a canvas this large')
    const lost = () => (ctx as {isContextLost?: () => boolean}).isContextLost?.() === true
    ctx.fillStyle = colours.background
    ctx.fillRect(0, 0, layout.width, layout.height)
    if (lost()) throw new Error('the browser ran out of memory for a canvas this large')
    ctx.font = `${layout.fontPx}px "${font.family}"`
    ctx.textBaseline = 'top'

    const ink = options.background === 'paper' ? paperInk(colours.background) : null
    const tint = options.style === 'tinted' && picture ? tinter(picture, layout, ink) : null
    let slice = performance.now()
    for (let i = 0; i < lines.length; i++) {
      const {x, y} = layout.lines[i]
      if (tint) {
        const line = lines[i]
        for (let k = 0; k < line.length; k++) {
          if (line[k] === ' ') continue
          const cx = x + k * layout.charWidthPx
          ctx.fillStyle = tint(cx + layout.charWidthPx / 2, y + layout.lineHeightPx / 2)
          ctx.fillText(line[k], cx, y)
        }
      } else {
        ctx.fillStyle = colours.ink
        ctx.fillText(lines[i], x, y)
      }
      if (performance.now() - slice > SLICE_MS) {
        onProgress?.((i + 1) / lines.length)
        await new Promise((resolve) => setTimeout(resolve, 0))
        if (isCancelled?.()) throw new PosterCancelled('cancelled')
        slice = performance.now()
      }
    }
    ctx.font = `${layout.footer.fontPx}px "${font.family}"`
    ctx.fillStyle = colours.footer
    ctx.fillText(posterFooter(count, seed), layout.footer.x, layout.footer.y)
    if (lost()) throw new Error('the browser ran out of memory while drawing')
    onProgress?.(1)
    if (isCancelled?.()) throw new PosterCancelled('cancelled')

    let blob: Blob
    try {
      blob = await canvas.convertToBlob({type: `image/${options.format}`, quality: 0.92})
    } catch {
      throw new Error('the browser could not encode an image this large')
    }
    if (blob.size === 0 || blob.type !== `image/${options.format}`) throw new Error('the image came out empty')
    if (isCancelled?.()) throw new PosterCancelled('cancelled')
    return blob
  } finally {
    // Give the memory back at once instead of waiting for garbage collection.
    canvas.width = 0
    canvas.height = 0
  }
}

// Colour of the painted picture at a poster point: the picture is cover-fitted to the text block.
// On paper, `ink` darkens colours that would be too pale against it.
function tinter(picture: ImageData, layout: PosterLayout, ink: ReturnType<typeof paperInk> | null) {
  const {block} = layout
  const scale = Math.max(block.width / picture.width, block.height / picture.height)
  const left = block.x + (block.width - picture.width * scale) / 2
  const top = block.y + (block.height - picture.height * scale) / 2
  const {data, width, height} = picture
  return (x: number, y: number) => {
    const px = Math.min(width - 1, Math.max(0, Math.floor((x - left) / scale)))
    const py = Math.min(height - 1, Math.max(0, Math.floor((y - top) / scale)))
    const k = (py * width + px) * 4
    const [r, g, b] = ink ? ink(data[k], data[k + 1], data[k + 2]) : [data[k], data[k + 1], data[k + 2]]
    return `rgb(${r} ${g} ${b})`
  }
}
