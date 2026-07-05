import { IconCloud, IconDeviceMobile, IconQrcode, IconWifi } from '@tabler/icons-react'
import QRCode from 'qrcode'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import type { DesktopMobileState } from '@/global'
import { triggerHaptic } from '@/lib/haptics'
import { CheckCircle2, Copy, Loader2, Trash2, X } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { notify, notifyError } from '@/store/notifications'

import { ListRow, Pill, SectionHeading, SettingsContent } from './primitives'

const EMPTY_STATE: DesktopMobileState = {
  devices: [],
  enabled: false,
  hostId: null,
  lanPort: null,
  lanUrls: [],
  relay: { connected: false, url: null }
}

function mobileApi() {
  return window.jarvisDesktop?.mobile ?? null
}

function formatLastSeen(iso: string | null): string {
  if (!iso) {
    return 'never connected'
  }

  const delta = Date.now() - new Date(iso).getTime()

  if (delta < 90_000) {
    return 'just now'
  }

  if (delta < 3_600_000) {
    return `${Math.round(delta / 60_000)}m ago`
  }

  if (delta < 86_400_000) {
    return `${Math.round(delta / 3_600_000)}h ago`
  }

  return new Date(iso).toLocaleDateString()
}

/**
 * Settings → Linked Devices: pair an iPhone running the Jarvis mobile app,
 * see and revoke linked phones, and point the bridge at a cloud relay so the
 * phone works away from home. The desktop stays the host — phones are remote
 * surfaces (see plans/jarvis-mobile-spec.md in the Jarvis 3.0 App repo).
 */
export function MobileSettings() {
  const [state, setState] = useState<DesktopMobileState>(EMPTY_STATE)
  const [loaded, setLoaded] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [qrExpiresAt, setQrExpiresAt] = useState<number | null>(null)
  const [qrSecondsLeft, setQrSecondsLeft] = useState(0)
  const [relayDraft, setRelayDraft] = useState<string | null>(null)
  const [savingRelay, setSavingRelay] = useState(false)
  const [revoking, setRevoking] = useState<string | null>(null)
  const qrUrlRef = useRef<string | null>(null)

  useEffect(() => {
    const api = mobileApi()

    if (!api) {
      setLoaded(true)

      return
    }

    let disposed = false

    api
      .getState()
      .then(next => {
        if (!disposed) {
          setState(next)
          setLoaded(true)
        }
      })
      .catch(() => setLoaded(true))

    const unsubscribe = api.onState(next => {
      if (!disposed) {
        setState(next)
      }
    })

    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  // Pairing QR countdown; the code is one-shot and short-lived by design.
  useEffect(() => {
    if (!qrExpiresAt) {
      return
    }

    const tick = () => {
      const left = Math.max(0, Math.round((qrExpiresAt - Date.now()) / 1000))

      setQrSecondsLeft(left)

      if (left === 0) {
        setQrDataUrl(null)
        setQrExpiresAt(null)
        qrUrlRef.current = null
      }
    }

    tick()

    const timer = window.setInterval(tick, 1000)

    return () => window.clearInterval(timer)
  }, [qrExpiresAt])

  const toggleEnabled = async (enabled: boolean) => {
    const api = mobileApi()

    if (!api) {
      return
    }

    setToggling(true)
    triggerHaptic(enabled ? 'success' : 'selection')

    try {
      const next = await api.enable(enabled)

      setState(next)

      if (!enabled) {
        setQrDataUrl(null)
        setQrExpiresAt(null)
      }
    } catch (err) {
      notifyError(err, 'Could not update mobile access')
    } finally {
      setToggling(false)
    }
  }

  const generateQr = async () => {
    const api = mobileApi()

    if (!api) {
      return
    }

    triggerHaptic('open')

    try {
      const pairing = await api.pair()

      if (!pairing.ok || !pairing.url) {
        notifyError(new Error(pairing.error || 'pairing unavailable'), 'Could not create a pairing code')

        return
      }

      qrUrlRef.current = pairing.url

      const dataUrl = await QRCode.toDataURL(pairing.url, {
        color: { dark: '#0a0c10', light: '#f4ede0' },
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 480
      })

      setQrDataUrl(dataUrl)
      setQrExpiresAt(pairing.expiresAt ?? Date.now() + 5 * 60_000)
    } catch (err) {
      notifyError(err, 'Could not create a pairing code')
    }
  }

  const saveRelay = async () => {
    const api = mobileApi()

    if (!api || relayDraft === null) {
      return
    }

    setSavingRelay(true)

    try {
      const next = await api.setRelayUrl(relayDraft.trim() || null)

      setState(next)
      setRelayDraft(null)
      notify({
        kind: 'success',
        message: relayDraft.trim() ? 'Relay saved — the bridge is reconnecting' : 'Relay removed'
      })
    } catch (err) {
      notifyError(err, 'Could not save the relay URL')
    } finally {
      setSavingRelay(false)
    }
  }

  const revoke = async (id: string, name: string) => {
    const api = mobileApi()

    if (!api) {
      return
    }

    if (
      !window.confirm(
        `Unlink “${name}”? The phone will be disconnected immediately and can only return by scanning a new QR code.`
      )
    ) {
      return
    }

    setRevoking(id)
    triggerHaptic('warning')

    try {
      await api.revoke(id)
    } catch (err) {
      notifyError(err, 'Could not unlink the device')
    } finally {
      setRevoking(null)
    }
  }

  const supported = mobileApi() !== null
  const activeDevices = state.devices.filter(device => !device.revoked)

  return (
    <SettingsContent>
      <div className="flex flex-col gap-6 pb-8">
        <div>
          <SectionHeading icon={IconDeviceMobile} meta={state.enabled ? 'On' : 'Off'} title="LINKED DEVICES" />
          <div className="divide-y divide-border/30">
            <ListRow
              action={
                <div className="flex items-center justify-end gap-2">
                  {toggling && <Loader2 className="size-3.5 animate-spin text-(--ui-text-tertiary)" />}
                  <Switch
                    aria-label="Allow linked devices"
                    checked={state.enabled}
                    disabled={!supported || toggling || !loaded}
                    onCheckedChange={(value: boolean) => void toggleEnabled(value)}
                  />
                </div>
              }
              description={
                supported
                  ? 'Let the Jarvis iPhone app pair with this Mac. Phones talk to Jarvis through an end-to-end encrypted link — this computer stays the host.'
                  : 'This build of the desktop app does not include the mobile bridge.'
              }
              title="Allow linked devices"
            />
          </div>
        </div>

        {state.enabled && (
          <>
            <div>
              <SectionHeading icon={IconQrcode} title="PAIR A PHONE" />
              <div className="divide-y divide-border/30">
                <ListRow
                  action={
                    <div className="flex items-center justify-end">
                      <Button onClick={() => void generateQr()} size="sm" type="button" variant="outline">
                        <IconQrcode className="size-3.5" />
                        {qrDataUrl ? 'New code' : 'Show pairing code'}
                      </Button>
                    </div>
                  }
                  below={
                    qrDataUrl ? (
                      <div className="mt-3 flex flex-col items-center gap-3 rounded-xl border border-border/40 bg-black/20 p-6">
                        <img
                          alt="Jarvis pairing QR code"
                          className="size-56 rounded-lg"
                          draggable={false}
                          src={qrDataUrl}
                        />
                        <div className="flex items-center gap-2 text-xs text-(--ui-text-tertiary)">
                          <span>
                            Scan with the Jarvis app · expires in {Math.floor(qrSecondsLeft / 60)}:
                            {String(qrSecondsLeft % 60).padStart(2, '0')}
                          </span>
                          <button
                            className="inline-flex items-center gap-1 text-(--ui-text-secondary) hover:text-(--ui-text-primary)"
                            onClick={() => {
                              if (qrUrlRef.current) {
                                void navigator.clipboard.writeText(qrUrlRef.current)
                                triggerHaptic('success')
                                notify({ kind: 'success', message: 'Pairing link copied' })
                              }
                            }}
                            type="button"
                          >
                            <Copy className="size-3" /> Copy link
                          </button>
                          <button
                            className="inline-flex items-center gap-1 text-(--ui-text-secondary) hover:text-(--ui-text-primary)"
                            onClick={() => {
                              setQrDataUrl(null)
                              setQrExpiresAt(null)
                            }}
                            type="button"
                          >
                            <X className="size-3" /> Hide
                          </button>
                        </div>
                      </div>
                    ) : null
                  }
                  description="One-time code, valid for 5 minutes. The QR carries the encryption key for this phone, so only show it to a device you trust."
                  title="Pairing code"
                />
              </div>
            </div>

            <div>
              <SectionHeading
                icon={IconDeviceMobile}
                meta={activeDevices.length > 0 ? String(activeDevices.length) : undefined}
                title="PHONES"
              />
              <div className="divide-y divide-border/30">
                {activeDevices.length === 0 ? (
                  <p className="py-3 text-sm text-(--ui-text-tertiary)">
                    No phones linked yet — show a pairing code and scan it with the Jarvis app.
                  </p>
                ) : (
                  activeDevices.map(device => (
                    <ListRow
                      action={
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            disabled={revoking === device.id}
                            onClick={() => void revoke(device.id, device.name)}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            {revoking === device.id ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="size-3.5" />
                            )}
                            Unlink
                          </Button>
                        </div>
                      }
                      description={
                        <span className="flex items-center gap-2">
                          <span
                            className={cn(
                              'inline-block size-1.5 rounded-full',
                              device.connected ? 'bg-emerald-400' : 'bg-(--ui-text-tertiary)/40'
                            )}
                          />
                          {device.connected ? 'Connected now' : `Last seen ${formatLastSeen(device.lastSeenAt)}`}
                          {device.model ? <span className="text-(--ui-text-tertiary)">· {device.model}</span> : null}
                        </span>
                      }
                      key={device.id}
                      title={device.name}
                    />
                  ))
                )}
              </div>
            </div>

            <div>
              <SectionHeading icon={IconCloud} title="REACHABILITY" />
              <div className="divide-y divide-border/30">
                <ListRow
                  action={
                    <div className="flex items-center justify-end gap-2">
                      {state.relay.url ? (
                        state.relay.connected ? (
                          <Pill tone="primary">
                            <CheckCircle2 className="mr-1 size-3" /> Connected
                          </Pill>
                        ) : (
                          <Pill>Connecting…</Pill>
                        )
                      ) : (
                        <Pill>Not set</Pill>
                      )}
                    </div>
                  }
                  below={
                    <div className="mt-2 flex items-center gap-2">
                      <Input
                        className="h-8 flex-1 font-mono text-xs"
                        onChange={event => setRelayDraft(event.target.value)}
                        placeholder="https://jarvis-link-relay.<you>.workers.dev"
                        spellCheck={false}
                        value={relayDraft ?? state.relay.url ?? ''}
                      />
                      <Button
                        disabled={savingRelay || relayDraft === null}
                        onClick={() => void saveRelay()}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {savingRelay && <Loader2 className="size-3.5 animate-spin" />}
                        Save
                      </Button>
                    </div>
                  }
                  description="A tiny Cloudflare Worker both sides dial out to, so your phone reaches Jarvis away from home. It forwards encrypted frames and can't read anything. Deploy it from the Jarvis 3.0 App repo (relay/) and paste its URL here."
                  title="Cloud relay"
                />
                <ListRow
                  below={
                    state.lanUrls.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {state.lanUrls.map(url => (
                          <code
                            className="rounded bg-black/25 px-1.5 py-0.5 font-mono text-[11px] text-(--ui-text-secondary)"
                            key={url}
                          >
                            {url}
                          </code>
                        ))}
                      </div>
                    ) : null
                  }
                  description={
                    state.lanPort
                      ? 'On the same Wi-Fi the phone connects straight to this Mac for the lowest latency, and falls back to the relay anywhere else.'
                      : 'The local server is not running.'
                  }
                  title={
                    <span className="flex items-center gap-2">
                      <IconWifi className="size-3.5 text-(--ui-text-tertiary)" /> Home network
                      {state.lanPort ? <Pill>port {state.lanPort}</Pill> : null}
                    </span>
                  }
                />
              </div>
            </div>
          </>
        )}
      </div>
    </SettingsContent>
  )
}
