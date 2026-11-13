import {useEffect, useRef, useState} from 'react'

// True when the visitor asked for less motion; checked when called.
export const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

// Eases the shown number towards `target` over `ms` (no easing with reduced motion).
export function useTweened(target: number, ms = 300): number {
  const [shown, setShown] = useState(target)
  const from = useRef(target)
  const shownRef = useRef(target)
  shownRef.current = shown
  useEffect(() => {
    if (!Number.isFinite(target) || !Number.isFinite(shownRef.current) || prefersReducedMotion()) {
      setShown(target)
      return
    }
    from.current = shownRef.current
    const started = performance.now()
    let frame = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - started) / ms)
      const eased = 1 - (1 - t) ** 3
      setShown(from.current + (target - from.current) * eased)
      if (t < 1) frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [target, ms])
  return shown
}
