/**
 * Envelope crypto for the mobile link (phone ⇄ desktop bridge).
 *
 * Every frame between a linked iPhone and this app — over the LAN socket or
 * the cloud relay alike — is one JSON text frame:
 *
 *   {"v":1, "k":"dev:<deviceId>"|"pair:<pairingId>", "n":"<b64url nonce>", "c":"<b64url ciphertext>"}
 *
 * `c` is AES-256-GCM over the inner frame `{"seq":N,"type":"...","body":{...}}`
 * with the 32-byte link key that only ever travels inside a pairing QR code.
 * The plaintext `k` header just selects which key to try; authenticity comes
 * from GCM, and `k` is bound into the AAD so a frame can't be replayed under a
 * different identity. `seq` is per-direction monotonic within a connection —
 * receivers must reject non-increasing values (replay guard).
 *
 * The Swift app implements the exact same construction with CryptoKit;
 * `generateTestVectors()` feeds the shared interop fixtures both test suites
 * assert against. Change nothing here without regenerating those vectors.
 */

const crypto = require('node:crypto')

const ENVELOPE_VERSION = 1
const AAD_PREFIX = 'jl1|'
const NONCE_BYTES = 12
const KEY_BYTES = 32
const GCM_TAG_BYTES = 16

function b64url(buffer) {
  return Buffer.from(buffer).toString('base64url')
}

function fromB64url(text) {
  return Buffer.from(String(text), 'base64url')
}

function generateLinkKey() {
  return crypto.randomBytes(KEY_BYTES)
}

function generateId(bytes = 16) {
  return crypto.randomBytes(bytes).toString('base64url')
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

/** Seal an inner frame into an envelope string. */
function sealEnvelope(key, keyId, seq, type, body = {}) {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) {
    throw new Error('link key must be 32 bytes')
  }

  const nonce = crypto.randomBytes(NONCE_BYTES)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(Buffer.from(AAD_PREFIX + keyId, 'utf8'))

  const plaintext = Buffer.from(JSON.stringify({ body, seq, type }), 'utf8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])

  return JSON.stringify({ c: b64url(ciphertext), k: keyId, n: b64url(nonce), v: ENVELOPE_VERSION })
}

/** Parse just the plaintext header of an envelope (to pick the key). */
function peekEnvelope(text) {
  let outer = null
  try {
    outer = JSON.parse(String(text))
  } catch {
    return null
  }

  if (!outer || outer.v !== ENVELOPE_VERSION || typeof outer.k !== 'string') {
    return null
  }

  if (typeof outer.n !== 'string' || typeof outer.c !== 'string') {
    return null
  }

  return outer
}

/**
 * Open an envelope with the given key. Throws on any tamper/format problem.
 * Returns `{ keyId, seq, type, body }`.
 */
function openEnvelope(key, text) {
  const outer = peekEnvelope(text)

  if (!outer) {
    throw new Error('malformed envelope')
  }

  const nonce = fromB64url(outer.n)
  const payload = fromB64url(outer.c)

  if (nonce.length !== NONCE_BYTES || payload.length <= GCM_TAG_BYTES) {
    throw new Error('malformed envelope')
  }

  const ciphertext = payload.subarray(0, payload.length - GCM_TAG_BYTES)
  const tag = payload.subarray(payload.length - GCM_TAG_BYTES)

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce)
  decipher.setAAD(Buffer.from(AAD_PREFIX + outer.k, 'utf8'))
  decipher.setAuthTag(tag)

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  const inner = JSON.parse(plaintext.toString('utf8'))

  if (typeof inner.seq !== 'number' || typeof inner.type !== 'string') {
    throw new Error('malformed inner frame')
  }

  return { body: inner.body ?? {}, keyId: outer.k, seq: inner.seq, type: inner.type }
}

/**
 * The QR payload shown by Settings → Linked Devices. The link key rides in
 * here and nowhere else — the QR is scanned camera-to-camera, so the relay
 * never learns it.
 */
function buildPairingUrl({ expiresAt, hostId, hostName, lanUrls, linkKey, pairingId, relayUrl }) {
  const payload = {
    exp: expiresAt,
    host: hostId,
    key: b64url(linkKey),
    lan: lanUrls,
    name: hostName,
    pair: pairingId,
    relay: relayUrl || null,
    v: 1
  }

  return `jarvis-link://v1?d=${b64url(Buffer.from(JSON.stringify(payload), 'utf8'))}`
}

function parsePairingUrl(url) {
  const match = /^jarvis-link:\/\/v1\?d=([A-Za-z0-9_-]+)$/.exec(String(url))

  if (!match) {
    return null
  }

  try {
    const payload = JSON.parse(fromB64url(match[1]).toString('utf8'))

    return payload && payload.v === 1 ? payload : null
  } catch {
    return null
  }
}

/**
 * Deterministic-format fixtures for the Swift test suite. Random nonces/keys
 * are generated fresh but embedded alongside the expected envelope, so the
 * Swift side proves it can OPEN what Node SEALED (and vice versa via the
 * roundtrip fields).
 */
function generateTestVectors(count = 4) {
  const vectors = []

  for (let index = 0; index < count; index++) {
    const key = generateLinkKey()
    const keyId = index % 2 === 0 ? `dev:${generateId(9)}` : `pair:${generateId(9)}`
    const seq = index + 1
    const type = ['hello', 'rpc', 'http', 'ping'][index % 4]
    const body = { index, note: 'interop-vector', text: 'orb ✨ 顶级' }

    vectors.push({
      envelope: sealEnvelope(key, keyId, seq, type, body),
      expected: { body, keyId, seq, type },
      key: b64url(key)
    })
  }

  return vectors
}

module.exports = {
  AAD_PREFIX,
  ENVELOPE_VERSION,
  KEY_BYTES,
  NONCE_BYTES,
  b64url,
  buildPairingUrl,
  fromB64url,
  generateId,
  generateLinkKey,
  generateTestVectors,
  openEnvelope,
  parsePairingUrl,
  peekEnvelope,
  sealEnvelope,
  sha256Hex
}
