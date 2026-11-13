import {decodeBlobs, type DecodedPicture} from '../code/blobCode'
import type {Blob} from '../reference/blend'
import {readBlob} from '../reference/render'
import type {DemoStage} from './demo'
import {blobLines} from './demoHtml'
import {pictureSize, renderBlobsInSteps} from './drawCode'

// Draws the demo's stage files on canvases without ever holding up scrolling: the work runs in small
// steps inside animation frames, at most BUDGET_MS per frame. Animation frames stop in a hidden tab,
// and so does the work.
const BUDGET_MS = 5

type Job = Iterator<void, void, void>
const jobs: Job[] = []
let scheduled = false

function pump() {
  scheduled = false
  const end = performance.now() + BUDGET_MS
  while (jobs.length > 0 && performance.now() < end) {
    if (jobs[0].next().done) jobs.shift()
  }
  if (jobs.length > 0) schedule()
}

function schedule() {
  if (scheduled) return
  scheduled = true
  requestAnimationFrame(pump)
}

export function runInFrames(job: Job): void {
  jobs.push(job)
  schedule()
}

export type PaintedStage = {
  meta: DemoStage
  picture: DecodedPicture
  lines: string[] // blob lines, index 0 is blob 1
  blobs: Blob[]
  canvas: HTMLCanvasElement
}

// Decodes a stage file and draws it on the canvas at the given long side (in device pixels).
export function paintStage(meta: DemoStage, text: string, canvas: HTMLCanvasElement, longSide: number): Promise<PaintedStage> {
  return new Promise((resolve, reject) => {
    runInFrames(
      (function* () {
        try {
          const picture = decodeBlobs(text)
          const lines = blobLines(text)
          yield
          const [width, height] = pictureSize(picture.aspect, longSide)
          const rgba = yield* renderBlobsInSteps(picture, width, height)
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          if (!ctx) throw new Error('no 2D canvas')
          ctx.putImageData(new ImageData(rgba, width, height), 0, 0)
          const blobs = Array.from({length: picture.count}, (_, i) => readBlob(picture.params, i))
          resolve({meta, picture, lines, blobs, canvas})
        } catch (error) {
          reject(error)
        }
      })(),
    )
  })
}

export async function fetchText(file: string): Promise<string> {
  const response = await fetch(file)
  if (!response.ok) throw new Error(`${file}: ${response.status}`)
  return response.text()
}
