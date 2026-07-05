/**
 * after-pack.cjs — electron-builder afterPack hook.
 *
 * macOS: strips extended attributes from the freshly staged bundle right
 * before electron-builder signs it. This repo lives under ~/Documents, which
 * iCloud Drive syncs — fileproviderd tags new files with com.apple.FinderInfo
 * / com.apple.fileprovider.fpfs#P while the build is still running, and
 * codesign then fails the pack with "resource fork, Finder information, or
 * similar detritus not allowed" (the intermittent desktop-rebuild failure
 * previously misdiagnosed as a blocked Electron download). Primary defense is
 * apps/desktop/release being a symlink to ~/.jarvis/desktop-release (outside
 * iCloud's reach); this strip covers checkouts where release/ is a real dir.
 *
 * Windows: stamps the Jarvis icon + identity onto the packed Jarvis.exe via
 * rcedit (delegated to set-exe-identity.cjs). This runs for EVERY packed build
 * — first install, `jarvis desktop`, the installer's --update rebuild, and a
 * dev's manual `npm run pack` — so the branded exe can never silently revert
 * to the stock "Electron" icon/name (the bug when the stamp lived only in
 * install.ps1, which the update path doesn't use).
 *
 * Best-effort throughout: a stamp/strip failure must never fail an
 * otherwise-good build, so we log and resolve rather than throw.
 *
 * electron-builder passes a context with:
 *   - electronPlatformName: 'win32' | 'darwin' | 'linux'
 *   - appOutDir:            the unpacked app directory for this target
 *   - packager.appInfo.productFilename: the exe basename (e.g. 'Jarvis')
 */

const { execFileSync } = require('node:child_process')
const path = require('node:path')

const { stampExeIdentity } = require('./set-exe-identity.cjs')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName === 'darwin') {
    try {
      execFileSync('/usr/bin/xattr', ['-cr', context.appOutDir], { stdio: 'pipe' })
      console.log(`[after-pack] stripped extended attributes from ${context.appOutDir} (iCloud fileproviderd detritus breaks codesign)`)
    } catch (err) {
      console.warn(`[after-pack] xattr strip failed (${err.message}); codesign may reject the bundle if iCloud tagged it mid-build`)
    }

    return
  }

  if (context.electronPlatformName !== 'win32') {
    return
  }

  const productName = context.packager?.appInfo?.productFilename || 'Jarvis'
  const exe = path.join(context.appOutDir, `${productName}.exe`)
  const desktopRoot = path.resolve(__dirname, '..')

  try {
    await stampExeIdentity(exe, desktopRoot)
  } catch (err) {
    // Never fail the build over a cosmetic stamp.
    console.warn(`[after-pack] exe identity stamp failed (${err.message}); Jarvis.exe keeps the stock Electron icon`)
  }
}
