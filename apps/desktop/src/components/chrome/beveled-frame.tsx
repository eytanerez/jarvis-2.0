import { type ReactNode, useCallback, useRef, useState } from 'react'

import { useResizeObserver } from '@/hooks/use-resize-observer'
import { cn } from '@/lib/utils'

type Corner = 'bl' | 'br' | 'tl' | 'tr'

const ALL_CORNERS: readonly Corner[] = ['tl', 'tr', 'bl', 'br']

export interface BeveledFrameProps {
  children: ReactNode
  className?: string
  /** Size in px of the 45°-cut corner. */
  chamfer?: number
  /** Which corners get cut. Defaults to all four. */
  corners?: readonly Corner[]
  /** Renders a second, brighter outline that fades in on hover/keyboard focus. */
  interactive?: boolean
}

function chamferedRectPath(width: number, height: number, chamfer: number, cut: ReadonlySet<Corner>): string {
  if (width <= 0 || height <= 0) {
    return ''
  }

  const c = Math.max(0, Math.min(chamfer, width / 2, height / 2))
  const points: Array<[number, number]> = []

  points.push(cut.has('tl') ? [c, 0] : [0, 0])
  points.push(cut.has('tr') ? [width - c, 0] : [width, 0])

  if (cut.has('tr')) {
    points.push([width, c])
  }

  points.push(cut.has('br') ? [width, height - c] : [width, height])

  if (cut.has('br')) {
    points.push([width - c, height])
  }

  points.push(cut.has('bl') ? [c, height] : [0, height])

  if (cut.has('bl')) {
    points.push([0, height - c])
  }

  if (cut.has('tl')) {
    points.push([0, c])
  }

  return `M ${points.map(([x, y]) => `${x} ${y}`).join(' L ')} Z`
}

/**
 * Measures its own box and draws a chamfered-corner outline over it — the
 * same primitive at button scale (small chamfer, `interactive`) and at
 * viewport-frame scale (large chamfer, static), mirroring how hubtown.co.in
 * reuses one "beveled box" component for both.
 */
export function BeveledFrame({
  children,
  className,
  chamfer = 10,
  corners = ALL_CORNERS,
  interactive = false
}: BeveledFrameProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  const measure = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect()

    if (rect) {
      setSize({ width: rect.width, height: rect.height })
    }
  }, [])

  useResizeObserver(measure, containerRef)

  const cutCorners = new Set(corners)
  const path = chamferedRectPath(size.width, size.height, chamfer, cutCorners)

  return (
    <div className={cn('relative [-webkit-app-region:no-drag]', interactive && 'group', className)} ref={containerRef}>
      {children}
      {path && (
        <svg
          aria-hidden
          className="pointer-events-none absolute inset-0 size-full overflow-visible"
          preserveAspectRatio="none"
          viewBox={`0 0 ${size.width} ${size.height}`}
        >
          <path
            d={path}
            fill="none"
            stroke="color-mix(in srgb, var(--jarvis-hairline) 72%, transparent)"
            strokeWidth={1}
          />
          {interactive && (
            <path
              className="opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none"
              d={path}
              fill="none"
              stroke="var(--jarvis-blue)"
              strokeWidth={1}
            />
          )}
        </svg>
      )}
    </div>
  )
}
