import { Command as CommandPrimitive } from 'cmdk'
import * as React from 'react'

import { SearchIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      className={cn(
        'flex h-full w-full flex-col overflow-hidden rounded-md bg-[color-mix(in_srgb,var(--jarvis-panel)_94%,transparent)] text-(--jarvis-text)',
        className
      )}
      data-slot="command"
      {...props}
    />
  )
}

function CommandInput({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div
      className="flex h-11 items-center gap-2 border-b border-[color-mix(in_srgb,var(--jarvis-hairline)_64%,transparent)] px-3"
      data-slot="command-input-wrapper"
    >
      <SearchIcon className="size-4 shrink-0 text-(--jarvis-blue)" />
      <CommandPrimitive.Input
        className={cn(
          'flex h-10 w-full rounded-md bg-transparent py-3 text-sm text-(--jarvis-text) outline-none placeholder:text-(--jarvis-muted) disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        data-slot="command-input"
        {...props}
      />
    </div>
  )
}

function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      className={cn('max-h-100 overflow-y-auto overflow-x-hidden', className)}
      data-slot="command-list"
      {...props}
    />
  )
}

function CommandEmpty({ ...props }: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      className="py-6 text-center text-sm text-muted-foreground"
      data-slot="command-empty"
      {...props}
    />
  )
}

function CommandGroup({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      className={cn(
        'overflow-hidden p-1 text-(--jarvis-text) **:[[cmdk-group-heading]]:sticky **:[[cmdk-group-heading]]:top-0 **:[[cmdk-group-heading]]:z-10 **:[[cmdk-group-heading]]:bg-[color-mix(in_srgb,var(--jarvis-panel)_96%,transparent)] **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:py-1.5 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-(--jarvis-muted)',
        className
      )}
      data-slot="command-group"
      {...props}
    />
  )
}

function CommandSeparator({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      className={cn('-mx-1 h-px bg-[color-mix(in_srgb,var(--jarvis-hairline)_64%,transparent)]', className)}
      data-slot="command-separator"
      {...props}
    />
  )
}

function CommandItem({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      className={cn(
        'relative flex cursor-default select-none items-center gap-2 rounded-[3px] px-2 py-1.5 text-sm outline-none transition-[background-color,color] data-[disabled=true]:pointer-events-none data-[selected=true]:bg-[color-mix(in_srgb,var(--jarvis-blue)_13%,transparent)] data-[selected=true]:text-white data-[disabled=true]:opacity-50',
        className
      )}
      data-slot="command-item"
      {...props}
    />
  )
}

function CommandShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span className={cn('ml-auto text-xs text-(--jarvis-muted)', className)} data-slot="command-shortcut" {...props} />
  )
}

export {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut
}
