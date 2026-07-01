// Dev-only harness for settings panels: mounts a single settings section
// standalone with the providers it needs, bypassing the Electron IPC boot
// gate. Not part of the app's routing or production bundle.
import '../styles.css'

import { createRoot } from 'react-dom/client'

import { AppearanceSettings } from '@/app/settings/appearance-settings'
import { I18nProvider } from '@/i18n'
import { ThemeProvider } from '@/themes/context'

createRoot(document.getElementById('root')!).render(
  <I18nProvider>
    <ThemeProvider>
      <div style={{ background: 'var(--dt-background, #050811)', minHeight: '100vh', padding: '2rem' }}>
        <AppearanceSettings />
      </div>
    </ThemeProvider>
  </I18nProvider>
)
