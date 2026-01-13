import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { defineConfig } from 'vite'
import tsConfigPaths from 'vite-tsconfig-paths'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'
export default defineConfig({
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      'react-reconciler/constants': 'react-reconciler/constants.js',
    },
  },
  ssr: {
    noExternal: ['pixi.js'],
    external: ['@pixi/react'],
  },
  optimizeDeps: {
    include: ['pixi.js', '@pixi/react', 'react-reconciler'],
  },
  plugins: [
    tailwindcss(),
    tsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    tanstackStart({
      srcDirectory: 'src',
    }),
    viteReact(),
    nitro(),
  ],
})
