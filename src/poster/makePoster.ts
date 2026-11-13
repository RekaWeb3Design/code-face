import {PosterCancelled} from './drawPoster'
import type {PosterReply, PosterRequest} from './posterWorker'

// Runs one poster in its own worker. Cancelling terminates the worker at once, so a cancelled or
// failed poster never produces a file. The worker is always terminated at the end, which also gives
// its memory back.
export function makePosterInWorker(
  request: PosterRequest,
  onProgress: (fraction: number) => void,
  isCancelled: () => boolean,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./posterWorker.ts', import.meta.url), {type: 'module'})
    const finish = (settle: () => void) => {
      clearInterval(watch)
      worker.terminate()
      settle()
    }
    const watch = setInterval(() => {
      if (isCancelled()) finish(() => reject(new PosterCancelled('cancelled')))
    }, 100)
    worker.onmessage = (event: MessageEvent<PosterReply>) => {
      const message = event.data
      if (message.kind === 'progress') onProgress(message.fraction)
      else if (message.kind === 'done') finish(() => resolve(message.blob))
      else finish(() => reject(new Error(message.message)))
    }
    worker.onerror = (event) => finish(() => reject(new Error(event.message || 'the drawing worker stopped')))
    const transfer = request.picture ? [request.picture.data.buffer] : []
    worker.postMessage(request, transfer)
  })
}
