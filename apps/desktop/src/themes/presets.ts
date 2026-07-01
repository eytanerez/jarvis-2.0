/**
 * Built-in desktop themes. Names match the CLI skins / dashboard presets.
 * Add new themes here — no code changes needed elsewhere.
 */

import type { DesktopTheme, DesktopThemeTypography } from './types'

// Color-emoji fonts to append to every stack as a last resort. None of the UI
// text/mono fonts carry emoji glyphs, so without this emoji render as tofu
// boxes on platforms whose default text font lacks them (e.g. Linux/#40364).
// Covers macOS, Windows, Linux, plus the `emoji` generic for anything else.
export const EMOJI_FALLBACK = '"Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji", emoji'

const SYSTEM_SANS =
  '"Segoe WPC", "Segoe UI", -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif, ' +
  EMOJI_FALLBACK

const SYSTEM_MONO =
  '"Cascadia Code", "JetBrains Mono", "SF Mono", ui-monospace, Menlo, Monaco, Consolas, monospace, ' + EMOJI_FALLBACK

export const DEFAULT_TYPOGRAPHY: DesktopThemeTypography = { fontSans: SYSTEM_SANS, fontMono: SYSTEM_MONO }

const NOUS_BLUE = '#5FD7FF'
const JARVIS_GRAPHITE = '#060A12'
const JARVIS_PANEL = '#0B111C'
const JARVIS_TEXT = '#EAF4FF'
const JARVIS_MUTED = '#8EA6C5'

/**
 * Nous — canonical Jarvis desktop identity. The palette is intentionally dark:
 * graphite surfaces, blue-grey hairlines, and electric-blue focus/action energy.
 */
export const nousTheme: DesktopTheme = {
  name: 'nous',
  label: 'Nous',
  description: 'Graphite J.A.R.V.I.S cockpit with electric-blue accents',
  colors: {
    background: JARVIS_GRAPHITE,
    foreground: JARVIS_TEXT,
    card: JARVIS_PANEL,
    cardForeground: JARVIS_TEXT,
    muted: '#101827',
    mutedForeground: JARVIS_MUTED,
    popover: '#0D1422',
    popoverForeground: JARVIS_TEXT,
    primary: NOUS_BLUE,
    primaryForeground: '#02050B',
    secondary: '#121B2B',
    secondaryForeground: '#D7E7F8',
    accent: '#0D263A',
    accentForeground: '#EAF6FF',
    border: '#1C3148',
    input: '#244B67',
    ring: NOUS_BLUE,
    midground: '#3CBFF6',
    composerRing: '#76DFFF',
    destructive: '#FF4D6A',
    destructiveForeground: '#FFFFFF',
    sidebarBackground: '#050811',
    sidebarBorder: '#18293D',
    userBubble: '#081726',
    userBubbleBorder: '#1D4664'
  },
  darkColors: {
    background: JARVIS_GRAPHITE,
    foreground: JARVIS_TEXT,
    card: JARVIS_PANEL,
    cardForeground: JARVIS_TEXT,
    muted: '#101827',
    mutedForeground: JARVIS_MUTED,
    popover: '#0D1422',
    popoverForeground: JARVIS_TEXT,
    primary: NOUS_BLUE,
    primaryForeground: '#02050B',
    secondary: '#121B2B',
    secondaryForeground: '#D7E7F8',
    accent: '#0D263A',
    accentForeground: '#EAF6FF',
    border: '#1C3148',
    input: '#244B67',
    ring: NOUS_BLUE,
    midground: '#3CBFF6',
    composerRing: '#76DFFF',
    destructive: '#FF4D6A',
    destructiveForeground: '#FFFFFF',
    sidebarBackground: '#050811',
    sidebarBorder: '#18293D',
    userBubble: '#081726',
    userBubbleBorder: '#1D4664'
  },
  typography: {
    fontSans: SYSTEM_SANS,
    fontMono: `"JetBrains Mono", ${SYSTEM_MONO}`
  }
}

/** Deep blue-violet with cool accents. Matches the dashboard midnight theme. */
export const midnightTheme: DesktopTheme = {
  name: 'midnight',
  label: 'Midnight',
  description: 'Deep blue-violet with cool accents',
  colors: {
    background: '#08081c',
    foreground: '#ddd6ff',
    card: '#0d0d28',
    cardForeground: '#ddd6ff',
    muted: '#13133a',
    mutedForeground: '#7c7ab0',
    popover: '#0f0f2e',
    popoverForeground: '#ddd6ff',
    primary: '#ddd6ff',
    primaryForeground: '#08081c',
    secondary: '#1a1a4a',
    secondaryForeground: '#c4bff0',
    accent: '#1a1a44',
    accentForeground: '#d0c8ff',
    border: '#1e1e52',
    input: '#1e1e52',
    ring: '#8b80e8',
    midground: '#8b80e8',
    destructive: '#b03060',
    destructiveForeground: '#fef2f2',
    sidebarBackground: '#06061a',
    sidebarBorder: '#12123a',
    userBubble: '#14143a',
    userBubbleBorder: '#242466'
  },
  typography: {
    fontMono: `"JetBrains Mono", ${SYSTEM_MONO}`,
    fontUrl: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap'
  }
}

/** Warm crimson and bronze — forge vibes. Matches the CLI ares skin. */
export const emberTheme: DesktopTheme = {
  name: 'ember',
  label: 'Ember',
  description: 'Warm crimson and bronze — forge vibes',
  colors: {
    background: '#160800',
    foreground: '#ffd8b0',
    card: '#1e0e04',
    cardForeground: '#ffd8b0',
    muted: '#2a1408',
    mutedForeground: '#aa7a56',
    popover: '#221008',
    popoverForeground: '#ffd8b0',
    primary: '#ffd8b0',
    primaryForeground: '#160800',
    secondary: '#341800',
    secondaryForeground: '#f0c090',
    accent: '#301600',
    accentForeground: '#e8c080',
    border: '#3a1c08',
    input: '#3a1c08',
    ring: '#d97316',
    midground: '#d97316',
    destructive: '#c43010',
    destructiveForeground: '#fef2f2',
    sidebarBackground: '#100600',
    sidebarBorder: '#2a1004',
    userBubble: '#2a1000',
    userBubbleBorder: '#4a2010'
  },
  typography: {
    fontMono: `"IBM Plex Mono", ${SYSTEM_MONO}`,
    fontUrl: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;700&display=swap'
  }
}

/** Clean grayscale. Matches the CLI mono skin and dashboard mono theme. */
export const monoTheme: DesktopTheme = {
  name: 'mono',
  label: 'Mono',
  description: 'Clean grayscale — minimal and focused',
  colors: {
    background: '#0e0e0e',
    foreground: '#eaeaea',
    card: '#141414',
    cardForeground: '#eaeaea',
    muted: '#1e1e1e',
    mutedForeground: '#808080',
    popover: '#181818',
    popoverForeground: '#eaeaea',
    primary: '#eaeaea',
    primaryForeground: '#0e0e0e',
    secondary: '#262626',
    secondaryForeground: '#c8c8c8',
    accent: '#222222',
    accentForeground: '#d8d8d8',
    border: '#2a2a2a',
    input: '#2a2a2a',
    ring: '#9a9a9a',
    midground: '#9a9a9a',
    destructive: '#a84040',
    destructiveForeground: '#fef2f2',
    sidebarBackground: '#0a0a0a',
    sidebarBorder: '#202020',
    userBubble: '#1a1a1a',
    userBubbleBorder: '#363636'
  }
}

/** Neon green on black. Matches the CLI cyberpunk skin and dashboard theme. */
export const cyberpunkTheme: DesktopTheme = {
  name: 'cyberpunk',
  label: 'Cyberpunk',
  description: 'Neon green on black — matrix terminal',
  colors: {
    background: '#000a00',
    foreground: '#00ff41',
    card: '#001200',
    cardForeground: '#00ff41',
    muted: '#001a00',
    mutedForeground: '#1a8a30',
    popover: '#001000',
    popoverForeground: '#00ff41',
    primary: '#00ff41',
    primaryForeground: '#000a00',
    secondary: '#002800',
    secondaryForeground: '#00cc34',
    accent: '#002000',
    accentForeground: '#00e038',
    border: '#003000',
    input: '#003000',
    ring: '#00ff41',
    midground: '#00ff41',
    destructive: '#ff003c',
    destructiveForeground: '#000a00',
    sidebarBackground: '#000600',
    sidebarBorder: '#001800',
    userBubble: '#001400',
    userBubbleBorder: '#004800'
  },
  typography: {
    fontMono: `"Courier New", Courier, monospace, ${EMOJI_FALLBACK}`,
    fontSans: `"Courier New", Courier, monospace, ${EMOJI_FALLBACK}`
  }
}

/** Cool slate blue for developers. Matches the CLI slate skin. */
export const slateTheme: DesktopTheme = {
  name: 'slate',
  label: 'Slate',
  description: 'Cool slate blue — focused developer theme',
  colors: {
    background: '#0d1117',
    foreground: '#c9d1d9',
    card: '#161b22',
    cardForeground: '#c9d1d9',
    muted: '#21262d',
    mutedForeground: '#8b949e',
    popover: '#1c2128',
    popoverForeground: '#c9d1d9',
    primary: '#c9d1d9',
    primaryForeground: '#0d1117',
    secondary: '#2a3038',
    secondaryForeground: '#adb5bf',
    accent: '#1e2530',
    accentForeground: '#c0c8d0',
    border: '#30363d',
    input: '#30363d',
    ring: '#58a6ff',
    midground: '#58a6ff',
    destructive: '#cf4848',
    destructiveForeground: '#fef2f2',
    sidebarBackground: '#090d13',
    sidebarBorder: '#1c2228',
    userBubble: '#1e2a38',
    userBubbleBorder: '#2e4060'
  },
  typography: {
    fontMono: `"JetBrains Mono", ${SYSTEM_MONO}`
  }
}

const SIGNAL_BLUE = '#0053FD'
const SIGNAL_BG = '#050811'
const SIGNAL_PANEL = '#0A0F1C'
const SIGNAL_TEXT = '#DBE6FF'
const SIGNAL_MUTED = '#93A8D6'

const signalmanColors = {
  background: SIGNAL_BG,
  foreground: SIGNAL_TEXT,
  card: SIGNAL_PANEL,
  cardForeground: SIGNAL_TEXT,
  muted: '#0D1424',
  mutedForeground: SIGNAL_MUTED,
  popover: '#0B1220',
  popoverForeground: SIGNAL_TEXT,
  primary: SIGNAL_BLUE,
  primaryForeground: '#F2F8FF',
  secondary: '#0F1830',
  secondaryForeground: '#CBDBFF',
  accent: '#0C1F3D',
  accentForeground: '#E8F2FF',
  border: '#1B2A47',
  input: '#23407A',
  ring: SIGNAL_BLUE,
  midground: '#3CA0FF',
  composerRing: '#5FA8FF',
  destructive: '#FF4D6A',
  destructiveForeground: '#FFFFFF',
  sidebarBackground: '#04070E',
  sidebarBorder: '#16233D',
  userBubble: '#071224',
  userBubbleBorder: '#1B3A63'
}

/**
 * Signalman — chamfered HUD chrome with electric-blue signal accents. The
 * default desktop identity: `primary`/`ring` deliberately reuse the same hex
 * as the static `--theme-jarvis-blue`/`--theme-orb-glow` tokens (see
 * styles.css) so the swappable chrome accent and the orb's own blue read as
 * one color instead of two competing blues, and `background` reuses
 * `--theme-jarvis-bg` so the cockpit screen doesn't visibly shift tone.
 */
export const signalmanTheme: DesktopTheme = {
  name: 'signalman',
  label: 'Signalman',
  description: 'Chamfered HUD chrome with electric-blue signal accents',
  colors: signalmanColors,
  darkColors: signalmanColors,
  typography: {
    fontSans: `"Space Grotesk", ${SYSTEM_SANS}`,
    fontMono: `"JetBrains Mono", ${SYSTEM_MONO}`,
    fontLabel: `"Commit Mono", ${SYSTEM_MONO}`,
    fontUrl: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&display=swap'
  }
}

export const BUILTIN_THEMES: Record<string, DesktopTheme> = {
  signalman: signalmanTheme,
  nous: nousTheme,
  midnight: midnightTheme,
  ember: emberTheme,
  mono: monoTheme,
  cyberpunk: cyberpunkTheme,
  slate: slateTheme
}

export const BUILTIN_THEME_LIST = Object.values(BUILTIN_THEMES)

/** Skin used when nothing is persisted or the persisted name is retired. */
export const DEFAULT_SKIN_NAME = 'signalman'
