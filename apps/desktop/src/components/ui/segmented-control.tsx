import type { IconComponent } from '@/lib/icons'
import { cn } from '@/lib/utils'

export interface SegmentedControlOption<T extends string> {
  id: T
  label: string
  icon?: IconComponent
}

interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedControlOption<T>[]
  value: T
  onChange: (id: T) => void
  className?: string
}

/**
 * Grouped one-row toggle used for small mutually-exclusive choices
 * (color mode, tool-call display, usage period, etc.). Flat by design —
 * no per-option borders, just a tinted track with a raised active pill.
 */
export function SegmentedControl<T extends string>({ options, value, onChange, className }: SegmentedControlProps<T>) {
  return (
    <div
      className={cn(
        'inline-grid w-fit auto-cols-fr grid-flow-col gap-0.5 rounded-[5px] border border-[color-mix(in_srgb,var(--jarvis-hairline)_58%,transparent)] bg-[color-mix(in_srgb,var(--jarvis-panel-soft)_78%,transparent)] p-0.5',
        className
      )}
    >
      {options.map(({ id, label, icon: Icon }) => {
        const active = value === id

        return (
          <button
            aria-pressed={active}
            className={cn(
              'flex items-center justify-center gap-1 rounded-[3px] px-2.5 py-0.5 text-[0.6875rem] font-medium transition-[background-color,color,box-shadow]',
              active
                ? 'bg-[color-mix(in_srgb,var(--jarvis-blue)_16%,var(--jarvis-panel))] text-white shadow-[0_0_16px_color-mix(in_srgb,var(--jarvis-blue)_10%,transparent)]'
                : 'text-(--jarvis-muted) hover:bg-[color-mix(in_srgb,var(--jarvis-blue)_7%,transparent)] hover:text-white'
            )}
            key={id}
            onClick={() => onChange(id)}
            type="button"
          >
            {Icon && <Icon className="size-3" />}
            {label}
          </button>
        )
      })}
    </div>
  )
}
