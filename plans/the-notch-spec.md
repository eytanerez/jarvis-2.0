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

## Status (2026-07-02, end of session)

Phase 1 and Phase 3 are functionally done, ahead of the original phase order —
Eytan continued the work directly and it converged faster than planned.

- **Phase 1 — done.** Notch vendored/stripped/rebranded and builds green as
  "Jarvis Notch.app" (`com.nousresearch.jarvis.notch`). Electron spawns/kills it,
  WS link with token auth, orb page (`notch-orb.html`, real `JarvisOrbScene`)
  served from the Vite dev server *and* from the packaged renderer dist via the
  link's own static file server (`serveOrbStatic`) — no dev-server dependency at
  runtime anymore. `resolveNotchAppPath`/`resolveNotchBuildScript` also fall back
  to building the notch from the source checkout (`resolveUpdateRoot()`) on first
  run if no bundle exists, so a fresh install doesn't need a manual
  `notch:build`. Voice conversation starts from the orb click, streams status +
  transcript both ways. `npm run notch:build` script added.
- **Phase 3 — functionally done, ahead of schedule.** All 19 settings pages
  (General/Appearance/Media/Live Activities/Lock Screen/Devices/Controls/
  Battery/Timer/Calendar/Notes/Clipboard/Color Picker/Downloads/Shelf/
  Shortcuts/Stats/Terminal/Extensions) exist in `notch-settings.tsx`, wired into
  Jarvis Settings as "The Notch" nav entry. Live two-way sync over the WS link
  (`settingsSnapshot`/`settingsSet`/`settingsPermissionRequest` on the Swift
  side; `getSettingsSnapshot`/`setSetting`/`requestPermission` on the Electron
  side) with permission status rows. **Deviation from the original plan:** the
  native settings window (`SettingsWindowController`) was *not* deleted — it's
  kept as an offline fallback. `JarvisAssistantBridge.openSettingsPreferringJarvis()`
  opens the native window only while disconnected from Jarvis, otherwise
  deep-links to Jarvis Settings → The Notch. This is intentionally better than
  the original "delete it" plan: the notch is never unconfigurable if Jarvis
  hasn't launched yet.
- **Launch-at-login — done** (pulled forward from Phase 4). Jarvis itself
  registers as a macOS login item on first run (`app.setLoginItemSettings`,
  `electron/main.cjs`), since the notch only exists while Jarvis runs. A
  one-shot flag (`launch-at-login-configured.json` in userData) applies the
  default exactly once and never fights a later manual toggle. Exposed as a
  "Launch Jarvis at login" toggle in The Notch → General (`notch-settings.tsx`),
  backed by `jarvis:launchAtLogin:get`/`:set` IPC + `window.jarvisDesktop.launchAtLogin`.
  The notch's own standalone `LaunchAtLogin.Toggle` (from Atoll, would have let
  the notch register as an *independent* login item and come up without Jarvis)
  was removed along with the now-unused `LaunchAtLogin-Modern` SPM package —
  Jarvis is the single owner of that lifecycle decision now.
## Status update (2026-07-02, session 2 — all phases complete)

Every phase in this doc is now done. What landed this session, on top of the
"Status" section above:

- **Phase 2 — done.** `JarvisLiveActivity()` (`ContentView.swift`) is a new
  closed-notch branch — tiny `JarvisOrbView` in the album-art slot + a new
  `JarvisVoiceVisualizerView` (amplitude-driven equalizer bars, not the
  canned on/off music spectrum) — inserted above the music branch in the
  closed-notch priority chain, so it takes over from music during a
  conversation and falls back to music/everything-else otherwise; unaffected
  by lock screen/privacy priority since those still sit below it unchanged.
  `talkToJarvis` (Option+Space) registered via `KeyboardShortcuts`, wired to
  the existing `activateJarvisAssistantFromHotkey()`, with a Settings →
  Shortcuts recorder row. Hide-on-close: `mainWindow.on('close', ...)` on
  macOS calls `event.preventDefault()` + `.hide()` unless `isQuittingApp`
  (set at the top of `before-quit`), so the renderer — and an active voice
  conversation's React state — survives the red button; `activate`/
  `focusWindow` already handled restoring a hidden-not-destroyed window.
  Conversation-survives-close needed no extra code: `DynamicIslandViewModel.close()`
  never touched the Jarvis bridge, so the WS connection and conversation
  state were already independent of window open/close state.
- **Bug fixed in passing:** the old Atoll "Restart Jarvis" menu item
  relaunched the notch via `NSWorkspace.openApplication` with no launch
  args, losing `--jarvis-port`/`--jarvis-token` and orphaning a disconnected
  instance while the connected one died. Replaced with a `restartNotch`
  message routed through Jarvis (`notch.cjs`'s `restartNotch()`: kills the
  child, respawns immediately with the current port/token, bypassing the
  crash backoff) — the only party that knows the live credentials. Also
  removed the unused Atoll `LaunchAtLogin.Toggle` from the notch's own
  settings (would have let the notch register as an independent macOS login
  item and come up disconnected before Jarvis launches) plus the
  `LaunchAtLogin-Modern` SPM package.
- **Phase 4 — done.**
  - **Packaging:** `scripts/stage-notch.cjs` (new, tested) copies the built
    `Jarvis Notch.app` (prefers Release, falls back to Debug) into
    `apps/desktop/build/notch/`; `extraResources: [{"from": "build/notch",
    "to": "."}]` ships it at `Contents/Resources/Jarvis Notch.app` — verified
    end-to-end with a real `npm run pack` (unsigned local build) and
    `resolveNotchAppPath` correctly resolving the packaged path. Best-effort
    everywhere (non-macOS / notch not built → empty stage dir, no failure) so
    it never breaks a build on a fresh checkout or non-mac CI.
  - **Fixed in passing:** the orb page's two-entry Vite build (`index.html` +
    `notch-orb.html` in one `rolldownOptions.input`) doesn't actually work —
    rolldown rejects multiple inputs when `output.codeSplitting: false`
    (required for the main bundle's single-chunk packaging constraint).
    Reverted `vite.config.ts` to single-entry and added
    `vite.notch-orb.config.ts`, a second small build run as an extra step in
    `npm run build` (`emptyOutDir: false` so it doesn't clobber the main
    build's `dist/`). `notch.cjs`'s `serveOrbStatic` now has real files to
    serve in a packaged app, not just the dev server.
  - **Crash hardening:** added `MAX_RELAUNCH_ATTEMPTS = 6` — after ~6
    unexpected exits (~61s of backoff) the link gives up rather than looping
    forever; the Restart button already resets the counter, so recovery is
    always one click away. Fixed a real bug the new test caught: the
    "survived 60s, reset backoff" timer compared the shared `child` variable
    by truthiness, so in a fast crash-loop an EARLIER spawn's 60s timer could
    fire while a LATER spawn was the current `child` and wrongly reset the
    counter — now compares by reference to the specific spawn it belongs to.
  - **Deep links:** `jarvis://notch/settings` and `jarvis://notch/talk`
    added to the existing `onDeepLink` handler in `desktop-controller.tsx`
    (same destinations the notch's own WS-routed `openSettings`/orb-click
    already use) — lets an external trigger (Shortcut, doc link) reach the
    notch's two entry points, not just the pre-existing `blueprint` kind.
  - **i18n:** full `settings.notch` translation tree added to
    `types.ts`/`en.ts` (canonical) and `ja.ts`/`zh.ts`/`zh-hant.ts` (partial
    overrides via `defineLocale`, which falls back to English for anything
    unmapped — none were left unmapped: all 19 page titles, all 187 setting
    labels, all 44 select-option labels, and every chrome string/toast are
    translated in all three languages). `notch-settings.tsx` resolves labels
    via `n.labels[setting.key] ?? setting.label` etc. — the giant
    `SETTING_PAGES` data array itself was left untouched (English strings
    remain as the fallback/default value), only the render-time resolution
    changed, to avoid transcription risk in a 187-entry data table. Permission
    toast strings use function-typed translations (`(label) => string`) not
    prefix/suffix string concatenation, since Japanese/Chinese word order
    differs from English for "Requested X" / "Could not request X".
- **Verified this session:** `apps/notch` builds green. `apps/desktop`
  typechecks clean, lints clean. 226/228 tests pass across
  `electron/*.test.cjs` + `scripts/*.test.cjs` (2 pre-existing Windows-only
  failures unrelated to any of this work, confirmed by file ownership — never
  touched). `electron/notch.test.cjs` alone: 15/15, including a timer-mocked
  crash-loop test that caught the reset-timer identity bug above.
  `src/i18n` + `notch-settings` render tests: 21/21 (jsdom environment). A
  real `npm run pack` produced a working unpacked app with
  `Jarvis Notch.app` correctly bundled and resolvable — artifact deleted
  after verification (`release/` is gitignored, reproducible via `npm run
  pack`). The whole notch integration — Phases 1 through 4 — is functionally
  complete.
