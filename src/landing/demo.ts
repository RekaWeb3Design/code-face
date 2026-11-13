// The landing's demo: one real Code Face painting of a procedural landscape (scripts/demo-landscape.py:
// no photo, no person), saved at five growth stages with the app's ?dev&stages tool. See docs/landing-demo.md.
// `mistake` is each stage's measured mistake: the mean absolute difference, per pixel and channel, between
// the stage drawn by drawCode.ts and the picture as the app loads it (512 x 341), in 0..1.
export type DemoStage = {blobs: number; file: string; mistake: number}

export const DEMO_ASPECT: readonly [number, number] = [512, 341]

export const DEMO_STAGES: readonly DemoStage[] = [
  {blobs: 32, file: '/demo/stage-00032.txt', mistake: 0.1168},
  {blobs: 128, file: '/demo/stage-00128.txt', mistake: 0.0352},
  {blobs: 512, file: '/demo/stage-00512.txt', mistake: 0.0179},
  {blobs: 2048, file: '/demo/stage-02048.txt', mistake: 0.0054},
  {blobs: 8000, file: '/demo/stage-08000.txt', mistake: 0.0005},
]
