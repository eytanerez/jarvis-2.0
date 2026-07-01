import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import type * as React from 'react'

import { cn } from '@/lib/utils'

// Small status/metadata tag. App radius (not a full pill); tones map to the
// shared accent/muted/destructive surfaces so badges read consistently.
const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center gap-1 rounded-[3px] px-1.5 py-0.5 text-[0.65rem] font-medium leading-none whitespace-nowrap [&_svg]:size-3 [&_svg]:pointer-events-none',
  {
    variants: {
      variant: {
        default: 'bg-[color-mix(in_srgb,var(--jarvis-blue)_12%,transparent)] text-(--jarvis-blue)',
        muted: 'bg-[color-mix(in_srgb,var(--jarvis-panel-soft)_80%,transparent)] text-(--jarvis-muted)',
        warn: 'bg-amber-500/10 text-amber-300',
        destructive: 'bg-[color-mix(in_srgb,var(--jarvis-danger)_12%,transparent)] text-(--jarvis-danger)',
        outline: 'border border-[color-mix(in_srgb,var(--jarvis-hairline)_72%,transparent)] text-(--jarvis-muted)'
      }
    },
    defaultVariants: { variant: 'default' }
  }
)

export interface BadgeProps extends React.ComponentProps<'span'>, VariantProps<typeof badgeVariants> {
  asChild?: boolean
}

export function Badge({ asChild = false, className, variant, ...props }: BadgeProps) {
  const Comp = asChild ? Slot.Root : 'span'

  return <Comp className={cn(badgeVariants({ variant }), className)} data-slot="badge" {...props} />
}

export { badgeVariants }
