import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import type { IconComponent } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { PAGE_INSET_X } from '../layout-constants'

interface OverlaySplitLayoutProps {
  children: ReactNode
  className?: string
}

interface OverlaySidebarProps {
  children: ReactNode
  className?: string
}

interface OverlayMainProps {
  children: ReactNode
  className?: string
}

interface OverlayNavItemProps {
  active: boolean
  icon: IconComponent
  label: string
  // Renders as an indented child of another nav item: smaller icon and a
  // lighter active state so it never competes with the boxed parent item.
  nested?: boolean
  onClick: () => void
  trailing?: ReactNode
}

export function OverlaySplitLayout({ children, className }: OverlaySplitLayoutProps) {
  return (
    <div
      className={cn(
        'grid h-full min-h-0 flex-1 grid-cols-[13rem_minmax(0,1fr)] overflow-hidden bg-transparent max-[47.5rem]:grid-cols-1',
        className
      )}
    >
      {children}
    </div>
  )
}

export function OverlaySidebar({ children, className }: OverlaySidebarProps) {
  return (
    <aside
      className={cn(
        // pt clears the floating titlebar/header; the bg itself fills from the
        // card's top edge so there's no surface-colored gap above the sidebar.
        'flex min-h-0 flex-col gap-0.5 overflow-y-auto border-r border-[color-mix(in_srgb,var(--jarvis-hairline)_58%,transparent)] bg-[color-mix(in_srgb,var(--ui-sidebar-surface-background)_92%,#02040a)] px-2.5 pb-3 pt-[calc(var(--titlebar-height)+1rem)]',
        className
      )}
    >
      {children}
    </aside>
  )
}

export function OverlayMain({ children, className }: OverlayMainProps) {
  return (
    <main
      className={cn(
        'flex min-h-0 flex-1 flex-col overflow-hidden bg-transparent pb-3 pt-[calc(var(--titlebar-height)+1rem)]',
        PAGE_INSET_X,
        className
      )}
    >
      {children}
    </main>
  )
}

// Boxless "+ New …" action that tops an OverlaySidebar list (profiles, cron, …).
// The text variant underlines on hover, which also strokes the icon glyph — so
// we keep the button itself underline-free and underline only the label span.
export function OverlayNewButton({
  icon = 'add',
  label,
  onClick
}: {
  icon?: string
  label: string
  onClick: () => void
}) {
  return (
    <Button
      className="group mb-1 w-full justify-start gap-2 text-muted-foreground hover:bg-transparent hover:text-foreground"
      onClick={onClick}
      size="sm"
      variant="ghost"
    >
      <Codicon name={icon} />
      <span className="underline-offset-4 group-hover:underline">{label}</span>
    </Button>
  )
}

export function OverlayNavItem({ active, icon: Icon, label, nested, onClick, trailing }: OverlayNavItemProps) {
  return (
    <button
      className={cn(
        'flex h-7 w-full items-center justify-start gap-2 rounded-md border px-2 text-left text-[length:var(--conversation-text-font-size)] font-normal transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.99]',
        nested
          ? active
            ? 'border-[color-mix(in_srgb,var(--jarvis-blue)_30%,transparent)] bg-[color-mix(in_srgb,var(--jarvis-blue)_10%,transparent)] font-medium text-white'
            : 'border-transparent bg-transparent text-(--ui-text-tertiary) hover:border-[color-mix(in_srgb,var(--jarvis-hairline)_36%,transparent)] hover:bg-(--chrome-action-hover) hover:text-white'
          : active
            ? 'border-[color-mix(in_srgb,var(--jarvis-blue)_44%,transparent)] bg-[color-mix(in_srgb,var(--jarvis-blue)_12%,var(--ui-bg-tertiary))] text-white shadow-[inset_0_0.0625rem_0_color-mix(in_srgb,#fff_6%,transparent)]'
            : 'border-transparent bg-transparent text-(--ui-text-secondary) hover:border-[color-mix(in_srgb,var(--jarvis-hairline)_44%,transparent)] hover:bg-(--chrome-action-hover) hover:text-white'
      )}
      onClick={onClick}
      type="button"
    >
      <Icon
        className={cn(
          'shrink-0',
          nested ? 'size-3.5' : 'size-4',
          active ? 'text-foreground/80' : 'text-muted-foreground/80'
        )}
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </button>
  )
}
