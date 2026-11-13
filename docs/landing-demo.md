# Landing demo files

Real Code Face code files for `public/demo/`, saved at a few growth stages of one painting, for the landing page. They are
drawn there by `src/landing/drawCode.ts` (Canvas2D, same blend as the CPU reference).

Source rule: a landscape or product photo only, never a person.

**Status: not made yet.** The only photos available so far show a person. To make them from a
landscape or product photo:

1. `npm run dev`, open `http://localhost:5173/app/?dev&stages=32,128,512,2048,8000`.
2. Load the photo, keep 8,000 blobs and seed 1, press Start and let it finish.
3. The browser downloads `stage-00032.txt` ... `stage-08000.txt`; move them into `public/demo/`.
