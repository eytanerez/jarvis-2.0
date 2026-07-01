import { Tabs as TabsPrimitive } from 'radix-ui'
import * as React from 'react'

import { cn } from '@/lib/utils'

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root className={cn('flex flex-col gap-2', className)} data-slot="tabs" {...props} />
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        'inline-flex h-9 items-center justify-center rounded-md border border-[color-mix(in_srgb,var(--jarvis-hairline)_58%,transparent)] bg-[color-mix(in_srgb,var(--jarvis-panel-soft)_78%,transparent)] p-1 text-(--jarvis-muted)',
        className
      )}
      data-slot="tabs-list"
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap outline-none transition-all focus-visible:ring-[0.1875rem] focus-visible:ring-[color-mix(in_srgb,var(--jarvis-blue)_22%,transparent)] disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-[color-mix(in_srgb,var(--jarvis-blue)_14%,var(--jarvis-panel))] data-[state=active]:text-white data-[state=active]:shadow-xs [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
        className
      )}
      data-slot="tabs-trigger"
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger }
