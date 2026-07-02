import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// Separate build pass for notch-orb.html — the small page the native notch
// companion's web views load (served from dist by electron/notch.cjs when no
// Vite dev server is running; see stage-notch.cjs / package.json's build
// script for where this runs).
//
// Why not just add it to vite.config.ts's input list: rolldown's
// `output.codeSplitting: false` (required there — see that file's comment on
// why the main app ships as one big chunk) rejects multiple entry points
// outright ("multiple inputs are not supported when codeSplitting is
// false"). notch-orb.html doesn't need — and at its size wouldn't benefit
// from — that single-chunk treatment, so it gets its own tiny build instead
// of relaxing a constraint that matters for the real app bundle.
export default defineConfig({
  base: './',
  build: {
    // Emit into the SAME dist/ the main build fills (electron/notch.cjs
    // serves both from one directory). Not clearing it is what makes running
    // this as a second step, after `vite build`, safe.
    emptyOutDir: false,
    rollupOptions: {
      input: path.resolve(__dirname, 'notch-orb.html')
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
