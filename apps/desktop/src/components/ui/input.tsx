import * as React from 'react'

import { cn } from '@/lib/utils'

import { type ControlVariantProps, controlVariants } from './control'

function Input({ className, type, size, ...props }: Omit<React.ComponentProps<'input'>, 'size'> & ControlVariantProps) {
  return (
    <input
      className={cn(
        controlVariants({ size }),
        'selection:bg-[color-mix(in_srgb,var(--jarvis-blue)_28%,transparent)] selection:text-white file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-xs file:font-medium file:text-(--jarvis-text)',
        className
      )}
      data-slot="input"
      type={type}
      {...props}
    />
  )
}

export { Input }
