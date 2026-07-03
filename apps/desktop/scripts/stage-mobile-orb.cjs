#!/usr/bin/env node
/**
 * Stages the built mobile orb page (dist-mobile-orb/, produced by
 * `vite build --config vite.mobile-orb.config.ts`) into the Jarvis iOS app
 * checkout, where Xcode bundles it as a folder resource the orb WKWebView
 * loads from file://.
 *
 * Two quirks this script exists to absorb:
 *   1. WKWebView refuses `<script type="module" crossorigin src=…>` over
 *      file:// (opaque origin → CORS failure), so the entry JS and CSS are
 *      INLINED into the html. Only url()-referenced assets (fonts) stay as
 *      files — plain resource loads are fine with loadFileURL read access.
 *   2. Copying is selective (entry html + assets/) so strays in the dist —
 *      e.g. macOS " 2" duplicates from an unclean build — never ship.
 *
 * Target resolution:
 *   1. JARVIS_MOBILE_APP_DIR env (points at the "Jarvis 3.0 App" repo root)
 *   2. a "Jarvis 3.0 App" folder next to this repo's root
 *
 * Missing target is a warning, not an error — desktop builds must not fail
 * on machines without the iOS checkout.
 */

const fs = require('node:fs')
const path = require('node:path')

const DIST = path.resolve(__dirname, '..', 'dist-mobile-orb')

function resolveTargetRepo() {
  if (process.env.JARVIS_MOBILE_APP_DIR) {
    return process.env.JARVIS_MOBILE_APP_DIR
  }

  return path.resolve(__dirname, '..', '..', '..', '..', 'Jarvis 3.0 App')
}

/** Inline the single entry JS (as a module script) and CSS into the html. */
function inlineEntry(html, assetsDir) {
  let result = html

  const scriptMatch = result.match(/<script[^>]*src="\.\/(assets\/[^"]+\.js)"[^>]*><\/script>/)

  if (scriptMatch) {
    const js = fs.readFileSync(path.join(DIST, scriptMatch[1]), 'utf8')

    result = result.replace(scriptMatch[0], () => `<script type="module">\n${js}\n</script>`)
  }

  const cssMatch = result.match(/<link[^>]*rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)"[^>]*>/)

  if (cssMatch) {
    // Font url()s inside the css resolve relative to the document now, not
    // the stylesheet — repoint assets/ so they keep working.
    const css = fs.readFileSync(path.join(DIST, cssMatch[1]), 'utf8')

    result = result.replace(cssMatch[0], () => `<style>\n${css}\n</style>`)
  }

  return result
}

function main() {
  const entryPath = path.join(DIST, 'mobile-orb.html')

  if (!fs.existsSync(entryPath)) {
    console.error('[stage-mobile-orb] dist-mobile-orb/ is missing — run the vite build first')
    process.exit(1)
  }

  const repo = resolveTargetRepo()

  if (!fs.existsSync(path.join(repo, 'ios'))) {
    console.warn(`[stage-mobile-orb] no iOS checkout at ${repo} — skipping copy (set JARVIS_MOBILE_APP_DIR to override)`)

    return
  }

  const target = path.join(repo, 'ios', 'JarvisMobile', 'Resources', 'orb')

  fs.rmSync(target, { force: true, recursive: true })
  fs.mkdirSync(path.join(target, 'assets'), { recursive: true })

  const html = inlineEntry(fs.readFileSync(entryPath, 'utf8'), path.join(DIST, 'assets'))

  fs.writeFileSync(path.join(target, 'mobile-orb.html'), html)
  fs.writeFileSync(path.join(target, 'index.html'), html)

  // Fonts and other url()-referenced files (skip the inlined entry js/css).
  for (const name of fs.readdirSync(path.join(DIST, 'assets'))) {
    if (/ \d+\./.test(name) || name.endsWith('.js') || name.endsWith('.css') || name.endsWith('.map')) {
      continue
    }

    fs.copyFileSync(path.join(DIST, 'assets', name), path.join(target, 'assets', name))
  }

  console.log(`[stage-mobile-orb] staged inlined orb bundle → ${target}`)
}

main()
