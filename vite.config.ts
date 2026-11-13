import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import type {Connect} from 'vite'
import {defineConfig} from 'vitest/config'
import react from '@vitejs/plugin-react'
import {blobLines, chipData, fieldText, fillMarkers, panelItems} from './src/landing/demoHtml'

// Two pages: "/" is the static landing (no app bundle, no WebGPU code), "/app/" is the app.
// Cloudflare Pages serves /app as /app/ on its own; the dev and preview servers get the same here.
const appWithoutSlash: Connect.NextHandleFunction = (request, response, next) => {
  const [path, query] = (request.url ?? '').split('?')
  if (path !== '/app') return next()
  response.statusCode = 308
  response.setHeader('Location', `/app/${query === undefined ? '' : `?${query}`}`)
  response.end()
}

// The landing's code lines come from the real demo files (public/demo/) and are written into its HTML at
// build time, so they are on the page before any script runs.
const demoLines = (name: string) => blobLines(readFileSync(resolve(import.meta.dirname, 'public/demo', name), 'utf8'))
function landingMarkers(): Record<string, string> {
  const final = demoLines('stage-08000.txt')
  return {
    panel: panelItems(final, 14),
    field: fieldText(final, 56, 7),
    chips: chipData(final, 12),
  }
}

export default defineConfig({
  plugins: [
    react(),
    {
      // The fonts are served with the site, so their OFL licences are too: /licenses/*.txt.
      name: 'font-licences',
      generateBundle() {
        for (const name of ['JetBrainsMono-OFL.txt', 'SpaceGrotesk-OFL.txt']) {
          const source = readFileSync(resolve(import.meta.dirname, 'src/assets/fonts', name), 'utf8')
          this.emitFile({type: 'asset', fileName: `licenses/${name}`, source})
        }
      },
    },
    {
      name: 'landing-demo-html',
      transformIndexHtml: {
        order: 'pre',
        handler: (html, context) =>
          resolve(context.filename) === resolve(import.meta.dirname, 'index.html') ? fillMarkers(html, landingMarkers()) : html,
      },
    },
    {
      name: 'app-without-slash',
      configureServer: (server) => void server.middlewares.use(appWithoutSlash),
      configurePreviewServer: (server) => void server.middlewares.use(appWithoutSlash),
    },
  ],
  appType: 'mpa',
  build: {
    rollupOptions: {
      input: {
        landing: resolve(import.meta.dirname, 'index.html'),
        app: resolve(import.meta.dirname, 'app/index.html'),
        notFound: resolve(import.meta.dirname, '404.html'),
      },
    },
  },
  test: {environment: 'node', include: ['src/**/*.test.ts']},
})
