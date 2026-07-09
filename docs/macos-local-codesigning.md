# macOS Local Code Signing (Self-Update Permission Stability)

Fixes a specific symptom: after every desktop app self-update, macOS forgets
every permission grant (Accessibility, Microphone, etc.) and the app has to
re-request all of them.

## Why this happens

Self-update (`jarvis desktop --build-only`, triggered from the running
desktop app's update flow — see `apps/desktop/electron/main.cjs`'s
`applyUpdatesPosixInApp`) rebuilds the app *locally* via
`npm run pack` → electron-builder, then swaps the freshly built `.app` bundle
into place and relaunches it. That automated rebuild has no code-signing
certificate available to it by default, so electron-builder falls back to
**ad-hoc signing** (`codesign --sign -`), confirmed in
`_desktop_macos_relaunchable_fixup`'s docstring in `jarvis_cli/main.py`.

An ad-hoc signature is a hash of the current binary content — every rebuild
produces a different one, with no stable identity behind it. macOS's
permission system (TCC) keys grants to the app's code-signing identity, so
each self-update looks like a brand-new, never-approved app.

There's a pre-existing fixup (`_desktop_macos_relaunchable_fixup`) that
re-applies a *clean* ad-hoc signature after each rebuild — but that only
solves a different, narrower symptom (the rebuilt app refusing to launch at
all, "Jarvis is damaged"). It can't fix permission persistence, because the
root cause (no stable identity) is exactly what it works around, not what it
fixes.

## The fix: a stable local identity

The correct fix is a **Developer ID Application** certificate — the kind
`hardenedRuntime`/notarization in `apps/desktop/package.json`'s build config
already assumes exists — but that requires a paid Apple Developer Program
membership ($99/year).

For a single-user, self-hosted install that never leaves this Mac (never
distributed to anyone else), a **self-signed code-signing certificate**
solves the same problem for free: a certificate you generate and trust only
on your own machine, giving every rebuild the same certificate-backed
identity instead of a content-hash-based one. macOS's Designated Requirement
for a self-signed-cert-signed app is anchored to the certificate's leaf hash,
not the binary content — so it stays identical across rebuilds, and TCC
recognizes the app as unchanged.

Trade-off: this certificate is **not** notarizable (that requires an
Apple-issued cert) and is only trusted on the machine it was created on. Both
are fine for this use case — the app is never distributed, and the self-update
swap script already clears the quarantine flag on every swap
(`xattr -dr com.apple.quarantine`), so Gatekeeper's unidentified-developer
warning never triggers here.

## What was set up (2026-07-09)

```bash
# 1. Generate a self-signed cert with the Code Signing EKU.
cat > codesign-cert.conf <<'EOF'
[req]
distinguished_name = req_distinguished_name
x509_extensions = v3_req
prompt = no

[req_distinguished_name]
CN = Jarvis Local Code Signing

[v3_req]
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
basicConstraints = critical, CA:false
EOF
openssl req -x509 -newkey rsa:2048 -sha256 \
  -keyout jarvis-codesign.key -out jarvis-codesign.crt \
  -days 3650 -nodes -config codesign-cert.conf -extensions v3_req

# 2. Import into the login keychain. -T grants codesign access to the key.
security import jarvis-codesign.key -k ~/Library/Keychains/login.keychain-db -T /usr/bin/codesign
security import jarvis-codesign.crt -k ~/Library/Keychains/login.keychain-db

# 3. Trust it specifically for code signing (prompts for your login password).
security add-trusted-cert -r trustRoot -p codeSign -k ~/Library/Keychains/login.keychain-db jarvis-codesign.crt

# 4. -T at import time isn't always sufficient on modern macOS — this is the
#    step that actually stops codesign from prompting/hanging on every use.
#    Run this yourself; it needs your keychain password via a normal system
#    prompt (never type it into a script or hand it to an agent).
security set-key-partition-list -S apple-tool:,apple:,codesign: -s ~/Library/Keychains/login.keychain-db
```

The private key + cert files were deleted after import — only the keychain
copy exists. `security find-identity -v -p codesigning` should list
`"Jarvis Local Code Signing"` alongside any other identities.

## Where it's wired in

`jarvis_cli/main.py`'s `cmd_gui` (the handler for both `jarvis gui` and
`jarvis desktop --build-only`) sets `CSC_NAME` and `APPLE_SIGNING_IDENTITY`
to `DESKTOP_LOCAL_CODESIGN_IDENTITY` ("Jarvis Local Code Signing") in the
build subprocess's environment, *unless* `CSC_LINK` or
`APPLE_SIGNING_IDENTITY` is already set — so this never overrides a real
signing setup (e.g. if this Mac later gets a paid Developer ID certificate).
`CSC_NAME` is electron-builder's mechanism for "look up this identity by name
in the keychain"; `APPLE_SIGNING_IDENTITY` also satisfies
`_desktop_macos_relaunchable_fixup`'s own check to skip itself when a real
identity is configured, so it stops stripping the signature we just applied.

This one injection point covers both the Electron-triggered self-update path
(`main.cjs` spawns `jarvis desktop --build-only`, which runs this exact
function) and a manual `jarvis desktop --build-only`/`jarvis gui` from a
terminal.

## Moving to a new Mac / regenerating

Repeat the four `security` commands above with a fresh key/cert (or export
and re-import the existing one via `security export`/`security import` with
a `.p12`). The identity name (`Jarvis Local Code Signing`) must match
`DESKTOP_LOCAL_CODESIGN_IDENTITY` in `jarvis_cli/main.py` — if you use a
different name, update that constant too.

## Verifying it worked

```bash
codesign -d -r- /Applications/Jarvis.app   # should show a "certificate leaf" requirement, not "designated => anchor apple ..." or an ad-hoc-only marker
```

The real test: grant a permission (e.g. Accessibility) in System Settings,
trigger a self-update, and confirm the app still has that permission
afterward instead of macOS asking again.
