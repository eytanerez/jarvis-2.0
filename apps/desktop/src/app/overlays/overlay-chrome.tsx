import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export const overlayCardClass =
  'rounded-lg border border-[color-mix(in_srgb,var(--jarvis-hairline)_68%,transparent)] bg-[color-mix(in_srgb,var(--dt-card)_76%,#02040a)] shadow-[inset_0_0.0625rem_0_color-mix(in_srgb,white_7%,transparent),0_0_1.25rem_color-mix(in_srgb,var(--jarvis-blue)_5%,transparent)]'

interface OverlayCardProps extends ComponentProps<'div'> {
  children: ReactNode
}

interface OverlayActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: 'default' | 'danger' | 'subtle'
}

export function OverlayCard({ children, className, ...props }: OverlayCardProps) {
  return (
    <div className={cn(overlayCardClass, className)} {...props}>
      {children}
    </div>
  )
}

export function OverlayActionButton({
  children,
  className,
  tone = 'default',
  type = 'button',
  ...props
}: OverlayActionButtonProps) {
  return (
    <Button
      className={cn(
        'h-8 px-3',
        tone === 'subtle' && 'h-7 px-2',
        tone === 'danger' &&
          'h-7 px-2 text-destructive hover:border-[color-mix(in_srgb,var(--dt-destructive)_40%,transparent)] hover:bg-[color-mix(in_srgb,var(--dt-destructive)_10%,transparent)] hover:text-destructive',
        className
      )}
      size="sm"
      type={type}
      variant={tone === 'danger' ? 'ghost' : tone === 'subtle' ? 'ghost' : 'secondary'}
      {...props}
    >
      {children}
    </Button>
  )
}

interface OverlayIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
}

export function OverlayIconButton({ children, className, type = 'button', ...props }: OverlayIconButtonProps) {
  return (
    <OverlayActionButton
      className={cn('h-7 w-7 justify-center px-0 [&_svg]:size-4', className)}
      tone="subtle"
      type={type}
      {...props}
    >
      {children}
    </OverlayActionButton>
  )
}
