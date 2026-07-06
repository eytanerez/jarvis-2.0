import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DesktopMobileState } from '@/global'

import { MobileSettings } from './mobile-settings'

vi.mock('@/lib/haptics', () => ({
  triggerHaptic: vi.fn()
}))

vi.mock('@/store/notifications', () => ({
  notify: vi.fn(),
  notifyError: vi.fn()
}))

const mobileState: DesktopMobileState = {
  devices: [],
  enabled: true,
  hostId: 'host-1234567890abcdef',
  hostName: 'Test Mac',
  lanPort: 8776,
  lanUrls: ['ws://127.0.0.1:8776/link'],
  relay: { connected: true, url: 'https://relay.example.workers.dev' }
}

function installMobileBridge(overrides: Partial<NonNullable<Window['jarvisDesktop']['mobile']>> = {}) {
  const mobile = {
    enable: vi.fn(),
    getState: vi.fn().mockResolvedValue(mobileState),
    onState: vi.fn(() => () => {}),
    pair: vi.fn(),
    revoke: vi.fn(),
    setRelayUrl: vi.fn(),
    testRelay: vi.fn().mockResolvedValue({ durationMs: 42, ok: true, relayUrl: mobileState.relay.url }),
    ...overrides
  }

  Object.defineProperty(window, 'jarvisDesktop', {
    configurable: true,
    value: { mobile }
  })

  return mobile
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  Object.defineProperty(window, 'jarvisDesktop', {
    configurable: true,
    value: undefined
  })
})

describe('MobileSettings', () => {
  it('runs the relay self-test from the linked devices relay row', async () => {
    const mobile = installMobileBridge()

    render(<MobileSettings />)

    const testButton = await screen.findByRole('button', { name: /test/i })

    fireEvent.click(testButton)

    await waitFor(() => expect(mobile.testRelay).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(/Round-trip verified in 42 ms/i)).toBeTruthy()
  })

  it('shows relay self-test failures returned by the bridge', async () => {
    installMobileBridge({
      testRelay: vi.fn().mockResolvedValue({ code: 'timeout', error: 'Timed out waiting for the relay round-trip.', ok: false })
    })

    render(<MobileSettings />)

    fireEvent.click(await screen.findByRole('button', { name: /test/i }))

    expect(await screen.findByText('Timed out waiting for the relay round-trip.')).toBeTruthy()
  })
})
