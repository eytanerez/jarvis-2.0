import { useStore } from '@nanostores/react'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { GlyphSpinner } from '@/components/ui/glyph-spinner'
import { Switch } from '@/components/ui/switch'
import { useI18n } from '@/i18n'
import type { JarvisGateway } from '@/jarvis'
import { getGlobalModelOptions } from '@/jarvis'
import { displayModelName, modelDisplayParts } from '@/lib/model-status-label'
import {
  $visibleModels,
  collapseModelFamilies,
  effectiveVisibleKeys,
  emptyProviderSentinelKey,
  isProviderSentinel,
  modelVisibilityKey,
  setVisibleModels
} from '@/store/model-visibility'
import type { ModelOptionProvider, ModelOptionsResponse } from '@/types/jarvis'

interface ModelVisibilityDialogProps {
  gw?: JarvisGateway
  onOpenChange: (open: boolean) => void
  onOpenProviders: () => void
  open: boolean
  sessionId?: string | null
}

export function ModelVisibilityDialog({
  gw,
  onOpenChange,
  onOpenProviders,
  open,
  sessionId
}: ModelVisibilityDialogProps) {
  const { t } = useI18n()
  const copy = t.modelVisibility
  const [search, setSearch] = useState('')
  const stored = useStore($visibleModels)

  const modelOptions = useQuery({
    queryKey: ['model-options', sessionId || 'global'],
    queryFn: (): Promise<ModelOptionsResponse> => {
      if (gw && sessionId) {
        return gw.request<ModelOptionsResponse>('model.options', { session_id: sessionId })
      }

      return getGlobalModelOptions()
    },
    enabled: open
  })

  const providers = useMemo(
    () => (modelOptions.data?.providers ?? []).filter(provider => (provider.models ?? []).length > 0),
    [modelOptions.data]
  )

  const visible = effectiveVisibleKeys(stored, providers)

  const toggle = (provider: ModelOptionProvider, model: string) => {
    const next = new Set(effectiveVisibleKeys($visibleModels.get(), providers))
    const key = modelVisibilityKey(provider.slug, model)
    const sentinel = emptyProviderSentinelKey(provider.slug)

    if (next.has(key)) {
      next.delete(key)

      // Check if this was the last real model for this provider.
      const remainingForProvider = [...next].some(k => k.startsWith(`${provider.slug}::`) && !isProviderSentinel(k))

      if (!remainingForProvider) {
        next.add(sentinel)
      }
    } else {
      next.delete(sentinel)
      next.add(key)
    }

    setVisibleModels(next)
  }

  const q = search.trim().toLowerCase()

  const matches = (provider: ModelOptionProvider, model: string) =>
    !q || `${model} ${provider.name} ${provider.slug} ${displayModelName(model)}`.toLowerCase().includes(q)

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-xs gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-[color-mix(in_srgb,var(--jarvis-hairline)_58%,transparent)] px-3 pb-1 pt-3">
          <DialogTitle className="text-[0.8125rem]">{copy.title}</DialogTitle>
        </DialogHeader>

        <div className="border-b border-[color-mix(in_srgb,var(--jarvis-hairline)_44%,transparent)] px-3 py-1.5">
          <input
            autoFocus
            className="h-6 w-full rounded-[3px] bg-transparent px-0 text-xs text-(--jarvis-text) placeholder:text-(--jarvis-muted) focus:outline-none"
            onChange={event => setSearch(event.target.value)}
            placeholder={copy.search}
            type="text"
            value={search}
          />
        </div>

        <div className="max-h-[55vh] overflow-y-auto pb-1">
          {providers.length === 0 ? (
            <div className="px-3 py-5 text-center text-xs text-muted-foreground">
              {modelOptions.isPending ? <GlyphSpinner className="mx-auto text-sm" /> : copy.noAuthenticatedProviders}
            </div>
          ) : (
            providers.map(provider => {
              const models = collapseModelFamilies(provider.models ?? []).filter(family => matches(provider, family.id))

              if (models.length === 0) {
                return null
              }

              return (
                <div className="py-0.5" key={provider.slug}>
                  <div className="px-3 pb-0.5 pt-1 text-[0.625rem] font-medium uppercase text-(--jarvis-muted)">
                    {provider.name}
                  </div>
                  {models.map(family => {
                    const { name, tag } = modelDisplayParts(family.id)
                    const key = modelVisibilityKey(provider.slug, family.id)

                    return (
                      <label
                        className="flex cursor-pointer items-center gap-2 px-3 py-1 text-xs transition-colors hover:bg-[color-mix(in_srgb,var(--jarvis-blue)_9%,transparent)] hover:text-white"
                        key={key}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {name}
                          {tag ? <span className="text-(--jarvis-muted)"> {tag}</span> : null}
                        </span>
                        <Switch checked={visible.has(key)} onCheckedChange={() => toggle(provider, family.id)} />
                      </label>
                    )
                  })}
                </div>
              )
            })
          )}
        </div>

        <div className="border-t border-[color-mix(in_srgb,var(--jarvis-hairline)_44%,transparent)] px-3 py-2">
          <Button
            className="-ml-2 text-(--ui-text-tertiary)"
            onClick={() => {
              onOpenChange(false)
              onOpenProviders()
            }}
            size="xs"
            type="button"
            variant="text"
          >
            {copy.addProvider}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
