import { useNavigate } from 'react-router-dom'

import { OverlayView } from '@/app/overlays/overlay-view'
import { NEW_CHAT_ROUTE, SETTINGS_ROUTE } from '@/app/routes'
import { BeveledButton } from '@/components/chrome/beveled-button'
import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'
import { openCommandPalette } from '@/store/command-palette'
import { setSessionPickerOpen } from '@/store/session'

import { ADVANCED_MENU_ROUTES, type JarvisMenuRoute, PRIMARY_MENU_ROUTES } from './menu-routes'

function SectionLabel({ children }: { children: string }) {
  return <h2 className="font-label text-[0.6875rem] uppercase tracking-[0.16em] text-(--jarvis-muted)">{children}</h2>
}

export function MenuOverlay({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const navigate = useNavigate()

  const renderRoute = ({ icon, key, path }: JarvisMenuRoute) => (
    <BeveledButton className="justify-start" fullWidth key={path} onClick={() => navigate(path)} size="lg">
      <Codicon name={icon} size="0.875rem" />
      {t.jarvis.menu[key]}
    </BeveledButton>
  )

  return (
    <OverlayView onClose={onClose}>
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-8 overflow-y-auto px-6 py-[calc(var(--titlebar-height)+2rem)]">
        <section className="flex flex-col gap-2">
          <SectionLabel>{t.jarvis.menu.navigation}</SectionLabel>
          <BeveledButton className="justify-start" fullWidth onClick={() => navigate(NEW_CHAT_ROUTE)} size="lg">
            <Codicon name="add" size="0.875rem" />
            {t.jarvis.menu.newSession}
          </BeveledButton>
          <BeveledButton
            className="justify-start"
            fullWidth
            onClick={() => {
              onClose()
              setSessionPickerOpen(true)
            }}
            size="lg"
          >
            <Codicon name="history" size="0.875rem" />
            {t.jarvis.menu.sessions}
          </BeveledButton>
          <BeveledButton
            className="justify-start"
            fullWidth
            onClick={() => {
              onClose()
              openCommandPalette()
            }}
            size="lg"
          >
            <Codicon name="symbol-keyword" size="0.875rem" />
            {t.jarvis.menu.slashCommands}
          </BeveledButton>
        </section>

        <section className="flex flex-col gap-2">{PRIMARY_MENU_ROUTES.map(renderRoute)}</section>

        <section className="flex flex-col gap-2">
          <SectionLabel>{t.jarvis.menu.advanced}</SectionLabel>
          {ADVANCED_MENU_ROUTES.map(renderRoute)}
          <BeveledButton
            className="justify-start"
            fullWidth
            onClick={() => navigate({ pathname: SETTINGS_ROUTE, search: '?tab=about' })}
            size="lg"
          >
            <Codicon name="info" size="0.875rem" />
            {t.jarvis.menu.about}
          </BeveledButton>
        </section>
      </div>
    </OverlayView>
  )
}
