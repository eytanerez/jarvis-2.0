import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'

import { cn } from '@/lib/utils'

const alertVariants = cva(
  'relative grid w-full grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1 rounded-md border bg-[color-mix(in_srgb,var(--jarvis-panel)_90%,transparent)] px-4 py-3 text-sm text-(--jarvis-text) shadow-xs [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'border-[color-mix(in_srgb,var(--jarvis-hairline)_68%,transparent)]',
        destructive:
          'border-[color-mix(in_srgb,var(--jarvis-danger)_42%,transparent)] bg-[color-mix(in_srgb,var(--jarvis-danger)_8%,var(--jarvis-panel))] [&>svg]:text-(--jarvis-danger)',
        warning:
          'border-[color-mix(in_srgb,var(--jarvis-blue)_30%,transparent)] bg-[color-mix(in_srgb,var(--jarvis-blue)_7%,var(--jarvis-panel))] [&>svg]:text-(--jarvis-blue)',
        success:
          'border-[color-mix(in_srgb,var(--jarvis-blue)_26%,transparent)] bg-[color-mix(in_srgb,var(--jarvis-blue)_6%,var(--jarvis-panel))] [&>svg]:text-(--jarvis-blue)'
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
)

function Alert({ className, variant, ...props }: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return <div className={cn(alertVariants({ variant }), className)} data-slot="alert" role="alert" {...props} />
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('col-start-2 line-clamp-1 min-h-4 font-medium text-(--jarvis-text)', className)}
      data-slot="alert-title"
      {...props}
    />
  )
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'col-start-2 grid justify-items-start gap-1 text-(--jarvis-muted) [&_p]:leading-relaxed',
        className
      )}
      data-slot="alert-description"
      {...props}
    />
  )
}

export { Alert, AlertDescription, AlertTitle }
