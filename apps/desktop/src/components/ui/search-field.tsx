import type { ReactNode, RefObject } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'
import { Loader2, Search } from '@/lib/icons'
import { cn } from '@/lib/utils'

interface SearchFieldProps {
  placeholder: string
  value: string
  onChange: (value: string) => void
  containerClassName?: string
  inputClassName?: string
  loading?: boolean
  onClear?: () => void
  inputRef?: RefObject<HTMLInputElement | null>
  trailingAction?: ReactNode
  'aria-label'?: string
}

/**
 * Shared search field used everywhere (sessions sidebar, pages, overlays,
 * command center, cron). No box — borderless until focus, then an underline.
 * Width/placement come from `containerClassName`.
 */
export function SearchField({
  placeholder,
  value,
  onChange,
  containerClassName,
  inputClassName,
  loading = false,
  onClear,
  inputRef,
  trailingAction,
  'aria-label': ariaLabel
}: SearchFieldProps) {
  const { t } = useI18n()
  const clear = onClear ?? (() => onChange(''))

  return (
    <div
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 border-b border-transparent px-0.5 transition-colors focus-within:border-[color-mix(in_srgb,var(--jarvis-blue)_54%,transparent)]',
        containerClassName
      )}
    >
      <Search className="pointer-events-none size-3.5 shrink-0 text-(--jarvis-muted)" />
      <input
        aria-label={ariaLabel}
        className={cn(
          // `field-sizing: content` grows the input to fit the placeholder/typed
          // text, capped by the container's max-width — no awkward empty space.
          'h-7 max-w-full bg-transparent text-sm text-(--jarvis-text) [field-sizing:content] placeholder:text-(--jarvis-muted) focus:outline-none',
          inputClassName
        )}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        ref={inputRef}
        type="text"
        value={value}
      />
      {trailingAction}
      {loading ? (
        <Loader2 className="pointer-events-none size-3.5 shrink-0 animate-spin text-(--jarvis-muted)" />
      ) : value ? (
        <Button
          aria-label={t.ui.search.clear}
          className="shrink-0 text-(--jarvis-muted) hover:bg-[color-mix(in_srgb,var(--jarvis-blue)_10%,transparent)] hover:text-white"
          onClick={clear}
          size="icon-xs"
          variant="ghost"
        >
          <Codicon name="close" size="0.875rem" />
        </Button>
      ) : null}
    </div>
  )
}
