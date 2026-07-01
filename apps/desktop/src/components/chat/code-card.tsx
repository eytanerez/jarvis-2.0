import * as React from 'react'

import { Codicon, type CodiconProps } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'

/**
 * Rounded-card shell for fenced code (and any equivalent: diffs, raw payloads,
 * etc.) sized for the conversation column. Mirrors the expanded tool-row
 * pattern so code blocks read as the same family of artifact.
 */
function CodeCard({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'min-w-0 max-w-full overflow-hidden rounded-md border border-[color-mix(in_srgb,var(--jarvis-hairline)_68%,transparent)] bg-[color-mix(in_srgb,var(--dt-card)_72%,#02040a)] text-[length:var(--conversation-tool-font-size)] text-muted-foreground shadow-[inset_0_0.0625rem_0_color-mix(in_srgb,#fff_5%,transparent)]',
        className
      )}
      data-slot="code-card"
      {...props}
    />
  )
}

function CodeCardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 border-b border-[color-mix(in_srgb,var(--jarvis-hairline)_58%,transparent)] bg-[color-mix(in_srgb,var(--jarvis-blue)_4%,transparent)] px-2 py-1.5',
        className
      )}
      data-slot="code-card-header"
      {...props}
    />
  )
}

function CodeCardTitle({ className, children, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'flex min-w-0 items-center gap-1.5 truncate text-[length:var(--conversation-tool-font-size)] font-medium leading-(--conversation-line-height) text-(--ui-text-secondary)',
        className
      )}
      data-slot="code-card-title"
      {...props}
    >
      {children}
    </span>
  )
}

function CodeCardIcon({ className, ...props }: CodiconProps) {
  return (
    <Codicon
      className={cn('shrink-0 text-[0.875rem] leading-none text-(--ui-text-tertiary)', className)}
      data-slot="code-card-icon"
      {...props}
    />
  )
}

function CodeCardSubtitle({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn('font-normal text-(--ui-text-tertiary)', className)}
      data-slot="code-card-subtitle"
      {...props}
    />
  )
}

function CodeCardBody({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'font-mono text-[0.7rem] leading-relaxed text-(--ui-text-secondary) [&_pre]:m-0 [&_pre]:overflow-x-auto [&_pre]:bg-transparent! [&_pre]:px-2 [&_pre]:py-1.5 [&_pre]:font-mono [&_pre]:leading-relaxed',
        className
      )}
      data-slot="code-card-body"
      {...props}
    />
  )
}

export { CodeCard, CodeCardBody, CodeCardHeader, CodeCardIcon, CodeCardSubtitle, CodeCardTitle }
