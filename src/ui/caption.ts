import type {StopReason} from '../fitter/autoStop'
import type {InitMode} from '../fitter/init'

export type CaptionState = {
  mode: InitMode
  startActive: number // active blobs at step 0
  target: number // blob count the fit grows to
  active: number // active blobs now
  done: {reason: StopReason; step: number; loss: number} | null // set while stopped by itself
  file: {count: number; seed: number} | null // set while showing an opened code file
}

const n = (value: number) => value.toLocaleString('en-US')
const pct = (fraction: number) => `${(fraction * 100).toFixed(2)}%`

// The phase of a fit, as the header's four steps show it (plus a picture opened from a code file).
export type FitPhase = 'start' | 'growing' | 'refining' | 'done' | 'file'

export function fitPhase({mode, startActive, target, active, done, file}: CaptionState): FitPhase {
  if (file) return 'file'
  if (done) return 'done'
  if (mode === 'painting' && active <= startActive && startActive < target) return 'start'
  if (active < target) return 'growing'
  return 'refining'
}

export type Caption = {headline: string; support: string}

// The caption for the current phase: a short headline and one supporting sentence. Every number in it
// is fixed for the whole phase, so the text (read out by an aria-live region) only changes when the
// phase changes.
export function caption(state: CaptionState): Caption {
  const {mode, startActive, target, done, file} = state
  switch (fitPhase(state)) {
    case 'file':
      return {
        headline: 'Opened from a code file.',
        support: `${n(file!.count)} blobs, seed ${file!.seed}, drawn exactly as the file describes them; Start paints a new picture from a photo.`,
      }
    case 'done':
      return done!.reason === 'converged'
        ? {
            headline: 'Done.',
            support: `Re-painted from your photo with ${n(target)} blobs in ${n(done!.step)} steps; the mistake stopped improving at ${pct(done!.loss)}.`,
          }
        : {
            headline: 'Stopped at the step limit.',
            support: `${n(target)} blobs after ${n(done!.step)} steps, with a mistake of ${pct(done!.loss)}; Resume keeps going.`,
          }
    case 'start':
      return {
        headline: 'A few big blobs.',
        support: `It starts with ${n(startActive)} blobs in the photo's average colour; they move, stretch and recolour to match it.`,
      }
    case 'growing':
      return {
        headline: 'Adding blobs where it is most wrong.',
        support: `New blobs go mostly where the mistake is largest, from ${n(startActive)} up to ${n(target)}; each starts small, in the photo's colour there.`,
      }
    case 'refining':
      if (mode === 'blank') {
        return {
          headline: `${n(target)} blobs, one flat colour.`,
          support: 'Every step moves, resizes and recolours them a little to match the photo.',
        }
      }
      if (mode === 'photo') {
        return {
          headline: `${n(target)} blobs in the photo's colours.`,
          support: 'Every step moves, resizes and recolours them a little to match it better.',
        }
      }
      return {
        headline: `All ${n(target)} blobs placed.`,
        support: 'From here they are only adjusted: moved, resized, turned and recoloured.',
      }
  }
}
