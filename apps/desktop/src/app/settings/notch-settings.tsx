import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { DesktopNotchPermission, DesktopNotchSettingsSnapshot } from '@/global'
import { useI18n } from '@/i18n'
import type { Translations } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import {
  Activity,
  BarChart3,
  Bell,
  CheckCircle2,
  Clipboard,
  Clock,
  Command,
  Cpu,
  Download,
  FileText,
  Layers3,
  Loader2,
  Lock,
  LogIn,
  Monitor,
  NotebookTabs,
  Palette,
  RefreshCw,
  Settings2,
  SlidersHorizontal,
  Terminal,
  Volume2,
  X
} from '@/lib/icons'
import {
  EMPTY_NOTCH_SETTINGS_SNAPSHOT,
  getNotchSettings,
  requestNotchPermission,
  setNotchSetting,
  subscribeNotchSettings
} from '@/lib/notch-link'
import { cn } from '@/lib/utils'
import { notify, notifyError } from '@/store/notifications'

import { CONTROL_TEXT } from './constants'
import { ListRow, NavLink, SectionHeading, SettingsContent } from './primitives'

type NotchSettingType = 'boolean' | 'number' | 'select' | 'text'

interface NotchSettingOption {
  label: string
  value: string
}

interface NotchSettingDef {
  key: string
  label: string
  description?: string
  type: NotchSettingType
  defaultValue: boolean | number | string
  min?: number
  max?: number
  step?: number
  options?: NotchSettingOption[]
}

interface NotchSettingsPageDef {
  id: string
  label: string
  icon: typeof Settings2
  settings: NotchSettingDef[]
}

const BOOL = 'boolean'
const NUMBER = 'number'
const SELECT = 'select'
const TEXT = 'text'

const SETTING_PAGES: NotchSettingsPageDef[] = [
  {
    id: 'general',
    label: 'General',
    icon: Settings2,
    settings: [
      bool('showOnAllDisplays', 'Show on all displays', false),
      bool('automaticallySwitchDisplay', 'Follow the active display', true),
      bool('hideDynamicIslandFromScreenCapture', 'Hide from screen capture', false),
      number('minimumHoverDuration', 'Hover delay', 0.3, { max: 2, min: 0, step: 0.05 }),
      bool('openNotchOnHover', 'Open on hover', true),
      bool('extendHoverArea', 'Extend hover area', false),
      bool('hideNonNotchUntilHover', 'Hide external display pill until hover', false),
      select('externalDisplayStyle', 'External display style', 'Standard Notch', [
        ['Standard Notch', 'Standard Notch'],
        ['Dynamic Island', 'Dynamic Island']
      ])
    ]
  },
  {
    id: 'appearance',
    label: 'Appearance',
    icon: Palette,
    settings: [
      number('openNotchWidth', 'Open notch width', 640, { max: 1200, min: 420, step: 10 }),
      number('notchHeight', 'Notch display height', 32, { max: 80, min: 18, step: 1 }),
      number('nonNotchHeight', 'External display height', 32, { max: 80, min: 18, step: 1 }),
      bool('enableMinimalisticUI', 'Minimal interface', false),
      bool('showEmojis', 'Emoji accents', false),
      bool('settingsIconInNotch', 'Settings icon in notch', true),
      bool('lightingEffect', 'Lighting effect', true),
      bool('enableShadow', 'Window shadow', true),
      bool('cornerRadiusScaling', 'Scale corner radius', true),
      bool('useModernCloseAnimation', 'Modern close animation', true),
      bool('tileShowLabels', 'Tile labels', false)
    ]
  },
  {
    id: 'media',
    label: 'Media',
    icon: Volume2,
    settings: [
      bool('showStandardMediaControls', 'Media controls tab', true),
      bool('autoHideInactiveNotchMediaPlayer', 'Auto-hide inactive player', false),
      select('mediaController', 'Media controller', 'Apple Music', [
        ['Now Playing', 'Now Playing'],
        ['Apple Music', 'Apple Music'],
        ['Spotify', 'Spotify'],
        ['YouTube Music', 'Youtube Music'],
        ['Amazon Music', 'Amazon Music']
      ]),
      bool('coloredSpectrogram', 'Artwork-colored visualizer', true),
      bool('enableRealTimeWaveform', 'Real-time waveform', false),
      bool('useMusicVisualizer', 'Music visualizer', true),
      bool('enableLyrics', 'Lyrics', false),
      bool('showLiveCanvasInDynamicIsland', 'Live canvas art', false),
      bool('enableFullscreenMediaDetection', 'Fullscreen media detection', true),
      bool('enableSneakPeek', 'Track-change sneak peek', false),
      select('sneakPeekStyles', 'Sneak peek style', 'Default', [
        ['Default', 'Default'],
        ['Inline', 'Inline']
      ]),
      bool('showSneakPeekOnTrackChange', 'Sneak peek on track change', true),
      bool('showShuffleAndRepeat', 'Shuffle and repeat controls', true),
      bool('showMediaOutputControl', 'Media output control', true),
      select('musicSkipBehavior', 'Skip behavior', 'track', [
        ['Track skip', 'track'],
        ['Ten seconds', 'tenSecond']
      ]),
      bool('musicControlWindowEnabled', 'Floating music controller', false)
    ]
  },
  {
    id: 'live',
    label: 'Live Activities',
    icon: Activity,
    settings: [
      bool('inlineHUD', 'Inline HUD', true),
      select('progressBarStyle', 'Progress style', 'Hierarchical', [
        ['Hierarchical', 'Hierarchical'],
        ['Gradient', 'Gradient'],
        ['Segmented', 'Segmented']
      ]),
      bool('showProgressPercentages', 'Show percentages', true),
      bool('systemEventIndicatorShadow', 'Indicator shadow', false),
      bool('systemEventIndicatorUseAccent', 'Use accent color', false),
      bool('showSongMetadataInClosedNotch', 'Song metadata while closed', false),
      bool('enableReminderLiveActivity', 'Reminder live activity', true),
      number('reminderLeadTime', 'Reminder lead time', 5, { max: 60, min: 0, step: 1 }),
      number('reminderSneakPeekDuration', 'Reminder sneak peek seconds', 5, { max: 30, min: 1, step: 1 }),
      select('reminderPresentationStyle', 'Reminder style', 'Ring', [
        ['Ring', 'Ring'],
        ['Digital', 'Digital'],
        ['Minutes', 'Minutes']
      ])
    ]
  },
  {
    id: 'lock',
    label: 'Lock Screen',
    icon: Lock,
    settings: [
      bool('enableLockScreenLiveActivity', 'Lock screen live activities', true),
      bool('enableLockSounds', 'Lock sounds', true),
      bool('enableLockScreenWeatherWidget', 'Weather widget', true),
      bool('enableLockScreenFocusWidget', 'Focus widget', true),
      bool('enableLockScreenReminderWidget', 'Reminder widget', true),
      bool('enableLockScreenTimerWidget', 'Timer widget', true),
      bool('lockScreenWeatherShowsLocation', 'Weather location', true),
      bool('lockScreenWeatherShowsSunrise', 'Sunrise and sunset', true),
      bool('lockScreenWeatherShowsAQI', 'Air quality', true),
      bool('lockScreenShowCalendarEvent', 'Calendar event', true),
      bool('lockScreenShowCalendarCountdown', 'Calendar countdown', true),
      bool('lockScreenShowCalendarTimeRemaining', 'Time remaining', true),
      text('lockScreenCalendarEventLookaheadWindow', 'Calendar lookahead', '3h'),
      number('lockScreenWeatherVerticalOffset', 'Weather vertical offset', 0, { max: 200, min: -200, step: 1 }),
      number('lockScreenTimerVerticalOffset', 'Timer vertical offset', 0, { max: 200, min: -200, step: 1 }),
      number('lockScreenTimerWidgetWidth', 'Timer widget width', 350, { max: 640, min: 220, step: 10 })
    ]
  },
  {
    id: 'devices',
    label: 'Devices',
    icon: Monitor,
    settings: [
      bool('showMirror', 'Camera mirror', false),
      text('selectedCameraID', 'Selected camera ID', ''),
      bool('enableCameraDetection', 'Camera privacy indicator', true),
      bool('enableMicrophoneDetection', 'Microphone privacy indicator', true),
      bool('showBluetoothDeviceConnections', 'Bluetooth connection HUD', true),
      bool('useColorCodedBatteryDisplay', 'Color-coded battery', true),
      bool('useColorCodedVolumeDisplay', 'Color-coded volume', true),
      bool('useSmoothColorGradient', 'Smooth color gradient', true),
      bool('useCircularBluetoothBatteryIndicator', 'Circular battery indicator', true),
      bool('showBluetoothBatteryPercentageText', 'Battery percentage text', false),
      bool('showBluetoothDeviceNameMarquee', 'Device name marquee', false),
      bool('useBluetoothHUD3DIcon', '3D device icon', true)
    ]
  },
  {
    id: 'controls',
    label: 'Controls',
    icon: SlidersHorizontal,
    settings: [
      bool('enableSystemHUD', 'System HUD replacement', true),
      bool('enableVolumeHUD', 'Volume HUD', true),
      bool('enableBrightnessHUD', 'Brightness HUD', true),
      bool('enableKeyboardBacklightHUD', 'Keyboard backlight HUD', true),
      number('systemHUDSensitivity', 'HUD sensitivity', 5, { max: 10, min: 1, step: 1 }),
      bool('playVolumeChangeFeedback', 'Volume feedback sound', false),
      number('volumeStepPercent', 'Volume step percent', 6, { max: 25, min: 1, step: 1 }),
      number('brightnessStepPercent', 'Brightness step percent', 6, { max: 25, min: 1, step: 1 }),
      bool('enableCustomOSD', 'Custom OSD window', false),
      bool('enableVerticalHUD', 'Vertical HUD', false),
      bool('enableCircularHUD', 'Circular HUD', false),
      select('verticalHUDPosition', 'Vertical HUD position', 'right', [
        ['Left', 'left'],
        ['Right', 'right']
      ]),
      bool('verticalHUDShowValue', 'Vertical HUD value', true),
      bool('verticalHUDInteractive', 'Interactive vertical HUD', true),
      number('verticalHUDHeight', 'Vertical HUD height', 160, { max: 320, min: 80, step: 5 }),
      number('circularHUDSize', 'Circular HUD size', 65, { max: 160, min: 40, step: 5 })
    ]
  },
  {
    id: 'battery',
    label: 'Battery',
    icon: Bell,
    settings: [
      bool('showPowerStatusNotifications', 'Power notifications', true),
      bool('showBatteryIndicator', 'Battery indicator', true),
      bool('showBatteryPercentage', 'Battery percentage', true),
      bool('showBatteryPercentInside', 'Percentage inside indicator', true),
      bool('showPowerStatusIcons', 'Power status icons', true),
      bool('playLowBatteryAlertSound', 'Low battery sound', true),
      bool('showChargingBatteryHUD', 'Charging HUD', true),
      bool('showLowBatteryHUD', 'Low battery HUD', true),
      bool('showFullBatteryHUD', 'Full battery HUD', true),
      number('lowBatteryHUDThreshold', 'Low battery threshold', 20, { max: 50, min: 1, step: 1 }),
      number('fullBatteryHUDThreshold', 'Full battery threshold', 100, { max: 100, min: 50, step: 1 }),
      select('lowBatteryHUDStyle', 'Low battery HUD style', 'standard', [
        ['Standard', 'standard'],
        ['Compact', 'compact']
      ]),
      select('fullBatteryHUDStyle', 'Full battery HUD style', 'standard', [
        ['Standard', 'standard'],
        ['Compact', 'compact']
      ])
    ]
  },
  {
    id: 'timer',
    label: 'Timer',
    icon: Clock,
    settings: [
      bool('enableTimerFeature', 'Timer tab', true),
      select('timerDisplayMode', 'Display mode', 'tab', [
        ['Tab', 'tab'],
        ['Popover', 'popover']
      ]),
      bool('showTimerPresetsInNotchTab', 'Preset buttons', true),
      select('timerIconColorMode', 'Icon color', 'Adaptive', [
        ['Adaptive', 'Adaptive'],
        ['Solid', 'Solid']
      ]),
      bool('timerShowsCountdown', 'Countdown text', true),
      bool('timerShowsLabel', 'Timer label', false),
      bool('timerShowsProgress', 'Progress indicator', true),
      select('timerProgressStyle', 'Progress style', 'Bar', [
        ['Bar', 'Bar'],
        ['Ring', 'Ring']
      ]),
      bool('mirrorSystemTimer', 'Mirror macOS Clock timers', true),
      bool('timerControlWindowEnabled', 'Floating timer controls', true)
    ]
  },
  {
    id: 'calendar',
    label: 'Calendar',
    icon: NotebookTabs,
    settings: [
      bool('showCalendar', 'Calendar tab', true),
      bool('hideCompletedReminders', 'Hide completed reminders', true),
      bool('hideAllDayEvents', 'Hide all-day events', false),
      bool('showFullEventTitles', 'Full event titles', false),
      bool('autoScrollToNextEvent', 'Auto-scroll to next event', true),
      bool('enableThirdPartyCalendarApp', 'Open events in third-party app', false),
      select('selectedCalendarApp', 'Calendar app', 'fantastical', [
        ['Fantastical', 'fantastical'],
        ['Notion Calendar', 'notionCalendar']
      ]),
      select('fantasticalDefaultView', 'Fantastical view', 'mini', [
        ['Mini', 'mini'],
        ['Calendar', 'calendar']
      ])
    ]
  },
  {
    id: 'notes',
    label: 'Notes',
    icon: FileText,
    settings: [
      bool('enableNotes', 'Notes tab', false),
      bool('enableNotePinning', 'Pin notes', true),
      bool('enableNoteSearch', 'Search notes', false),
      bool('enableNoteColorFiltering', 'Filter by color', false),
      bool('enableCreateFromClipboard', 'Create from clipboard', true),
      bool('enableNoteCharCount', 'Character count', true)
    ]
  },
  {
    id: 'clipboard',
    label: 'Clipboard',
    icon: Clipboard,
    settings: [
      bool('enableClipboardManager', 'Clipboard manager', true),
      number('clipboardHistorySize', 'History size', 3, { max: 50, min: 1, step: 1 }),
      bool('showClipboardIcon', 'Clipboard icon', true),
      select('clipboardDisplayMode', 'Display mode', 'panel', [
        ['Popover', 'popover'],
        ['Panel', 'panel'],
        ['Separate tab', 'separateTab']
      ])
    ]
  },
  {
    id: 'color',
    label: 'Color Picker',
    icon: Palette,
    settings: [
      bool('enableColorPickerFeature', 'Color picker', true),
      bool('showColorFormats', 'Show formats', true),
      bool('showColorPickerIcon', 'Color picker icon', true),
      number('colorHistorySize', 'History size', 10, { max: 50, min: 1, step: 1 }),
      select('colorPickerDisplayMode', 'Display mode', 'panel', [
        ['Popover', 'popover'],
        ['Panel', 'panel']
      ])
    ]
  },
  {
    id: 'downloads',
    label: 'Downloads',
    icon: Download,
    settings: [
      bool('enableDownloadListener', 'Download listener', true),
      bool('enableSafariDownloads', 'Safari downloads', true),
      select('selectedDownloadIndicatorStyle', 'Indicator style', 'Progress', [
        ['Progress', 'Progress'],
        ['Percentage', 'Percentage'],
        ['Circle', 'Circle']
      ]),
      select('selectedDownloadIconStyle', 'Icon style', 'Only app icon', [
        ['App icon only', 'Only app icon'],
        ['Download icon only', 'Only download icon'],
        ['Icon and app icon', 'Icon and app icon']
      ])
    ]
  },
  {
    id: 'shelf',
    label: 'Shelf',
    icon: Layers3,
    settings: [
      bool('dynamicShelf', 'Shelf tab', true),
      bool('openShelfByDefault', 'Open shelf by default', true),
      text('quickShareProvider', 'Quick share provider', 'AirDrop'),
      text('localSendSelectedDeviceID', 'LocalSend device ID', ''),
      bool('copyOnDrag', 'Copy on drag', false),
      bool('autoRemoveShelfItems', 'Auto-remove shelf items', false),
      bool('expandedDragDetection', 'Expanded drag detection', true)
    ]
  },
  {
    id: 'shortcuts',
    label: 'Shortcuts',
    icon: Command,
    settings: [
      bool('enableShortcuts', 'Keyboard shortcuts', true),
      bool('enableGestures', 'Trackpad gestures', true),
      bool('closeGestureEnabled', 'Close gesture', true),
      number('gestureSensitivity', 'Gesture sensitivity', 200, { max: 600, min: 50, step: 10 }),
      bool('enableHorizontalMusicGestures', 'Horizontal music gestures', true),
      bool('reverseSwipeGestures', 'Reverse swipe gestures', false),
      bool('reverseScrollGestures', 'Reverse scroll gestures', false)
    ]
  },
  {
    id: 'stats',
    label: 'Stats',
    icon: BarChart3,
    settings: [
      bool('enableStatsFeature', 'Stats tab', false),
      bool('autoStartStatsMonitoring', 'Auto-start monitoring', true),
      bool('statsStopWhenNotchCloses', 'Stop when notch closes', true),
      number('statsUpdateInterval', 'Update interval', 1, { max: 10, min: 0.25, step: 0.25 }),
      bool('showCpuGraph', 'CPU graph', true),
      bool('showMemoryGraph', 'Memory graph', true),
      bool('showGpuGraph', 'GPU graph', true),
      bool('showNetworkGraph', 'Network graph', false),
      bool('showDiskGraph', 'Disk graph', false)
    ]
  },
  {
    id: 'terminal',
    label: 'Terminal',
    icon: Terminal,
    settings: [
      bool('enableTerminalFeature', 'Terminal tab', false),
      text('terminalShellPath', 'Shell path', '/bin/zsh'),
      text('terminalFontFamily', 'Font family', ''),
      number('terminalFontSize', 'Font size', 12, { max: 24, min: 8, step: 1 }),
      number('terminalOpacity', 'Opacity', 1, { max: 1, min: 0.25, step: 0.05 }),
      number('terminalMaxHeightFraction', 'Max height fraction', 0.4, { max: 0.9, min: 0.2, step: 0.05 }),
      select('terminalCursorStyle', 'Cursor style', 'blinkBlock', [
        ['Blink block', 'blinkBlock'],
        ['Block', 'block'],
        ['Underline', 'underline'],
        ['Bar', 'bar']
      ]),
      number('terminalScrollbackLines', 'Scrollback lines', 1000, { max: 10000, min: 100, step: 100 }),
      bool('terminalOptionAsMeta', 'Option as Meta', true),
      bool('terminalMouseReporting', 'Mouse reporting', true),
      bool('terminalBoldAsBright', 'Bold as bright', true),
      bool('terminalStickyMode', 'Sticky mode', false)
    ]
  },
  {
    id: 'extensions',
    label: 'Extensions',
    icon: Cpu,
    settings: [
      bool('enableThirdPartyExtensions', 'Third-party extensions', true),
      bool('enableExtensionLiveActivities', 'Live activities', true),
      bool('enableExtensionLockScreenWidgets', 'Lock screen widgets', true),
      bool('enableExtensionNotchExperiences', 'Notch experiences', true),
      bool('enableExtensionNotchTabs', 'Extension tabs', true),
      bool('enableExtensionNotchMinimalisticOverrides', 'Minimal overrides', true),
      bool('enableExtensionNotchInteractiveWebViews', 'Interactive web views', true),
      bool('enableExtensionFileSharing', 'File sharing', true),
      bool('extensionDiagnosticsLoggingEnabled', 'Diagnostics logging', true),
      number('extensionLiveActivityCapacity', 'Live activity capacity', 4, { max: 12, min: 1, step: 1 }),
      number('extensionLockScreenWidgetCapacity', 'Widget capacity', 4, { max: 12, min: 1, step: 1 }),
      number('extensionNotchExperienceCapacity', 'Experience capacity', 2, { max: 6, min: 1, step: 1 })
    ]
  }
]

function bool(key: string, label: string, defaultValue: boolean, description?: string): NotchSettingDef {
  return { defaultValue, description, key, label, type: BOOL }
}

function number(
  key: string,
  label: string,
  defaultValue: number,
  constraints: Pick<NotchSettingDef, 'max' | 'min' | 'step'> = {},
  description?: string
): NotchSettingDef {
  return { defaultValue, description, key, label, type: NUMBER, ...constraints }
}

function text(key: string, label: string, defaultValue: string, description?: string): NotchSettingDef {
  return { defaultValue, description, key, label, type: TEXT }
}

function select(key: string, label: string, defaultValue: string, options: [string, string][]): NotchSettingDef {
  return {
    defaultValue,
    key,
    label,
    options: options.map(([optionLabel, value]) => ({ label: optionLabel, value })),
    type: SELECT
  }
}

function valueFor(snapshot: DesktopNotchSettingsSnapshot, setting: NotchSettingDef) {
  return snapshot.values[setting.key] ?? setting.defaultValue
}

function normalizeNumber(raw: string, setting: NotchSettingDef): number | null {
  if (raw.trim() === '') {return null}
  const next = Number(raw)

  if (!Number.isFinite(next)) {return null}

  return next
}

type NotchCopy = Translations['settings']['notch']

function PermissionStatus({ n, permission }: { n: NotchCopy; permission: DesktopNotchPermission }) {
  const granted = permission.status === 'granted'
  const denied = permission.status === 'denied'

  return (
    <div className="flex items-center gap-1.5 text-xs">
      {granted ? (
        <CheckCircle2 className="size-3.5 text-emerald-400" />
      ) : denied ? (
        <X className="size-3.5 text-red-400" />
      ) : (
        <span className="size-2 rounded-full bg-(--ui-text-quaternary)" />
      )}
      <span className={granted ? 'text-emerald-300' : denied ? 'text-red-300' : 'text-(--ui-text-tertiary)'}>
        {granted ? n.permissions.granted : denied ? n.permissions.denied : n.permissions.unknown}
      </span>
    </div>
  )
}

export function NotchSettings() {
  const { t } = useI18n()
  const n = t.settings.notch
  const [activePageId, setActivePageId] = useState(SETTING_PAGES[0].id)
  const [snapshot, setSnapshot] = useState<DesktopNotchSettingsSnapshot>(EMPTY_NOTCH_SETTINGS_SNAPSHOT)
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [requestingPermission, setRequestingPermission] = useState<string | null>(null)
  const [restarting, setRestarting] = useState(false)
  // Jarvis-level (not notch-Defaults) setting: the notch only runs alongside
  // Jarvis, so this is what keeps it "always there" across reboots.
  const [launchAtLogin, setLaunchAtLoginState] = useState<{ enabled: boolean; supported: boolean } | null>(null)
  const [savingLaunchAtLogin, setSavingLaunchAtLogin] = useState(false)

  useEffect(() => {
    let cancelled = false

    void window.jarvisDesktop?.launchAtLogin
      .get()
      .then(next => {
        if (!cancelled) {setLaunchAtLoginState(next)}
      })
      .catch(() => {
        if (!cancelled) {setLaunchAtLoginState({ enabled: false, supported: false })}
      })

    return () => {
      cancelled = true
    }
  }, [])

  const toggleLaunchAtLogin = async (enabled: boolean) => {
    setSavingLaunchAtLogin(true)
    setLaunchAtLoginState(current => (current ? { ...current, enabled } : current))

    try {
      const result = await window.jarvisDesktop?.launchAtLogin.set(enabled)

      if (result) {
        setLaunchAtLoginState({ enabled: result.enabled, supported: true })

        if (!result.ok) {
          notify({ kind: 'error', message: n.startup.launchAtLoginSaveFailed })
        } else {
          triggerHaptic('selection')
        }
      }
    } catch (error) {
      notifyError(error, n.startup.launchAtLoginError)
    } finally {
      setSavingLaunchAtLogin(false)
    }
  }

  const activePage = useMemo(
    () => SETTING_PAGES.find(page => page.id === activePageId) ?? SETTING_PAGES[0],
    [activePageId]
  )

  useEffect(() => {
    let cancelled = false

    void getNotchSettings()
      .then(next => {
        if (!cancelled) {setSnapshot(next)}
      })
      .catch(error => {
        if (!cancelled) {notifyError(error, n.settingsLoadFailed)}
      })
      .finally(() => {
        if (!cancelled) {setLoading(false)}
      })

    const unsubscribe = subscribeNotchSettings(next => {
      setSnapshot(next)
      setLoading(false)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [n.settingsLoadFailed])

  const updateSetting = async (setting: NotchSettingDef, value: unknown) => {
    setSavingKey(setting.key)
    setSnapshot(current => ({ ...current, values: { ...current.values, [setting.key]: value } }))

    try {
      const ok = await setNotchSetting(setting.key, value)

      if (!ok) {
        notify({ kind: 'error', message: n.offlineToast })
      } else {
        triggerHaptic('selection')
      }
    } catch (error) {
      notifyError(error, n.settingSaveFailed)
    } finally {
      setSavingKey(null)
    }
  }

  const requestPermission = async (permission: DesktopNotchPermission) => {
    setRequestingPermission(permission.id)

    try {
      const ok = await requestNotchPermission(permission.id)
      notify({
        kind: ok ? 'info' : 'error',
        message: ok ? n.permissionRequested(permission.label) : n.offlineToast
      })
    } catch (error) {
      notifyError(error, n.permissionRequestFailed(permission.label))
    } finally {
      setRequestingPermission(null)
    }
  }

  const restartNotch = async () => {
    setRestarting(true)

    try {
      const result = await window.jarvisDesktop?.notch?.restart()

      if (result?.ok) {
        notify({ kind: 'info', message: n.restarting })
      } else {
        notify({ kind: 'error', message: n.offlineToast })
      }
    } catch (error) {
      notifyError(error, n.restartFailed)
    } finally {
      // The notch briefly disconnects during the restart; the snapshot
      // subscription will flip `connected` back once it reconnects.
      setTimeout(() => setRestarting(false), 2000)
    }
  }

  if (loading) {
    return (
      <SettingsContent>
        <div className="grid min-h-48 place-items-center text-xs text-(--ui-text-tertiary)">{n.loading}</div>
      </SettingsContent>
    )
  }

  return (
    <SettingsContent>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <SectionHeading
          icon={Settings2}
          meta={snapshot.connected ? n.connected : n.offline}
          title={n.title}
        />
        <Button
          disabled={!snapshot.connected || restarting}
          onClick={() => void restartNotch()}
          size="sm"
          type="button"
          variant="outline"
        >
          <RefreshCw className={cn('size-3.5', restarting && 'animate-spin')} />
          {n.restart}
        </Button>
      </div>

      <p className="mb-4 text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
        {n.subtitle}
      </p>

      {!snapshot.connected && (
        <div className="mb-4 rounded-md border border-[color-mix(in_srgb,var(--jarvis-amber)_42%,transparent)] bg-[color-mix(in_srgb,var(--jarvis-amber)_8%,transparent)] px-3 py-2 text-xs text-(--ui-text-secondary)">
          {n.offlineBannerBefore}
          <span className="font-mono">npm run notch:build</span>
          {n.offlineBannerAfter}
        </div>
      )}

      <div className="grid min-h-0 gap-4 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <nav className="grid content-start gap-1">
          {SETTING_PAGES.map(page => (
            <NavLink
              active={activePage.id === page.id}
              icon={page.icon}
              key={page.id}
              label={n.pages[page.id] ?? page.label}
              onClick={() => setActivePageId(page.id)}
            />
          ))}
        </nav>

        <section className="min-w-0">
          {activePage.id === 'general' && (
            <div className="mb-5">
              <SectionHeading icon={LogIn} title={n.startup.title} />
              <div className="divide-y divide-border/30">
                <ListRow
                  action={
                    <div className="flex items-center justify-end gap-2">
                      {savingLaunchAtLogin && <Loader2 className="size-3.5 animate-spin text-(--ui-text-tertiary)" />}
                      <Switch
                        aria-label={n.startup.launchAtLoginTitle}
                        checked={Boolean(launchAtLogin?.enabled)}
                        disabled={!launchAtLogin?.supported || savingLaunchAtLogin}
                        onCheckedChange={toggleLaunchAtLogin}
                      />
                    </div>
                  }
                  description={
                    launchAtLogin && !launchAtLogin.supported
                      ? n.startup.launchAtLoginUnsupported
                      : n.startup.launchAtLoginDescription
                  }
                  title={n.startup.launchAtLoginTitle}
                />
              </div>
            </div>
          )}

          {activePage.id === 'general' && (
            <div className="mb-5">
              <SectionHeading icon={Lock} meta={`${snapshot.permissions.length}`} title={n.permissions.title} />
              <div className="divide-y divide-border/30">
                {snapshot.permissions.length === 0 ? (
                  <div className="py-3 text-xs text-(--ui-text-tertiary)">{n.permissions.empty}</div>
                ) : (
                  snapshot.permissions.map(permission => (
                    <ListRow
                      action={
                        <Button
                          disabled={!snapshot.connected || requestingPermission === permission.id}
                          onClick={() => void requestPermission(permission)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          {requestingPermission === permission.id && <Loader2 className="size-3.5 animate-spin" />}
                          {n.permissions.request}
                        </Button>
                      }
                      below={<PermissionStatus n={n} permission={permission} />}
                      description={permission.description}
                      key={permission.id}
                      title={permission.label}
                    />
                  ))
                )}
              </div>
            </div>
          )}

          <SectionHeading
            icon={activePage.icon}
            meta={`${activePage.settings.length}`}
            title={n.pages[activePage.id] ?? activePage.label}
          />
          <div className="divide-y divide-border/30">
            {activePage.settings.map(setting => (
              <NotchSettingRow
                connected={snapshot.connected}
                key={setting.key}
                n={n}
                onChange={value => void updateSetting(setting, value)}
                saving={savingKey === setting.key}
                setting={setting}
                value={valueFor(snapshot, setting)}
              />
            ))}
          </div>
        </section>
      </div>
    </SettingsContent>
  )
}

function NotchSettingRow({
  connected,
  n,
  onChange,
  saving,
  setting,
  value
}: {
  connected: boolean
  n: NotchCopy
  onChange: (value: unknown) => void
  saving: boolean
  setting: NotchSettingDef
  value: unknown
}) {
  const disabled = !connected || saving
  const common = cn(CONTROL_TEXT, saving && 'opacity-70')
  const label = n.labels[setting.key] ?? setting.label
  const optionLabel = (option: NotchSettingOption) => n.optionLabels[`${setting.key}:${option.value}`] ?? option.label

  if (setting.type === BOOL) {
    return (
      <ListRow
        action={
          <div className="flex items-center justify-end gap-2">
            {saving && <Loader2 className="size-3.5 animate-spin text-(--ui-text-tertiary)" />}
            <Switch aria-label={label} checked={Boolean(value)} disabled={disabled} onCheckedChange={onChange} />
          </div>
        }
        description={setting.description}
        title={label}
      />
    )
  }

  if (setting.type === SELECT) {
    const options = setting.options ?? [
      { label: n.yesNo.on, value: 'true' },
      { label: n.yesNo.off, value: 'false' }
    ]

    const selected = typeof value === 'string' ? value : String(setting.defaultValue)

    return (
      <ListRow
        action={
          <Select disabled={disabled} onValueChange={onChange} value={selected}>
            <SelectTrigger className={cn('min-w-44', common)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map(option => (
                <SelectItem key={option.value} value={option.value}>
                  {optionLabel(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
        description={setting.description}
        title={label}
      />
    )
  }

  if (setting.type === NUMBER) {
    return (
      <ListRow
        action={
          <div className="flex items-center justify-end gap-2">
            {saving && <Loader2 className="size-3.5 animate-spin text-(--ui-text-tertiary)" />}
            <Input
              className={cn('min-w-32', common)}
              defaultValue={typeof value === 'number' ? String(value) : String(setting.defaultValue)}
              disabled={disabled}
              key={`${setting.key}:${String(value)}`}
              max={setting.max}
              min={setting.min}
              onBlur={event => {
                const next = normalizeNumber(event.currentTarget.value, setting)

                if (next !== null) {onChange(next)}
              }}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  const next = normalizeNumber(event.currentTarget.value, setting)

                  if (next !== null) {onChange(next)}
                }
              }}
              step={setting.step}
              type="number"
            />
          </div>
        }
        description={setting.description}
        title={label}
      />
    )
  }

  return (
    <ListRow
      action={
        <div className="flex items-center justify-end gap-2">
          {saving && <Loader2 className="size-3.5 animate-spin text-(--ui-text-tertiary)" />}
          <Input
            className={cn('min-w-56', common)}
            defaultValue={typeof value === 'string' ? value : String(setting.defaultValue)}
            disabled={disabled}
            key={`${setting.key}:${String(value)}`}
            onBlur={event => onChange(event.currentTarget.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {onChange(event.currentTarget.value)}
            }}
          />
        </div>
      }
      description={setting.description}
      title={label}
    />
  )
}
