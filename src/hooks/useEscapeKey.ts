import { useEffect, useRef } from 'react'

// Calls onEscape when Escape is pressed while enabled. The callback is held in a
// ref so passing an inline arrow doesn't re-bind the listener every render — the
// effect only re-runs when `enabled` changes.
export function useEscapeKey(enabled: boolean, onEscape: () => void): void {
  const onEscapeRef = useRef(onEscape)
  onEscapeRef.current = onEscape

  useEffect(() => {
    if (!enabled) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onEscapeRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [enabled])
}
