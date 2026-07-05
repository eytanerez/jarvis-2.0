// Real window visibility, fed by the main process. Chromium background
// throttling is disabled process-wide (streaming must keep painting while
// the window is blurred), which means document.hidden NEVER goes true in
// this app — even minimized, hidden via Cmd+H, "closed" on macOS
// (hide-on-close), or behind a locked screen. The orb backdrop uses this
// store to park its WebGL render loop when nobody can see it; before this,
// the GPU process burned ~35% CPU around the clock rendering an invisible
// scene.
//
// Defaults to true (visible) so a missing preload API (tests, web preview,
// secondary windows) keeps today's always-render behavior.

import { atom } from 'nanostores'

export const $windowVisible = atom<boolean>(true)

let wired = false

/** Idempotent; safe to call from any consumer that needs live values. */
export function ensureWindowVisibilityWiring(): void {
  if (wired || typeof window === 'undefined') {
    return
  }

  const desktop = window.jarvisDesktop

  if (!desktop?.onWindowVisibility) {
    return
  }

  wired = true

  desktop.onWindowVisibility(visible => {
    $windowVisible.set(visible)
  })

  // Seed with the real current state — the event feed only reports changes,
  // and a renderer reload while hidden would otherwise believe it's visible
  // and resume full-rate rendering behind the hidden window.
  desktop
    .getWindowVisibility?.()
    .then(visible => {
      $windowVisible.set(Boolean(visible))
    })
    .catch(() => {
      // Keep the visible default — worst case is today's behavior.
    })
}
