import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// Separate build pass for mobile-orb.html — the orb page the Jarvis iOS app
// bundles into its resources and loads in a WKWebView (file:// URL). Same
// single-entry rationale as vite.notch-orb.config.ts; unlike that one it
// emits into its own dist-mobile-orb/ directory because the output leaves
// this repo entirely (scripts/stage-mobile-orb.cjs copies it into the
// Jarvis 3.0 App checkout's ios resources).
export default defineConfig({
  base: './',
  build: {
    emptyOutDir: true,
    outDir: 'dist-mobile-orb',
    rollupOptions: {
      input: path.resolve(__dirname, 'mobile-orb.html')
    }
  },
  plugins: [react(), tailwindcss()],
  css: {
    // Same rationale as vite.config.ts: pin an empty PostCSS config so a
    // stray Tailwind v3 config higher in the user's home tree can't hijack
    // this v4 stylesheet.
    postcss: { plugins: [] }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@jarvis/shared': path.resolve(__dirname, '../shared/src'),
      react: path.resolve(__dirname, '../../node_modules/react'),
      'react-dom': path.resolve(__dirname, '../../node_modules/react-dom'),
      'react/jsx-dev-runtime': path.resolve(__dirname, '../../node_modules/react/jsx-dev-runtime.js'),
      'react/jsx-runtime': path.resolve(__dirname, '../../node_modules/react/jsx-runtime.js')
    },
    dedupe: ['react', 'react-dom']
  }
})
