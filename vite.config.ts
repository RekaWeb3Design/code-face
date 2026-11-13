import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import type {Connect} from 'vite'
import {defineConfig} from 'vitest/config'
import react from '@vitejs/plugin-react'

// Two pages: "/" is the static landing (no app bundle, no WebGPU code), "/app/" is the app.
// Cloudflare Pages serves /app as /app/ on its own; the dev and preview servers get the same here.
const appWithoutSlash: Connect.NextHandleFunction = (request, response, next) => {
  const [path, query] = (request.url ?? '').split('?')
  if (path !== '/app') return next()
  response.statusCode = 308
  response.setHeader('Location', `/app/${query === undefined ? '' : `?${query}`}`)
  response.end()
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
