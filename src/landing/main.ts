// The landing page's only script. It never loads the app or touches WebGPU: the demo is drawn on 2D
// canvases from the real code files in /demo/.
import {initHero} from './hero'

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
document.documentElement.classList.toggle('reduced', reduced)

initHero(reduced)
