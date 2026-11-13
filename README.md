# Code Face

**Your photo, re-painted from thousands of soft colour blobs, right in your browser.**

Live: **https://codeface.rekavig.com** · Source: https://github.com/RekaWeb3Design/code-face

Drop in a photo and watch it being painted again from scratch: first a few big blobs in the photo's average
colour, then more and more smaller ones where the picture is still wrong, until the mistake stops shrinking.
The result is not a filter over your photo and it is not AI-generated: it is a few thousand ellipses
(position, size, angle, colour, opacity), fitted to your photo by gradient descent on your own GPU.

You can keep the result as:

- **a code file**: a small text file that lists every blob. It *is* the picture: open it in Code Face again
  and the picture is redrawn from it;
- **a code poster**: that same text laid out as a print-ready poster (A4 to 50 x 70 cm, SVG, PNG or JPEG),
  optionally with every character coloured by the painting.

<!-- Screenshots go in docs/ and must come from a landscape or product photo, never a person. -->
_Screenshots: coming soon._

## Privacy

- The photo never leaves your device. There is no server-side processing, no account, no upload.
- No analytics, no cookies, no trackers, no fonts or scripts from other sites. The pages' Content Security
  Policy only allows the site's own files, so the app could not send your photo anywhere even by mistake.
- Downloads (code files, posters) are made in your browser and saved straight to your device.
- The site is hosted on Cloudflare Pages; like any web host, Cloudflare handles the requests for the site's
  files.

## Browser support

Code Face needs **WebGPU** and has no slower fallback.

- Chrome or Edge, current version, on a computer: supported. This is where it is developed and tested
  (Windows, Intel integrated graphics).
- Safari 26 or newer: should work (WebGPU is on by default); not tested yet.
- Firefox: WebGPU is shipping platform by platform; not tested yet.
- Phones: viewing and small fits. Phones and other GPUs that report only WebGPU's minimum limits are capped
  at 4,000 blobs.

Without WebGPU the app says so and links back to the home page.

## Run it locally

Needs Node.js 22 (see `.node-version`).

```sh
npm install
npm run dev        # http://localhost:5173/ (landing) and http://localhost:5173/app/ (the app)
npm test           # unit tests (vitest)
npm run build      # type-check and build both pages into dist/
npm run preview    # serve the production build
```

Add `?dev` to the app's URL for developer tools (GPU self-test, readouts).

## How it works

- **Blobs**: each blob is a 2D Gaussian with 9 numbers: centre x, y; size along its two axes; angle;
  red, green, blue; opacity.
- **Blending**: order-independent and normalized. Each pixel is the weighted average of the blobs' colours,
  weighted by how strongly each blob covers it, with a little of the background colour mixed in.
- **Fitting**: the photo is downscaled to 512 px on its long side. Every step renders the blobs, compares
  them with the photo (mean absolute error, the "mistake"), computes the exact gradient of that error for
  every blob parameter and moves all of them a little (the Adam optimiser). All of this runs in WebGPU
  shaders; there is no machine-learning library.
- **Growth**: a painting starts with 32 blobs and doubles in steps up to the chosen count (8,000 by
  default). New blobs are placed where the mistake is largest.
- **Stopping**: when the mistake has stopped improving, or after 8,000 steps. You can keep refining.
- **Code file**: one line per blob, seven hex fields. Small enough to print, exact enough to redraw the
  picture (see `CODE_FACE_SPEC.md`).
- **Checks**: the GPU gradients are tested against a float64 CPU reference implementation (vitest and an
  in-app self-test).

More detail, measurements and every design decision: [`CODE_FACE_SPEC.md`](CODE_FACE_SPEC.md).

## Credits

- Fonts: [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) and
  [Space Grotesk](https://github.com/floriankarsten/space-grotesk), both under the SIL Open Font License 1.1
  (licences in `src/assets/fonts/`, also served at `/licenses/`). Bundled with the app; nothing is loaded from
  font services.
- The idea came from an Instagram reel by heysirio.
- Built with Vite, React and TypeScript.

## Licence

MIT, © 2026 Réka Víg. See [`LICENSE`](LICENSE). The fonts keep their own licence (OFL 1.1).

Made by Réka Víg · https://rekavig.com · hello@rekavig.com
