# CODE_FACE_SPEC.md — Code Face

A just-for-fun browser app: upload a photo and watch it repaint itself from thousands of soft colour blobs
(2D Gaussians), fitted live by gradient descent on the GPU. Main output: a **high-quality image / print-ready
poster**. Also: video export of the painting process, and styles.
Standalone project. Not part of the video engine or the bookshelf.

Scope: **re-painting your own photo**, no "person who does not exist" generation.

## Principles
- **100% local**: the photo never leaves the device. No backend, no accounts, no analytics on images.
- **Honest copy**: "re-painted from your photo with N blobs", never "AI-generated".
- **Resolution-independent output**: blobs are parameters (position, shape, colour, opacity), so the result can
  be re-rendered at any size. Fitting runs at a working resolution; export renders the same blobs big.
  Caveat to show in the UI: more pixels ≠ more detail; detail comes from more blobs / a higher fit resolution.

## Stack
- Vite + React + TypeScript, a static site on Cloudflare Pages at https://codeface.rekavig.com (see Release).
- **WebGPU** (WGSL) for the fitter and renderer. Forward render = instanced quads (3-sigma bounds) blended
  additively into a float target (rgba32float, or rgba16float as a fallback), then a resolve pass. Backward = a compute shader where each blob gathers
  its own analytic gradients from the pixels in its bounds. Adam optimiser, also on the GPU. No tile binning,
  no sorting, no ML framework. See Decisions.
- Fallback when WebGPU is missing: a clear message + recommended browsers (no half-working CPU path in v1).
- Video: WebCodecs `VideoEncoder` (H.264) + a maintained MP4 muxer (check current options, e.g. mediabunny).
- Code style: parentheses around arrow params `(x) => …`, minimal spaces inside object braces `{a: 1}`.
  Small modules; the GPU code isolated behind a clear interface (`fitter`, `renderer`).

## Fitting (the core)
- Input: photo downscaled to the working resolution (default 512 px long side; "High detail" 1024).
- Init: N blobs (default 8k, range 1k–50k) seeded from the image (sample positions weighted by edge/detail,
  colour from the pixel), small isotropic covariance. Seeded randomness only (same seed → same result).
- Blob params (9 floats): x, y, log_sx, log_sy, theta, r, g, b, a. Positions and sigmas are normalized to the
  image long side; opacity a is the sigmoid of a raw param.
- Blending is order-independent and normalized (formula in Decisions), not sorted alpha compositing.
- Loop: render → L1 loss vs. target → gradients → Adam step. Phase 1 has a fixed blob count and L1 only;
  an SSIM-ish term and densify/prune (split blobs in high-error areas, drop near-transparent ones) are later options.
- Live UI: canvas updates every few steps, `STEP 3,493 · 8,000 BLOBS`, "mistake" number and a small loss curve.
- **Snapshots**: store blob params at log-spaced steps (e.g. 0, 5, 15, 40, 100, 300, 1k, 3k, final) in memory
  → used for the video export and a scrubber ("rewind the painting").
- Pause / resume / stop at any time; the current state is exportable.

## Exports
1. **Image (priority)**: PNG, sizes 2k / 4k / 8k long side, rendered in tiles (stay under GPU texture limits),
   sRGB, optional transparent background (needs a background mask in a later phase), optional paper margin
   (poster look). Filename `code-face-<seed>-<blobs>-<size>.png`.
2. **Poster presets**: A4/A3/50×70 at 300 dpi (pixel sizes computed), with or without margin.
3. **Video**: MP4 of the painting process from the snapshots, interpolating params between snapshots for smooth
   motion. Formats 9:16 (1080×1920), 1:1, 4:5. Optional overlays: step counter + mistake meter, small
   "Code Face" mark. Ends on a hold of the final image. Duration 6–15 s.
4. **Project file**: `.codeface.json` (blob params + settings) so a result can be reopened and re-exported.

## Styles (phase 3)
- Blob shape: soft Gaussian (default), hard ellipse, square/pixel, brush stroke (elongated, oriented along edges).
- Palette lock: limit colours to a palette (e.g. 4–12 colours from the photo or presets).
- Abstraction slider = blob count (500 → abstract, 50k → photo-like).
- Background: original, paper, black, transparent.

## UI
- One screen: drop zone → canvas centre stage → right panel (blobs, detail, style, seed, start/pause) → export
  menu. Dark, minimal, mono type for numbers (like the reel), one accent colour.
- Mobile: works for viewing and small fits; heavy settings disabled with an explanation.
- Accessible: keyboard-operable controls, live region announcing "done".

## Performance targets
- 8k blobs at 512 px: visibly good in < 30 s on a mid-range laptop GPU.
- UI stays responsive (GPU work in chunks per animation frame; no main-thread freezes).
- Memory: release GPU buffers on new photo.

## Phases
1. **Fitter core + live view + PNG export**: WebGPU fitter (render, loss, gradients, Adam), live canvas + counters,
   snapshots, PNG export at 2k/4k/8k via tiled render. Test images live in `test-images/`, which is
   gitignored: photos never go into the repository.
2. **Video export**: snapshot interpolation, 3 formats, overlays, WebCodecs + muxer, progress bar, cancel.
3. **Styles + poster presets + project file**.
4. **Polish + deploy**: onboarding hint, error states, WebGPU fallback message, README with screenshots,
   open-source licence (decide), deploy.

## Out of scope (v1)
Generating new faces, training on other people's photos, server processing, 3D view, accounts.

## Decisions
Where these differ from the text above, these win.

Decided before Phase 1A (2026-11-12):
1. **Blending** is order-independent and normalized, not sorted alpha compositing:
   `w_i(p) = a_i * exp(-0.5 * d^T * Sigma_i^-1 * d)`, `d = p - mu_i`
   `C(p) = (sum_i w_i*c_i + eps*bg) / (sum_i w_i + eps)`
   The formula and its derivative live in one place per language so they can be swapped together:
   `BLEND_WGSL` in `src/renderer/shaders.ts` and `src/reference/blend.ts`.
2. **Forward render** = instanced quads (3-sigma bounds) with additive blending into a float accumulation target
   (rgb = sum w*c, a = sum w), then a resolve pass. No tile binning, no compute rasteriser.
   **Target format (changed 2026-11-12):** rgba32float when the device has `float32-blendable`, otherwise
   rgba16float ("reduced precision"). Originally rgba16float only. Reason, measured on the self-test's subsampling
   case (Intel UHD, relative error of the GPU gradient against the float64 CPU reference):
   - full gradient: 4.1e-2 with rgba16float, 8.1e-5 with rgba32float;
   - one subsampled grid against the CPU on the same grid: 4.3e-1 with rgba16float, 1.4e-4 with rgba32float.
   The shaders are identical in both runs, so the difference is the 16-bit accumulation. In one 8k-blob run each on
   a synthetic image, rgba16float also drove blobs to the sigma cap faster (805 at step 933, against 186 at step 814
   with rgba32float).
3. **Backward** = per-blob gather in a compute shader: each blob loops over the pixels in its own bounds and reads
   the per-pixel loss gradient and accumulation textures. No float atomics, no sorting.
4. **Blob params** (9 floats): x, y, log_sx, log_sy, theta, r, g, b, a. Positions and sigmas are normalized to the
   image long side (resolution independent). `a` stays in (0,1) as the sigmoid of a raw param.
5. **Phase 1 scope cuts**: L1 loss only (no SSIM), fixed blob count (no densify/prune).
6. **Bounded GPU work**: sigma is capped and large footprints are subsampled with correct weighting, so one huge
   blob can never stall the GPU.
7. **Phase 1 is split.** 1A = fitter core + gradient verification (CPU reference, vitest, in-app GPU self-test) +
   minimal live view. Snapshots, scrubber, loss curve and PNG export come after 1A.

Made while building Phase 1A (open to change):
- **3-sigma cut-off is part of the weight**: `w = 0` where `d^T Sigma^-1 d >= 9`, on GPU and in the CPU reference.
  The analytic gradient ignores the movement of that boundary.
- **eps = 0.01**; **bg** = mean colour of the downscaled photo. The fit runs directly on sRGB-encoded values.
- **Limits applied after each Adam step**: sigma in [0.3 px, min(0.15, sqrt(200 * area / N) / 6)] of the long side
  (bounds average overdraw to about 200 blobs per pixel), colours in [0, 1], raw opacity in [-8, 8], centres at most
  2% of the long side outside the image.
- **Gather subsampling**: a blob reads at most `maxSide x maxSide` pixels per step. `maxSide` is the bounding box of
  a blob at the sigma cap, `floor(6 * sigmaMax * longSide) + 2` px (82 px at 512x512 with 8k blobs), so every blob
  within the cap is read at full stride and subsampling is only a safety net beyond it. Larger boxes use a jittered
  grid and each sample counts for the pixels it stands for. Worst case per step: 200 x width x height pixel reads,
  the same bound as the forward pass. (Until 2026-11-12 `maxSide` was `clamp(sqrt(2e7 / N), 16, 128)`, which
  subsampled blobs at the cap at stride 2.)
- **Adam**: beta 0.9 / 0.999, eps 1e-10; learning rates x, y 5e-4 · log sigma 0.01 · theta 0.01 · colour 0.005 ·
  raw opacity 0.02. Not tuned on real photos yet.
- **Init modes** (setting "Start from", 2026-11-12). All three: opacity 0.5 (raw 0), theta 0, seeded. Same seed +
  same photo + same mode gives identical initial params.
  - **painting** (default): only `START_BLOBS = 32` blobs are active at step 0, at seeded uniform positions, every
    blob the mean colour of the photo, sigma = 0.5 × the average blob spacing at the active count. The active count
    then grows to the chosen blob count (see Progressive growth).
  - **blank**: all blobs active from step 0, uniform random positions, every blob the mean colour of the photo,
    sigma = 1.0 × average blob spacing. Step 0 is a flat canvas. Nothing but the mean colour comes from the photo.
    In practice this reads as a blur that sharpens rather than as painting.
  - **photo** ("the photo" in the UI): all blobs active, sigma = 0.5 × spacing, colour from the pixel; one third of the blobs are placed uniformly, the rest
    follow edge strength (Sobel on luminance). Step 0 already resembles the photo.
  - Measured on one 288x512 photo, 8k blobs, Intel UHD: after 5,000 steps blank reaches a mistake of 0.45% and photo
    0.32%, and blank runs at roughly a third of the steps per second (its blobs stay larger). Not tuned.
- **Progressive growth** ("painting" mode only).
  - **Active count**: the buffers are allocated for the full blob count up front and never resized. Only the first
    `activeCount` blobs exist for the maths: the forward pass draws only them, the gather and the Adam step only
    dispatch for them. Inactive blobs contribute exactly nothing (checked in vitest against the CPU reference and in
    the GPU self-test, bit for bit). Every size limit that depends on the blob count (sigma cap, `maxSide`) is
    computed from the active count and recomputed at each growth event.
  - **Schedule**: defined in steps, not seconds, so the same seed grows identically (`growthSchedule` in
    `src/fitter/growth.ts`). The active count rises geometrically from `START_BLOBS` to the target, 4 events per
    doubling. The first doubling takes `GROWTH_FIRST_DOUBLING_STEPS = 20` steps and each later one
    `GROWTH_DOUBLING_RATIO = 1.3` times as many as the one before (20, 26, 34, 44, ...), because steps with few,
    large blobs are slow and steps with many small blobs are fast. 32 -> 8,000 is 32 events; growth ends at step 477.
    (Until 2026-11-12: a constant 40 steps per doubling, growth ending at step 320, which rushed 512 -> 8,000 into
    about 5 s.)
  - **Pace cap** (`GROWTH_MIN_SECONDS = 25`): during growth the step count may not run ahead of an even spread of the
    growth events over 25 s of fitting time (pauses excluded): event k of E not before k / E × 25 s, the allowed step
    rising evenly in between (`growthStepLimit`). Without it growth took 17.7 s to 29 s on this PC depending on the
    run; with it, 25.8 / 25.9 / 28.4 s over three runs (production build, test photo, 8k blobs). Slower machines
    never reach the cap. No cap after growth.
  - **Growth event**: stepping waits for one readback of the per-pixel error (|C - T| summed over r, g, b). New blobs
    are placed in proportion to that error with a PRNG seeded from the seed and the event number, take the colour of
    the target pixel there, and start at sigma = 0.5 × the average spacing at the new active count, opacity 0.5,
    theta 0. Their Adam state is zero, and each blob counts its own Adam steps from the step it was added, so its
    first update is a proper first Adam step.
  - Measured on the 288x512 test photo, 8k blobs, Intel UHD, in the app: 64 blobs at 4.5 s, 512 at 15.1 s, 8,000 at
    29 s (step 479); doublings took 2.4-5.1 s each. Mistake at 1k / 2k steps: 0.373% / 0.328%, against 0.368% /
    0.332% with the old constant schedule. Two runs with the same seed gave bit-identical params after growth (old
    schedule), on this GPU.
- **Auto-stop** (all modes, `src/fitter/autoStop.ts`). Judged from the existing loss readbacks only, and only once
  growth is complete: the fit stops when the mean mistake over the last `STOP_WINDOW_STEPS = 250` steps is less than
  `STOP_MIN_IMPROVEMENT = 0.5%` (relative) below the mean over the 250 steps before, or after `MAX_STEPS = 8000`
  steps. The history restarts when growth completes and on every resume. "Done" is announced in an aria-live region;
  Resume continues past it.
- **Compact blob code, format 1** (`src/code/blobCode.ts`, 2026-11-12). A printable text file that is the picture:
  a 4-line header, then one fixed-width line per active blob, 7 lowercase hex fields separated by single spaces.
  ```
  CODE FACE 1
  Re-painted from a photo with 8,000 blobs.
  blobs 8000 seed 1 aspect 9:16 background 534431
  x    y    w   h   ang colour op
  5cea 0000 a24 934 065 76624e 39
  ```
  | Field | Bits | Range and mapping |
  |---|---|---|
  | x, y | 16 each | centre as a fraction of the long side, linear from -0.02 to 1.02 (the fitter's position clamp) |
  | w, h | 12 each | sigma along the blob's own axes, linear in log2 from -12 to -2 (1/4096 to 1/4 of the long side) |
  | ang | 12 | angle modulo 180 degrees, 4096 steps around the half turn |
  | colour | 8 per channel | rrggbb |
  | op | 8 | opacity a = sigmoid(raw), linear 0 to 1; decoded inside the fitter's raw limit of +-8 |
  - Header: format version; the honest sentence "Re-painted from a photo with N blobs."; blob count, seed, aspect ratio
    (width:height of the working image, reduced) and background colour (rrggbb). Decoding is strict and reports the
    line number of anything malformed; it accepts CRLF and a missing final newline.
  - Bit widths chosen on the 288x512 test photo after a 2,000-step default fit (8,000 blobs). Rendering the decoded
    blobs raises the mistake from 0.3285% to 0.3397% (+0.0113 percentage points). Measured alternatives: 12-bit
    positions alone cost +0.021 pp; 12-bit colour channels would make it near-lossless (+0.0002 pp) but the colour
    field would no longer read as rrggbb. About 32 bytes per blob (256 KB for 8,000).
  - Round-trip tests: every field within half a quantization step; encoding the decoded text gives the same text.
  - **Download code** saves the current blobs (running, paused or done) as `code-face-<seed>-<blobs>.txt`, with the
    sentence "This text file is your picture: it lists every blob, which is all it takes to redraw it."
  - **Open code file** (built 2026-11-12): "Open code file" in the controls (or dropping a .txt on the stage) decodes
    a code file and shows its picture in a "viewing" state: nothing is fitted (there is no photo to fit to), Pause is
    disabled, the mistake shows as "-", the counter reads "FROM FILE · N BLOBS", the code panel shows the same evenly
    spaced sample as after a fit, and the caption and event log say the picture comes from the file. The picture is
    drawn by the normal renderer at a 512 px long side; its target image is a flat fill in the file's background
    colour and is never used. "Download code" from the viewer gives a byte-identical file. A malformed file shows
    the decoder's line-numbered error and leaves the current picture alone. The sentence next to "Download code":
    "This text file is your picture: every blob is in it. Open it here again with "Open code file" to see the
    picture."
  - The code file is not the planned `.codeface.json` project file: it has no start mode, blob target, working
    resolution or fit state, so a fit cannot be continued from it.
- **Live code panel** (`src/ui/CodePanel.tsx`, 2026-11-12). Real data only: the compact lines of 36 current blobs,
  with the blob number in a gutter and a swatch of each blob's colour at the end of its line.
  - While the active count is growing it shows the newest 36 blobs; lines added since the previous readback are
    marked "+". Once all blobs are active it shows a fixed, evenly spaced sample whose lines change in place.
  - A legend aligned with the columns and a one-line key: "x y position · w h size · ang angle · colour · op opacity".
  - Placement: portrait or square picture: explanations | picture | code, equal side columns so the picture is
    centred in the stage. Landscape picture, or a viewport under 76rem: picture on top, explanations and code side
    by side below (code in columns, 12 lines high). Under 720 px: picture, then explanations; no code. The panel is
    `aria-hidden`.
  - Cost: the 36 blobs ride on the existing loss readback (copied on their own, about 1.3 KB; no extra per-step
    readback), so the panel updates about 2.6 times per second. Production build, test photo, 8k blobs: 53.6 / 92.2
    / 59.3 steps/s with the panel against 54.4 / 79.5 / 56.4 without (during growth, 29-40 s, 40-60 s): no
    measurable difference.
- **Captions** (`src/ui/caption.ts`) above the code panel, in an `aria-live="polite"` region. One per phase: start (a
  few big blobs in the average colour), growth (blobs added mostly where the mistake is largest), refining (all N
  blobs, only adjusted), done (blob count, steps and final mistake, or the step limit). Blank and photo starts have
  their own refining wording.
  Below the caption, an **event log** (`src/ui/eventLog.ts`, `role="log"`, `aria-live="off"`) of real fit events:
  start, growth (consecutive events merged), mistake milestones (below 10%, 5%, 1%, 0.5%), all blobs in place, done,
  resumed. One sentence per entry, at most one new entry every 1.5 s, newest first. Every number in a caption is fixed for its phase, so the region only speaks on a phase
  change. Plain English, at most two sentences, never "AI-generated" (checked in tests). On phones only the caption
  shows, below the picture.
- **Code poster export** (built 2026-11-12, "Download code as image", `src/poster/`). The real code file as an image:
  the 4 header lines as a band at the top, then every blob line in file order, down a column and on to the next.
  Nothing is left out or invented; the text is exactly what "Download code" saves.
  - Options: orientation (portrait / landscape); frame at 300 dpi: A4 (2480 x 3508 px), A3 (3508 x 4961),
    30 x 40 cm (3543 x 4724), 50 x 70 cm (5906 x 8268); style plain (one ink colour) or tinted (each character in the
    painted picture's colour at the character's centre, the picture cover-fitted to the block of text); background
    dark (#111214) or paper (#f3eee3); SVG (default), PNG or JPEG (quality 0.92).
  - **SVG** (2026-11-13, `src/poster/svgPoster.ts`, pure and tested): the same layout function, the same lines and
    the same footer line, with every code line a real `<text>` element (one per line) placed at the PNG's position
    (baseline = line top + the font's ascent, 1020/1320 of the em, measured from the font). JetBrains Mono is
    embedded as a base64 woff2 `@font-face`, with its copyright notice and the full OFL text in a comment. Page size
    in mm, viewBox in 300 dpi pixels. Plain: text filled with the ink colour. Tinted: the painted picture drawn afresh
    from the blobs at 2048 px on its long side (the normal renderer with its own buffers; nothing is fitted),
    embedded once as JPEG 0.92, cover-fitted to the text block, with the code text as its `clipPath`: glyph edges
    stay vector, colours come from the picture. Measured at 8,000 blobs (Intel UHD): A4 and 50 x 70 both about
    0.58 MB plain and 0.83 MB tinted, made in 0.1-0.3 s. Renders correctly in Chrome and Firefox; LibreOffice draws
    the plain one with its own monospace font and the tinted one wrongly (it treats the text clip as line boxes).
    PDF is not offered: it would need a new dependency.
  - **Paper contrast floor** (2026-11-13, `src/poster/inkContrast.ts`, tested): on the paper background every tinted
    glyph colour keeps at least 3:1 (WCAG 2) against #f3eee3. Colours under that are darkened in linear light (hue
    and saturation kept) to 3.15:1; others are untouched. PNG/JPEG: per character. SVG: every pixel of the embedded
    picture; the JPEG is then decoded and checked, darkened with a wider margin (3.4, 3.7) if any pixel fell under
    3:1, and embedded as PNG as a last resort. On the test photo the first retry passes (worst pixel 3.09:1); a
    paper SVG then takes about 1.4 s instead of 0.3 s.
  - Layout (`posterLayout`, pure and tested): margin 6% of the short side, line height 1.2, 2 characters between
    columns, an empty line under the header, footer at 8 pt. Every column count is tried and the one that allows the
    largest type wins. The panel shows the pixel size and the type size in pt; below 5 pt it warns that the code
    will read as texture and names the largest blob count that would reach 5 pt on that frame. At 8,000 blobs the
    type is 1.4 pt (A4 portrait) to 3.3 pt (50 x 70 portrait).
  - Footer line: "CODE FACE · re-painted from a photo with N blobs · seed S". File name:
    `code-face-<seed>-<blobs>-<frame>-<orientation>.svg|png|jpg`.
  - Font: JetBrains Mono Regular, Latin subset (woff2 from @fontsource/jetbrains-mono 5.3.0, 21 KB), SIL Open Font
    License 1.1, bundled in `src/assets/fonts/` with its licence and served by the app itself. Drawing waits for it
    to load; there is no fallback font.
  - Drawing and encoding run in a Web Worker on an OffscreenCanvas, with progress and Cancel (which terminates the
    worker). The page prepares the text and the picture first (one task of about 180 ms), then stays responsive
    (worst timer delay 76 ms during a 50 x 70 export). A canvas that cannot be created or encoded gives a clear
    error suggesting a smaller frame; a file is saved only when the whole image was encoded. A running fit is
    paused before the export, so the code and the tint come from the same state.
  - Measured on Intel UHD, 8,000 blobs: A4 2.1 s, A3 JPEG 1.5 s, 30 x 40 3.1 s, 50 x 70 2.4 s (PNG, 29 MB) and 1.7 s
    (JPEG). All four frames encoded without trouble on this machine.
- **OPEN ISSUE: early growth steps are expensive.** At low active counts the sigma cap is large (76.8 px at 32 blobs
  on a 512 px long side) and `maxSide` follows it, so a single gather invocation walks a very large footprint.
  Measured on Intel UHD, 288x512 photo: up to about 248 ms for one step (at 76 active blobs), 116-144 ms mean with
  32-91 blobs, about 20 ms by 5,800 blobs. This limits how fast the first seconds of painting can run. Not fixed.
- **Pacing**: the step shown after t seconds of fitting is at most `e^(PAINT_SPEED * t) - 1` (`PAINT_SPEED = 0.7`
  in `src/fitter/settings.ts`), so the first steps appear one by one and the batches grow until the GPU is the
  limit. A new batch is submitted only after the GPU finished the previous one; the batch size adapts towards about
  30 ms. The canvas is updated after every batch. The loss is read back every 25 steps or every 0.5 s, whichever
  comes first, never per step.
- **Layout**: the page does not scroll. The canvas keeps the fit resolution and is scaled to the stage with its
  aspect ratio; the counters are pinned at the top of the panel and only the controls below them scroll.
- **Stack versions**: Vite 8.3, React 19.3, TypeScript 7.0, vitest 5.1. WebGPU types come from TypeScript's DOM lib
  plus `src/webgpu-flags.d.ts`; no `@webgpu/types` dependency.
- **Self-test limits are strict for the format the app fits with.** With rgba32float, the rgba16float results are
  shown for information. On a device with rgba16float only, its limits are strict except the per-grid subsampling
  check, which is informational, and the readout says "reduced precision".
- **Dev tools** (dev build only): GPU self-test, a readout of steps/s, mean and max sigma and blobs at the sigma cap,
  and a toggle between the two accumulation formats.
- **OPEN ISSUE: 1024 working resolution is not enabled until the per-step cost is bounded.** Measured at 8k blobs on
  Intel UHD with rgba32float: about 326 ms/step in a typical fitted state, and up to 2.4 s for a single step in the
  worst case (every blob at the sigma cap). 512 px long side stays the only working resolution for now. Not fixed.

## Release (2026-11-13)
Public repository https://github.com/RekaWeb3Design/code-face, MIT licence ("Copyright (c) 2026 Réka Víg"); the
fonts keep OFL 1.1 and their licences are also served at `/licenses/`.
- **Privacy rule for the repository**: no photo of a person, and nothing made from one (code file, poster, SVG,
  screenshot), ever goes into git. `test-images/` and `.playwright-mcp/` are gitignored, as are image files and
  `code-face-*` outputs anywhere except `docs/` and `public/`. Every image for the repo comes from a landscape or
  product photo. Audit on 2026-11-13: no image, screenshot, code file or photo-derived data in any of the first
  40 commits.
- **Two pages** (Vite multi-page build): `/` is the landing (`index.html`, static, its own CSS only: no app bundle
  and no WebGPU code), `/app/` is the app (`app/index.html`). `/app` redirects to `/app/` (Cloudflare does this
  itself; `vite.config.ts` does the same for the dev and preview servers). `404.html` is a static page, so Pages
  answers unknown paths with a real 404 instead of the landing. The app's wordmark links to `/`. The landing is a
  placeholder until the real one is built from a mockup.
- **Landing renderer** (`src/landing/drawCode.ts`): draws a code file on a 2D canvas with the CPU reference's own
  `readBlob`, `blobWeight` and `resolveColor`, each blob visiting only its 3-sigma box. Vitest checks it gives the
  same bytes as `forward()`. 8,000 blobs at 512 px take about 180 ms (Intel UHD laptop, Chrome).
- **Landing demo files**: real code files of one painting at 32, 128, 512, 2,048 and 8,000 blobs, to go in
  `public/demo/`. Made with `?dev&stages=32,128,512,2048,8000`, which saves the first N blobs just before the
  growth event that leaves N (the copy is queued before `grow()` writes the new blobs), and the final state when
  done. Not made yet: there is no landscape or product photo yet (see `docs/landing-demo.md`).
- **Error states** (one line each, with a way forward):
  - photo: not an image file; a HEIC file the browser cannot decode; any other undecodable image; a file over
    40 MB (`src/ui/photoErrors.ts`, tested);
  - GPU device lost (any reason except the app's own `destroy()`): the fit stops, "The GPU stopped responding, so
    the painting was lost." with "Restart the painting" (a new device, then the loaded photo starts again) or
    "Restart the GPU" when no photo is loaded. `?dev` exposes `codeFaceSimulateDeviceLoss()`, a real `destroy()`
    counted as a loss;
  - poster export failure: unchanged (names the frame, nothing saved);
  - no WebGPU: unchanged text, plus a link back to `/`.
- **Blob cap on weak GPUs** (`src/fitter/blobCap.ts`, tested): WebGPU reports no speed, so this goes by the
  adapter: a software (fallback) adapter caps a fit at 2,000 blobs; an adapter whose `maxStorageBufferBindingSize`,
  `maxBufferSize`, `maxTextureDimension2D` and `maxComputeWorkgroupStorageSize` are all at WebGPU's minimum caps
  it at 4,000. The reason is shown under the blob count (`aria-describedby`). `?dev&lowgpu` simulates the second.
  The device itself is still requested with default limits.
- **Phones** (checked at 390 x 844): the page still does not scroll; the phase chips and footer are compact so
  nothing overflows. Viewing and fits up to the cap work. Under 720 px the code itself stays hidden, but when paused,
  done or viewing a code file the downloads ("Download code poster", "Code as text") sit under the picture (at
  most 34% of the height, scrolling inside); while the poster options are open they also take the place of the
  counters and the explanations, so the picture keeps some room (228 x 152 px at 390 x 844). Checked: SVG poster
  and code downloads from a paused fit, a finished fit and an opened code file.
- The phase caption's live region is `aria-atomic`, so "Done." is announced with its sentence.
- **Hosting: Cloudflare Pages.** Build command `npm run build`, output directory `dist`, Node 22 (`.node-version`
  says 22.16.0; `engines` >= 22.12, which Vite 8 needs). No functions, no environment variables.
- **Response headers** (`public/_headers`). Pages merges the headers of every matching rule, so the CSP is set on
  `/*` and detached (`! Content-Security-Policy`) and replaced on `/`, `/app/*` and `/assets/*`; every response carries
  exactly one policy (checked with `wrangler pages dev`).
  - static pages (404, licences, favicon): `default-src 'none'; style-src 'self'; font-src 'self';
    img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`.
  - landing `/`: the same plus `script-src 'self'` (its own module only; no inline scripts, no eval) and
    `connect-src 'self'` (it fetches the demo code files from `/demo/`).
  - app and `/assets/*`: `default-src 'none'; script-src 'self'; worker-src 'self'; style-src 'self';
    font-src 'self'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; form-action 'none';
    frame-ancestors 'none'`. `blob:` only for images (the loaded photo's thumbnail); downloads are blob: links,
    which the CSP does not govern. `/assets/*` carries the app policy because the poster worker takes its policy
    from its own response (it loads the poster font with `FontFace` and `fetch`). No `data:` anywhere: the SVG
    poster's embedded font and picture are made into data: URLs as text, never loaded by the page.
  - everywhere: `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(), microphone=(), geolocation=(),
    browsing-topics=()`, `X-Content-Type-Options: nosniff`, `Cross-Origin-Opener-Policy: same-origin`; hashed
    `/assets/*` are cached for a year (`immutable`).
  - Verified 2026-11-13 on the production build served by `wrangler pages dev` (Chrome via Playwright, Intel UHD):
    landing (no scripts), `/app` and `/app/` with reloads, an 8,000-blob fit to Done, a tinted paper SVG and a
    tinted dark PNG poster, code download, opening that code file: no console errors, no CSP violations, no
    request to any other origin.
- No analytics, no cookies, no runtime requests to other origins.

