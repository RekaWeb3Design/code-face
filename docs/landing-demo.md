# Landing demo files

Real Code Face code files in `public/demo/`, saved at five growth stages of one painting, for the landing
page. They are drawn there by `src/landing/drawCode.ts` (Canvas2D, same blend as the CPU reference).

Source: the owner's own photo of a windowsill (plants, a toy dinosaur, a small statue; no person), 1536 x 2048,
portrait 3:4. The photo itself is never committed: it lives in `test-images/` (gitignored). Everything committed
that is made from it (stage files, poster preview, og image, README screenshots) carries no metadata;
`npm run release-check` checks that.

To make the files again:

1. `npm run dev`, open `http://localhost:5173/app/?dev&stages=32,128,512,2048,8000` in a browser with WebGPU.
2. Load the photo, keep 8,000 blobs and seed 1, press Start and let it finish.
3. The browser downloads `stage-00032.txt` ... `stage-08000.txt`; move them into `public/demo/`.
4. Measure each stage's mistake (stage drawn with `renderBlobs` at 384 x 512 against the photo loaded with
   `src/ui/loadPhoto.ts`, mean absolute difference per channel) and update `src/landing/demo.ts`, including
   `DEMO_ASPECT` and `DEMO_BACKGROUND` (the vitest checks keep the CSS and HTML in step with them).
5. Poster preview: open `stage-08000.txt` in the app, download the A4 portrait, tinted, dark PNG poster, and save
   it scaled to 1200 and 720 px high as `public/poster/demo-poster-1200.webp` / `-720.webp`, plus a 480 x 300
   crop at full size as `demo-poster-detail.webp`.

Measured on 2026-11-13: 32 blobs 14.82 %, 128 blobs 7.54 %, 512 blobs 4.70 %, 2,048 blobs 2.57 %,
8,000 blobs 0.54 % (the app showed 0.55 % at the end). At 8,000 blobs the painting is almost the photo, so the
hero's loop ends on 2,048 (`HERO_LAST` in `src/landing/demo.ts`).
