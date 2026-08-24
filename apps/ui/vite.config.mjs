import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import autoprefixer from 'autoprefixer'

export default defineConfig(() => {
  return {
    base: './',
    build: {
      outDir: 'build',
    },
    css: {
      postcss: {
        plugins: [
          autoprefixer({}), // add options if needed
        ],
      },
    },
    plugins: [react()],
    resolve: {
      alias: [
        {
          find: 'src/',
          replacement: `${path.resolve(__dirname, 'src')}/`,
        },
        // Lets apps/ui import a device type's ui/control and ui/simulator
        // components straight from devices/ (AGENTS.md section 7) via
        // 'devices/...' instead of a long chain of '../../../'.
        {
          find: 'devices/',
          replacement: `${path.resolve(__dirname, '../../devices')}/`,
        },
        // Extension points (AGENTS_TO_DO.md 2026-07-28) - lets
        // pluginDeviceTypes.js's import.meta.glob('plugins/*/ui/
        // register.js', ...) reach a target project's own plugins/,
        // same convention as devices/ above. Verified live (spike,
        // AGENTS_TO_DO.md) that import.meta.glob resolves through a custom
        // alias the same way a static import does.
        {
          find: 'plugins/',
          replacement: `${path.resolve(__dirname, '../../plugins')}/`,
        },
        // devices/ lives outside apps/ui's own package, so plain Node
        // resolution (walking up node_modules from the importing file)
        // would never find react there - pin it to apps/ui's own copy so
        // device-type components (which only ever get imported by apps/ui)
        // share the exact same React instance rather than resolution
        // failing outright.
        {
          find: /^react$/,
          replacement: path.resolve(__dirname, 'node_modules/react'),
        },
        {
          find: /^react\//,
          replacement: `${path.resolve(__dirname, 'node_modules/react')}/`,
        },
        // Same reasoning as react above, surfaced by the FIRST real
        // plugins/*/ui/register.js consumer (AGENTS.md section 71) - a
        // static `import X from 'devices/...'` in a file that already
        // lives inside apps/ui's own package (e.g. builtinDeviceTypes.js)
        // resolves @coreui/* fine, but a glob-discovered plugin file
        // living entirely outside apps/ui's own package (plugins/ or
        // devices/'s own ui/control/ui/simulator components, imported
        // only via that glob) has no node_modules of its own to walk up
        // to - confirmed empirically (@coreui/react/@coreui/icons/
        // @coreui/icons-react only exist as symlinks under apps/ui's own
        // node_modules, never hoisted to the workspace root).
        {
          find: /^@coreui\/react$/,
          replacement: path.resolve(__dirname, 'node_modules/@coreui/react'),
        },
        {
          find: /^@coreui\/icons-react$/,
          replacement: path.resolve(__dirname, 'node_modules/@coreui/icons-react'),
        },
        {
          find: /^@coreui\/icons$/,
          replacement: path.resolve(__dirname, 'node_modules/@coreui/icons'),
        },
      ],
      extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json', '.scss'],
    },
    server: {
      port: 3000,
      proxy: {
        // Mirrors nginx.conf.template's /api reverse proxy, for local
        // `pnpm dev` (not the containerized workflow, which always goes
        // through nginx) - see apps/ui/src/api/client.js.
        '/api': {
          target: `http://localhost:${process.env.API_PORT ?? 3001}`,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
        // Mirrors nginx.conf.template's /ws reverse proxy, for local
        // `pnpm dev` - see apps/ui/src/api/liveSocket.js.
        '/ws': {
          target: `http://localhost:${process.env.MESSAGING_GATEWAY_PORT ?? 3030}`,
          ws: true,
        },
      },
    },
  }
})
