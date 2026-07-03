/**
 * Persistence for the mobile link: host identity + linked-device registry.
 *
 * Two files under the Jarvis home (default ~/.jarvis), both 0600 and written
 * atomically (tmp + rename):
 *
 *   mobile-link.json     { hostId, hostKey, relayUrl, enabled, lanPort }
 *   mobile-devices.json  { devices: [{ id, name, model, keyB64, tokenHash,
 *                          createdAt, lastSeenAt, revokedAt }] }
 *
 * hostKey authenticates this Mac to its relay Durable Object; a device's
 * keyB64 is the AES-256-GCM link key from its pairing QR; tokenHash is
 * sha256(deviceToken) — the raw token lives only in the phone's Keychain, so
 * this file alone can't impersonate a device.
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { generateId, sha256Hex } = require('./mobile-link-crypto.cjs')

const LINK_FILE = 'mobile-link.json'
const DEVICES_FILE = 'mobile-devices.json'

function defaultJarvisHome(env = process.env) {
  return env.JARVIS_HOME || path.join(os.homedir(), '.jarvis')
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })

  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`

  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(tmp, file)
}

function createMobileLinkStore({ dir = defaultJarvisHome(), log = () => {} } = {}) {
  const linkPath = path.join(dir, LINK_FILE)
  const devicesPath = path.join(dir, DEVICES_FILE)

  function readLink() {
    const raw = readJson(linkPath)

    return raw && typeof raw === 'object' ? raw : {}
  }

  function readDevices() {
    const raw = readJson(devicesPath)
    const devices = raw && Array.isArray(raw.devices) ? raw.devices : []

    return devices.filter(device => device && typeof device.id === 'string')
  }

  function writeDevices(devices) {
    writeJsonAtomic(devicesPath, { devices })
  }

  return {
    /** Host identity is minted once and survives app reinstalls. */
    ensureIdentity() {
      const link = readLink()

      if (typeof link.hostId === 'string' && link.hostId.length >= 16 && typeof link.hostKey === 'string') {
        return link
      }

      const created = {
        ...link,
        hostId: generateId(16),
        hostKey: generateId(32)
      }

      writeJsonAtomic(linkPath, created)
      log('[mobile] minted host identity')

      return created
    },

    getConfig() {
      return readLink()
    },

    setConfig(patch) {
      const next = { ...readLink(), ...patch }

      writeJsonAtomic(linkPath, next)

      return next
    },

    listDevices() {
      return readDevices()
    },

    getDevice(id) {
      return readDevices().find(device => device.id === id) ?? null
    },

    addDevice({ keyB64, model = '', name = 'iPhone' }) {
      const devices = readDevices()
      const token = generateId(32)
      const device = {
        createdAt: new Date().toISOString(),
        id: generateId(9),
        keyB64,
        lastSeenAt: null,
        model,
        name,
        revokedAt: null,
        tokenHash: sha256Hex(token)
      }

      devices.push(device)
      writeDevices(devices)

      // The raw token is returned exactly once, for the pair.ok reply.
      return { device, token }
    },

    verifyDeviceToken(id, token) {
      const device = this.getDevice(id)

      if (!device || device.revokedAt || typeof token !== 'string' || !token) {
        return false
      }

      return device.tokenHash === sha256Hex(token)
    },

    touchDevice(id) {
      const devices = readDevices()
      const device = devices.find(entry => entry.id === id)

      if (!device) {
        return
      }

      device.lastSeenAt = new Date().toISOString()
      writeDevices(devices)
    },

    revokeDevice(id) {
      const devices = readDevices()
      const device = devices.find(entry => entry.id === id)

      if (!device || device.revokedAt) {
        return false
      }

      device.revokedAt = new Date().toISOString()
      writeDevices(devices)

      return true
    },

    removeDevice(id) {
      const devices = readDevices()
      const next = devices.filter(entry => entry.id !== id)

      if (next.length === devices.length) {
        return false
      }

      writeDevices(next)

      return true
    }
  }
}

module.exports = { createMobileLinkStore, defaultJarvisHome }
