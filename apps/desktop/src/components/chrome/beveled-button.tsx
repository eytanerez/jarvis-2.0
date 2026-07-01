import type { ComponentProps, ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { BeveledFrame } from './beveled-frame'

const CORNER_DOTS = ['top-0 left-0', 'top-0 right-0', 'bottom-0 left-0', 'bottom-0 right-0']
// Mid-edge dots only appear on hover — the "reticle expanding" detail from the reference.
const EDGE_DOTS = ['left-0 top-1/2 -translate-y-1/2', 'right-0 top-1/2 -translate-y-1/2']

export interface BeveledButtonProps extends Omit<ComponentProps<typeof Button>, 'variant'> {
  children: ReactNode
  /** Stretches the frame + button to the container's width instead of sizing to content. */
  fullWidth?: boolean
  /** `ghost` mirrors an outlined trigger; `solid` fills in on hover. */
  variant?: 'ghost' | 'solid'
}

export function BeveledButton({
  children,
  className,
  fullWidth = false,
  variant = 'ghost',
  ...props
}: BeveledButtonProps) {
  return (
    <BeveledFrame chamfer={8} className={fullWidth ? 'flex w-full' : 'inline-flex'} interactive>
      <Button
        className={cn(
          'relative isolate w-full gap-2 overflow-hidden rounded-none border-transparent bg-transparent font-label uppercase tracking-[0.12em] text-(--jarvis-text) shadow-none hover:border-transparent hover:bg-transparent',
          variant === 'solid' ? 'group-hover:text-(--theme-jarvis-bg-deep)' : 'hover:text-(--jarvis-text)',
          className
        )}
        variant="ghost"
        {...props}
      >
        {variant === 'solid' && (
          <span
            aria-hidden
            className="absolute inset-0 -z-10 bg-(--jarvis-blue) opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100 motion-reduce:transition-none [clip-path:polygon(8px_0,calc(100%-8px)_0,100%_8px,100%_calc(100%-8px),calc(100%-8px)_100%,8px_100%,0_calc(100%-8px),0_8px)]"
          />
        )}

        <span aria-hidden className="relative inline-block size-2 shrink-0">
          {CORNER_DOTS.map(position => (
            <span
              className={cn(
                'absolute size-[3px] bg-current opacity-40 transition-opacity duration-150 ease-out group-hover:opacity-100 motion-reduce:transition-none',
                position
              )}
              key={position}
            />
          ))}
          {EDGE_DOTS.map(position => (
            <span
              className={cn(
                'absolute size-[3px] bg-current opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100 motion-reduce:transition-none',
                position
              )}
              key={position}
            />
          ))}
        </span>

        <span className="relative isolate inline-grid overflow-hidden text-left">
          <span className="col-start-1 row-start-1 transition-transform duration-150 ease-out group-hover:-translate-y-full motion-reduce:transition-none">
            {children}
          </span>
          <span
            aria-hidden
            className="col-start-1 row-start-1 translate-y-full transition-transform duration-150 ease-out group-hover:translate-y-0 motion-reduce:transition-none"
          >
            {children}
          </span>
        </span>
      </Button>
    </BeveledFrame>
  )
}
