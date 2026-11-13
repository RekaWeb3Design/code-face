// The landing page's only script. It never loads the app or touches WebGPU: the demo is drawn on 2D
// canvases from the real code files in /demo/.
import {initCursors} from './cursors'
import {initHero} from './hero'
import {initSections} from './sections'

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
document.documentElement.classList.toggle('reduced', reduced)

const hero = initHero(reduced)
initSections(hero)

if (reduced) {
  // No cursors with reduced motion, so the hint does not promise them.
  const hint = document.querySelector('.hint-text')
  if (hint) hint.textContent = 'SCROLL'
} else {
  const chips = [...(document.querySelector<HTMLTemplateElement>('#cursor-chips')?.content.children ?? [])].map((el) => ({
    blob: Number((el as HTMLElement).dataset.blob),
    colour: (el as HTMLElement).dataset.colour ?? '9299a3',
  }))
  const phone = matchMedia('(max-width: 640px)').matches
  // The pool (12 on desktop, 4 on phones) and the helpers that join while jobs back up.
  initCursors(chips, phone ? 4 : 12, phone ? 4 : 8)
}
