import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import * as React from 'react'

import { cn } from '@/lib/utils'

// Text+icon actions underline the label on hover, not the glyph.
const TEXT_ACTION_ICON = '[&_.codicon]:no-underline [&_svg]:no-underline'

// Text buttons are square (no radius) and sized by padding + line-height — no
// fixed heights — so they stay snug and scale with content. Only icon buttons
// (inherently square) carry the shared 4px radius.
const buttonVariants = cva(
  "jarvis-button relative isolate inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 overflow-hidden rounded-[3px] border border-transparent text-xs leading-4 font-medium whitespace-nowrap shadow-none transition-[background-color,border-color,box-shadow,color,opacity,transform,text-shadow] duration-150 ease-out outline-none active:scale-[0.975] focus-visible:border-[color-mix(in_srgb,var(--jarvis-blue)_62%,transparent)] focus-visible:ring-[0.1875rem] focus-visible:ring-[color-mix(in_srgb,var(--jarvis-blue)_18%,transparent)] motion-reduce:transition-none motion-reduce:active:scale-100 disabled:pointer-events-none disabled:cursor-default disabled:opacity-45 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        default:
          'border-[color-mix(in_srgb,var(--jarvis-blue)_38%,transparent)] bg-[color-mix(in_srgb,var(--jarvis-panel)_84%,#02040a)] text-(--jarvis-text) shadow-[inset_0_1px_0_color-mix(in_srgb,#fff_7%,transparent),0_0_0_1px_color-mix(in_srgb,var(--jarvis-blue)_6%,transparent)] hover:border-[color-mix(in_srgb,var(--jarvis-blue)_72%,transparent)] hover:bg-[color-mix(in_srgb,var(--jarvis-blue)_14%,var(--jarvis-panel))] hover:text-white hover:shadow-[inset_0_1px_0_color-mix(in_srgb,#fff_9%,transparent),0_0_1.125rem_color-mix(in_srgb,var(--jarvis-blue)_20%,transparent)]',
        destructive:
          'border-[color-mix(in_srgb,var(--dt-destructive)_46%,transparent)] bg-[color-mix(in_srgb,var(--dt-destructive)_16%,#14050a)] text-white hover:border-destructive hover:bg-[color-mix(in_srgb,var(--dt-destructive)_28%,#14050a)] focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40',
        // Quiet action — transparent fill with a 1.5px inset ring (no layout-shifting border).
        outline:
          'border-[color-mix(in_srgb,var(--jarvis-hairline)_72%,transparent)] bg-transparent text-(--jarvis-text) shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--jarvis-blue)_6%,transparent)] hover:border-[color-mix(in_srgb,var(--jarvis-blue)_58%,transparent)] hover:bg-[color-mix(in_srgb,var(--jarvis-blue)_10%,transparent)] hover:text-white',
        // Soft-fill action (the default "non-primary button" look).
        secondary:
          'border-[color-mix(in_srgb,var(--jarvis-hairline)_54%,transparent)] bg-[color-mix(in_srgb,var(--jarvis-panel-soft)_86%,transparent)] text-(--jarvis-text) hover:border-[color-mix(in_srgb,var(--jarvis-blue)_42%,transparent)] hover:bg-[color-mix(in_srgb,var(--jarvis-blue)_10%,transparent)] hover:text-white',
        ghost:
          'border-transparent bg-transparent text-(--jarvis-muted) hover:border-[color-mix(in_srgb,var(--jarvis-hairline)_42%,transparent)] hover:bg-[color-mix(in_srgb,var(--jarvis-blue)_10%,transparent)] hover:text-white',
        jarvis:
          'border-[color-mix(in_srgb,var(--theme-orb-core)_64%,transparent)] bg-(--theme-jarvis-blue) text-(--theme-jarvis-bg-deep) hover:bg-(--theme-orb-core) hover:text-(--theme-jarvis-bg-deep) shadow-[0_0_1.25rem_color-mix(in_srgb,var(--theme-orb-glow)_28%,transparent)]',
        jarvisCommand:
          'border-[color-mix(in_srgb,var(--theme-jarvis-stroke)_92%,transparent)] bg-[color-mix(in_srgb,var(--theme-jarvis-panel)_78%,transparent)] text-(--theme-jarvis-text-tech) shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--theme-jarvis-stroke)_45%,transparent)] hover:bg-[color-mix(in_srgb,var(--theme-orb-ring)_12%,var(--theme-jarvis-panel))] hover:text-(--theme-orb-core) hover:shadow-[inset_0_0_0_1px_var(--theme-jarvis-stroke-strong),0_0_1rem_color-mix(in_srgb,var(--theme-orb-glow)_16%,transparent)]',
        jarvisGhost:
          'border-transparent bg-transparent text-(--theme-jarvis-text-tech) hover:border-[color-mix(in_srgb,var(--theme-orb-ring)_35%,transparent)] hover:bg-[color-mix(in_srgb,var(--theme-orb-ring)_10%,transparent)] hover:text-(--theme-orb-core)',
        jarvisIcon:
          'border-transparent bg-transparent text-(--theme-jarvis-text-tech) hover:border-[color-mix(in_srgb,var(--theme-orb-ring)_35%,transparent)] hover:bg-[color-mix(in_srgb,var(--theme-orb-ring)_10%,transparent)] hover:text-(--theme-orb-core)',
        link: `text-(--jarvis-blue) underline-offset-4 decoration-current/20 hover:underline ${TEXT_ACTION_ICON}`,
        // Boxless inline-text action (no bg/border). Quiet by default — reads as
        // muted label text, underlines on hover (e.g. "Cancel", "Clear").
        text: `border-transparent bg-transparent text-(--jarvis-muted) underline-offset-4 hover:text-white hover:underline ${TEXT_ACTION_ICON}`,
        // Emphasized inline-text action: bold + always-underlined link. Use for
        // the actionable affordance in a row ("Change", "Set", "Open logs", …).
        textStrong: `border-transparent bg-transparent font-semibold text-(--jarvis-muted) underline underline-offset-4 hover:text-white ${TEXT_ACTION_ICON}`
      },
      size: {
        default: 'px-3 py-1.5 has-[>svg]:px-2.5',
        xs: "gap-1 px-2 py-0.5 text-[0.6875rem] leading-4 has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: 'px-2.5 py-1 has-[>svg]:px-2',
        lg: 'px-5 py-2 text-sm leading-5 has-[>svg]:px-4',
        // Flush inline text action — no box padding/height. Pair with text/link
        // variants when the button must sit inline in a heading or sentence
        // (replaces ad-hoc `h-auto px-0 py-0` overrides).
        inline: 'h-auto gap-1 p-0 has-[>svg]:px-0',
        // Status-stack headers, table footers — 12px text actions beside a label.
        micro:
          "h-auto gap-0.5 px-1 py-0 text-xs leading-4 font-normal has-[>svg]:px-0.5 [&_svg:not([class*='size-'])]:size-3",
        icon: 'size-9 rounded-[4px]',
        'icon-xs': "size-6 rounded-[4px] [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-8 rounded-[4px]',
        'icon-lg': 'size-10 rounded-[4px]',
        'icon-titlebar':
          'h-(--titlebar-control-height) w-(--titlebar-control-size) rounded-[4px] [&_.codicon]:text-[0.875rem]'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
)

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : 'button'

  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), className)}
      data-size={size}
      data-slot="button"
      data-variant={variant}
      {...props}
    />
  )
}

export { Button, buttonVariants }
