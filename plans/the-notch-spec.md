# The Notch — Jarvis 3.0 companion notch app

Spec agreed with Eytan on 2026-07-02 after Q&A. This document is the source of truth
for the notch integration across sessions. Update it if decisions change.

## Goal

Bring the notch experience from the old Swift app (`~/Documents/Jarvis`, a vendored
Atoll/boring.notch shell) into Jarvis 3.0 as a native companion app, with Jarvis 3.0
as the only intelligence. The notch UI, haptics, media features, and animations are
kept exactly as they are today; only the AI-facing parts change.

## Non-negotiables

1. **Nothing about the current Jarvis 3.0 app changes** — no visual or behavioral
   changes to existing UI. All work is additive (new settings section, IPC plumbing,
   new orb page entry, hide-on-close for the main window which is required for
   background voice).
2. **Old repos are read-only.** `~/Documents/Jarvis` and `~/Documents/Jarvis 2.0`
   are copied from, never modified.
3. **Full rebrand.** No user-facing "Atoll" anywhere: app name, menu bar, settings
   labels, onboarding strings, permission prompts. Everything presents as Jarvis.
   GPL copyright headers stay in source files (legal requirement, not user-facing).
   Keep `LICENSE`/`NOTICE` files inside `apps/notch/`.
4. **No AI logic copied from the old app.** The Swift brain modules, WhisperKit STT,
   dictation, and Atoll's own Screen Assistant are all stripped. Jarvis 3.0's
   existing voice pipeline is the only intelligence and speech stack.
5. **License note:** Atoll shell is GPL-3.0. Fine for personal use; if Jarvis 3.0 is
   ever distributed publicly with the notch bundled, GPL terms apply to the notch
   component.

## Architecture

Two processes, one experience:

- **`apps/notch`** — the vendored Swift app (Atoll shell), stripped and rebranded.
  Builds via `xcodebuild` from `DynamicIsland.xcodeproj` (scheme `DynamicIsland`),
  producing **Jarvis Notch.app** (`com.nousresearch.jarvis.notch`, macOS 26+).
- **Jarvis 3.0 Electron app** — launches/quits the notch app, serves the IPC
  channel and the orb page, hosts the voice pipeline.

Lifecycle: notch lives with Jarvis. Electron spawns it on startup (same pattern as
`jarvisProcess` in `electron/main.cjs`), kills it on quit, relaunches on crash.
Quitting Jarvis removes the notch entirely → enable/offer launch-at-login for
Jarvis as part of this work.

### IPC

- Electron main hosts a local WebSocket server (`ws` dependency) on `127.0.0.1`,
  random port, with an auth token. Port+token passed to the notch app via launch
  arguments. Notch reconnects with backoff if Jarvis restarts the server.
- **jarvis → notch:** `state` (phase: `idle|listening|transcribing|thinking|speaking`),
  `audioLevel` (throttled ~30 Hz, drives closed-notch visualizer), `transcript`
  (turn deltas: role, text, partial/final), `conversationEnded`, `settings` (full
  snapshot + deltas), `orbUrl`.
- **notch → jarvis:** `hello` (version), `startConversation`, `endConversation`,
  `openMainWindow` (focus current/last conversation), `settingsChanged` (from
  permission grant flows), `openSettings` (deep link → Jarvis Settings → The Notch).
- The old `JarvisAssistantBridge` (131 lines, `Atoll/DynamicIsland/Jarvis/`) is the
  template: the replacement bridge is a WS client exposing the same observable
  `phase` model to SwiftUI. Its music pause/resume behavior during conversations
  **is kept** (pause on conversation start, resume when idle).

### Integration seams in the old code (all of them)

- `ContentView.swift:1063` — `case .jarvis: JarvisAssistantPane()` (AI tab)
- `components/Notch/NotchHomeView.swift:728,732` — `JarvisHomeFaceView()` (home card)
- `DynamicIslandApp.swift` — bridge start + brain imports
- `components/Settings/SettingsView.swift` — jarvis settings tab + brain imports
- `components/Settings/SoftwareUpdater.swift` — brain imports (deleted anyway)

### Stripped from the old app

- `Sources/Jarvis*` SPM brain modules (Core/Mac/Context/Dictation/UI), `brain/`
  Python bundle, WhisperKit dependency, `JarvisTestHarness`.
- Screen Assistant (components, managers, settings tab).
- Atoll onboarding/first-run flow.
- Sparkle auto-updater + `Updates/` + appcast scripts (notch updates ship with
  Jarvis 3.0 itself).
- Native settings window (`SettingsView.swift` + `SettingsWindowController`) —
  every settings entry point (menu bar item, notch gear) sends `openSettings`
  over IPC instead.

### Kept exactly as-is (everything else)

Notch tabs Home, Shelf, Timer, Stats, Color Picker, Notes, Clipboard, Terminal,
Extensions; music player + media controllers; volume/brightness HUD replacement;
battery; lock screen widgets; downloads live activity; calendar; webcam mirror;
haptics; gestures; multi-display handling; menu bar icon (items rewired: settings →
deep link, quit → quits notch only... quit should quit via Jarvis: send IPC, Jarvis
kills notch and keeps running).

## Notch UI changes (the only visual changes)

1. **Home tab** — `JarvisHomeFaceView` card is replaced by just the **real mini orb**
   (no schedule strip, no status text). Click → talking mode. Rest of home untouched.
2. **AI tab** (`JarvisAssistantPane` replacement) — orb on the left; right side:
   live streaming transcript (user + Jarvis bubbles, auto-scroll; idle state shows
   the tail of the last conversation) + an **Open Jarvis** button (focuses the main
   window on that conversation). **No text input** — voice only from the notch.
3. **Talking mode** — orb click toggles conversation (click again = end); sign-off
   ("thanks Jarvis") ends it. Starting flips the notch to the AI tab. Mousing away /
   notch closing does **not** end the conversation.
4. **Closed-notch live activity** — during an active conversation the closed notch
   shows the music-player-style live activity: **tiny orb** in the album-art slot
   (left) + **voice-reactive visualizer** (existing spectrum component driven by
   `audioLevel`) on the right. Takes priority over the music display; music display
   returns when the conversation ends. (Music itself is paused during conversation,
   resumed after — old bridge behavior.)
5. **Global hotkey Option+Space** — opens the notch on the AI tab AND immediately
   starts a voice conversation. (Old `GlobalHotkeyManager` is in the brain modules —
   reimplement small hotkey registration inside the notch app.)

### Orb rendering

- WKWebView inside the notch loading `http://127.0.0.1:<port>/notch-orb?...` served
  by the Electron app — the **real Three.js orb** (reuse `jarvis-orb` components via
  a new `notch-orb.html` Vite entry, modeled on the existing `orb-preview.html`).
  Black/transparent background matching the notch. Query params: size/variant/token.
- The orb page subscribes to phase + audio levels (same WS). One web view per
  surface (home, AI tab, closed-notch tiny orb); reuse a single shared WKWebView
  process pool. If the tiny closed-notch orb is too heavy in practice, fall back to
  a native approximation at that size only (decision deferred until measured).

## Voice pipeline (Electron side)

- Reuse the existing renderer voice stack (`use-voice-conversation.ts`,
  `voice-playback`, `voice-analyser`, sign-off detector). Notch `startConversation`
  → main process → renderer IPC event → same code path as the composer voice button.
- Transcript turns + status stream back to main → WS. Status maps 1:1 to notch
  phases (`ConversationStatus` already matches the old `AssistantPhase` vocabulary).
- Audio levels: tap the existing analyser (mic + TTS), throttle to ~30 Hz, forward.
- **Hide-on-close:** main window close is intercepted on macOS → hide instead of
  destroy, so the renderer voice host survives with the window "closed". Dock icon
  / reopen shows it again. This is the one behavioral change to the existing app.
- Conversations are **shared history** — notch talks land in the same threads as
  the app (they run through the same pipeline, so this falls out naturally).

## Settings — "The Notch" section in Jarvis Settings

- New top-level section **The Notch** with sub-pages mirroring the old settings
  tabs minus Jarvis/About/Screen Assistant: General, Appearance, Media,
  Live Activities, Lock Screen, Devices, Controls (HUD/OSD), Battery, Timer,
  Calendar, Notes, Clipboard, Color Picker, Downloads, Shelf, Shortcuts, Stats,
  Terminal, Extensions. Rebuilt as React forms using existing settings primitives
  (`src/app/settings/primitives.tsx`).
- Sync: notch sends the full settings snapshot (its `Defaults`/UserDefaults keys)
  on connect; Jarvis edits send deltas; notch applies live. Jarvis persists nothing
  itself — the notch's UserDefaults remain the source of truth (survives even if
  settings UI lags behind).
- **Permissions** (Calendar, Camera, Bluetooth, Accessibility, etc.): prompts come
  from the notch bundle and read "Jarvis Notch". The Notch → General shows
  permission status rows with grant/re-request buttons (notch reports status over
  IPC; grant buttons trigger the native request in the notch app).
- Native settings window deleted; menu-bar settings item deep-links to
  Jarvis Settings → The Notch.

## Build & dev

- `apps/notch/` in this repo: the vendored tree (`DynamicIsland.xcodeproj` +
  sources + `mediaremote-adapter` + frameworks/assets), `LICENSE`, `NOTICE`,
  build script (`apps/notch/scripts/build.sh` modeled on the old
  `script/build_and_run.sh`: xcodebuild, CODE_SIGNING_ALLOWED=NO for dev).
- Dev flow: `npm run notch:build` then Electron dev auto-spawns the built app;
  `JARVIS_NOTCH_DISABLE=1` env escape hatch.
- Packaging (Phase 4): bundle Jarvis Notch.app into the Electron app's Resources
  via electron-builder hook; spawn from there in production.

## Phases

1. **Phase 1 — stripped notch + orb + talking mode**: vendored copy builds and runs
   rebranded with brain modules stripped (bridge replaced by WS client stub);
   Electron spawns it; IPC up; orb web view on Home + AI tab; click-to-talk with
   live transcript; Open Jarvis button; music pause/resume.
   *Accepts:* hover opens notch, all Atoll features work, orb click starts a real
   Jarvis voice conversation with streaming transcript, no Atoll branding visible.
2. **Phase 2 — closed-notch live activity + hotkey**: tiny orb + voice visualizer
   while closed, conversation survives close, Option+Space, hide-on-close voice
   host hardening.
3. **Phase 3 — full settings port**: The Notch section with all sub-pages, live
   sync, permission rows, native settings window removed (interim: native settings
   stays until this phase completes).
4. **Phase 4 — packaging + polish**: bundle into electron-builder output,
   launch-at-login, crash relaunch, deep links, i18n strings for the new section
   (en/ja/zh/zh-hant), QA sweep of rebrand.
