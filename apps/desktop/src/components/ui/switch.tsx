import { cva, type VariantProps } from 'class-variance-authority'
import { Switch as SwitchPrimitive } from 'radix-ui'
import * as React from 'react'

import { cn } from '@/lib/utils'

const switchVariants = cva(
  'peer inline-flex shrink-0 items-center rounded-full border border-[color-mix(in_srgb,var(--jarvis-hairline)_70%,transparent)] bg-[color-mix(in_srgb,var(--jarvis-panel-soft)_78%,transparent)] shadow-[inset_0_0_0_0.0625rem_color-mix(in_srgb,var(--jarvis-blue)_7%,transparent)] outline-none transition-colors focus-visible:border-[color-mix(in_srgb,var(--jarvis-blue)_68%,transparent)] focus-visible:ring-[0.1875rem] focus-visible:ring-[color-mix(in_srgb,var(--jarvis-blue)_22%,transparent)] disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-[color-mix(in_srgb,var(--jarvis-blue)_62%,transparent)] data-[state=checked]:bg-[color-mix(in_srgb,var(--jarvis-blue)_34%,var(--jarvis-panel))]',
  {
    variants: {
      size: {
        default: 'h-5 w-9',
        xs: 'h-4 w-7'
      }
    },
    defaultVariants: {
      size: 'default'
    }
  }
)

const switchThumbVariants = cva(
  'pointer-events-none block rounded-full bg-(--jarvis-muted) shadow-[0_0.0625rem_0.1875rem_color-mix(in_srgb,var(--dt-background)_50%,transparent)] ring-0 transition-transform data-[state=unchecked]:translate-x-0 data-[state=checked]:bg-white',
  {
    variants: {
      size: {
        default: 'size-4 data-[state=checked]:translate-x-4',
        xs: 'size-3 data-[state=checked]:translate-x-3.5'
      }
    },
    defaultVariants: {
      size: 'default'
    }
  }
)

function Switch({
  className,
  size,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & VariantProps<typeof switchVariants>) {
  return (
    <SwitchPrimitive.Root className={cn(switchVariants({ size }), className)} data-slot="switch" {...props}>
      <SwitchPrimitive.Thumb className={switchThumbVariants({ size })} data-slot="switch-thumb" />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
