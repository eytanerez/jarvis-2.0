import {
  AGENTS_ROUTE,
  ARTIFACTS_ROUTE,
  COMMAND_CENTER_ROUTE,
  CRON_ROUTE,
  MESSAGING_ROUTE,
  PROFILES_ROUTE,
  SETTINGS_ROUTE,
  SKILLS_ROUTE
} from '@/app/routes'
import type { Translations } from '@/i18n/types'

export interface JarvisMenuRoute {
  icon: string
  key: keyof Translations['jarvis']['menu']
  path: string
}

/** Primary destinations shown in the Jarvis menu overlay. */
export const PRIMARY_MENU_ROUTES: readonly JarvisMenuRoute[] = [
  { icon: 'settings-gear', key: 'settings', path: SETTINGS_ROUTE },
  { icon: 'account', key: 'profiles', path: PROFILES_ROUTE },
  { icon: 'robot', key: 'agents', path: AGENTS_ROUTE },
  { icon: 'symbol-misc', key: 'skills', path: SKILLS_ROUTE }
]

/** Advanced/secondary destinations shown in the Jarvis menu overlay. */
export const ADVANCED_MENU_ROUTES: readonly JarvisMenuRoute[] = [
  { icon: 'comment', key: 'messaging', path: MESSAGING_ROUTE },
  { icon: 'files', key: 'artifacts', path: ARTIFACTS_ROUTE },
  { icon: 'zap', key: 'cron', path: CRON_ROUTE },
  { icon: 'compass', key: 'commandCenter', path: COMMAND_CENTER_ROUTE }
]
