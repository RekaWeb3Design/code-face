// Text that decodes from random hex: each frame, characters not yet revealed show a random hex digit.
// Spaces and punctuation stay put. Only for monospaced text, so nothing changes width.
const HEX = '0123456789abcdef'

export function scrambled(text: string, revealed: number, upper = false): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (i < revealed || !/[a-z0-9]/i.test(c)) out += c
    else {
      const h = HEX[Math.floor(Math.random() * 16)]
      out += upper ? h.toUpperCase() : h
    }
  }
  return out
}

// Runs the decode on the element over `ms`, then leaves the real text. `holdMs` keeps it fully
// scrambled for a moment first.
export function decode(element: HTMLElement, text: string, ms: number, holdMs = 0, upper = false): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now()
    const frame = (now: number) => {
      const t = Math.max(0, now - start - holdMs) / ms
      if (t >= 1) {
        element.textContent = text
        resolve()
        return
      }
      element.textContent = scrambled(text, Math.floor(t * text.length), upper)
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
}
