// The landing's demo: one real Code Face painting of a real photo (plants, a toy dinosaur and a small
// statue on a windowsill; no person), saved at five growth stages with the app's ?dev&stages tool.
// See docs/landing-demo.md. The photo itself is never committed.
// `mistake` is each stage's measured mistake: the mean absolute difference, per pixel and channel, between
// the stage drawn by drawCode.ts and the photo as the app loads it (384 x 512), in 0..1.
export type DemoStage = {blobs: number; file: string; mistake: number}

export const DEMO_ASPECT: readonly [number, number] = [3, 4]

export const DEMO_STAGES: readonly DemoStage[] = [
  {blobs: 32, file: '/demo/stage-00032.txt', mistake: 0.1482},
  {blobs: 128, file: '/demo/stage-00128.txt', mistake: 0.0754},
  {blobs: 512, file: '/demo/stage-00512.txt', mistake: 0.047},
  {blobs: 2048, file: '/demo/stage-02048.txt', mistake: 0.0257},
  {blobs: 8000, file: '/demo/stage-08000.txt', mistake: 0.0054},
]

// The hero's loop ends on 2,048 blobs: at 8,000 the picture is so close to the photo that it no longer
// looks painted. The 8,000-blob file is still the one the code section, the cards and the poster use.
export const HERO_LAST = 3

// The demo file's background colour (its header), also the picture frames' colour before drawing.
export const DEMO_BACKGROUND = '#595440'
