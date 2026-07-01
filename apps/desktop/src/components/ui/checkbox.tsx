import { Checkbox as CheckboxPrimitive } from 'radix-ui'
import * as React from 'react'

import { Codicon } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        'peer size-4 shrink-0 rounded-sm border border-[color-mix(in_srgb,var(--jarvis-hairline)_72%,transparent)] bg-[color-mix(in_srgb,var(--jarvis-panel-soft)_72%,transparent)] shadow-xs outline-none transition-[border-color,background-color,box-shadow] focus-visible:border-[color-mix(in_srgb,var(--jarvis-blue)_68%,transparent)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--jarvis-blue)_22%,transparent)] disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-[color-mix(in_srgb,var(--jarvis-blue)_72%,transparent)] data-[state=checked]:bg-(--jarvis-blue) data-[state=checked]:text-[color-mix(in_srgb,var(--jarvis-bg)_92%,black)] aria-invalid:border-(--jarvis-danger) aria-invalid:ring-[color-mix(in_srgb,var(--jarvis-danger)_20%,transparent)]',
        className
      )}
      data-slot="checkbox"
      {...props}
    >
      <CheckboxPrimitive.Indicator
        className="flex items-center justify-center text-current"
        data-slot="checkbox-indicator"
      >
        <Codicon name="check" size="0.875rem" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
