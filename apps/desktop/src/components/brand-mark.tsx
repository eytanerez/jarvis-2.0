import { cn } from '@/lib/utils'

const assetPath = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`

// Brand badge: the Jarvis app icon, shared with the packaged desktop app.
// Fills the tile (softly rounded); size via className (default size-14).
export function BrandMark({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'inline-flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-[22%] bg-black',
        className
      )}
      {...props}
    >
      <img alt="" className="size-full object-contain" src={assetPath('apple-touch-icon.png')} />
    </span>
  )
}
