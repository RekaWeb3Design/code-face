# Landing demo files

Real Code Face code files in `public/demo/`, saved at five growth stages of one painting, for the landing
page. They are drawn there by `src/landing/drawCode.ts` (Canvas2D, same blend as the CPU reference).

Source rule: a landscape or product picture only, never a person. None of the available test photos
qualified (they all show a person), so the source is a **procedural landscape** made by
`scripts/demo-landscape.py` (sky, sun, mountain ridges, a lake and pines drawn with maths; no photo).
The picture itself is not committed; the script makes the same one again.

To make the files again:

1. `python scripts/demo-landscape.py landscape.png`
2. `npm run dev`, open `http://localhost:5173/app/?dev&stages=32,128,512,2048,8000` in a browser with WebGPU.
3. Load `landscape.png`, keep 8,000 blobs and seed 1, press Start and let it finish.
4. The browser downloads `stage-00032.txt` ... `stage-08000.txt`; move them into `public/demo/`.
5. Measure each stage's mistake (stage drawn with `renderBlobs` at 512 x 341 against the picture loaded
   with `src/ui/loadPhoto.ts`, mean absolute difference per channel) and update `src/landing/demo.ts`.

Measured on 2026-11-13: 32 blobs 11.68 %, 128 blobs 3.52 %, 512 blobs 1.79 %, 2,048 blobs 0.54 %,
8,000 blobs 0.05 %. (The app itself showed 0.08 % at the end; it measures on the GPU in floating point.)
