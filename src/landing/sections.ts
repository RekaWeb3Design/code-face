import type {Hero} from './hero'

// The sections under the hero: thumbnails drawn from the demo's painted stages, and code lines that copy
// themselves to the clipboard.

export function initSections(hero: Hero): void {
  // Thumbnails: drawn once, shortly before their section comes into view.
  const thumbs = [...document.querySelectorAll<HTMLCanvasElement>('canvas[data-thumb]')]
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const canvas = entry.target as HTMLCanvasElement
        observer.unobserve(canvas)
        void hero
          .stage(Number(canvas.dataset.thumb))
          .then((stage) => {
            const width = Math.max(1, Math.round(canvas.clientWidth * Math.min(2, devicePixelRatio)))
            const height = Math.max(1, Math.round((width * stage.canvas.height) / stage.canvas.width))
            canvas.width = width
            canvas.height = height
            const ctx = canvas.getContext('2d')
            if (!ctx) return
            ctx.imageSmoothingQuality = 'high'
            ctx.drawImage(stage.canvas, 0, 0, width, height)
          })
          .catch(() => {})
      }
    },
    {rootMargin: '400px 0px'},
  )
  for (const canvas of thumbs) observer.observe(canvas)

  // Copying a code line.
  const status = document.querySelector<HTMLElement>('.copy-status')
  const timers = new WeakMap<HTMLElement, number>()
  for (const button of document.querySelectorAll<HTMLButtonElement>('.copy-line')) {
    button.addEventListener('click', () => {
      const line = button.dataset.line ?? ''
      const blob = Number(button.dataset.blob) + 1
      const copy = navigator.clipboard ? navigator.clipboard.writeText(line) : Promise.reject(new Error('no clipboard'))
      copy.then(
        () => {
          button.classList.add('done')
          clearTimeout(timers.get(button))
          timers.set(button, window.setTimeout(() => button.classList.remove('done'), 1400))
          if (status) status.textContent = `Copied the line of blob ${blob}.`
        },
        () => {
          if (status) status.textContent = 'Could not copy here; select the line and copy it by hand.'
        },
      )
    })
  }
}
