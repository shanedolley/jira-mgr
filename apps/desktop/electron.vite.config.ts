import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

const main = (name: string) => fileURLToPath(new URL(`src/main/${name}.ts`, import.meta.url))

// dependencies stay external in main and preload; devDependencies, including
// @jira-mgr/core, are bundled. `e2e` is the entry the Playwright tests launch.
// The entries are listed under `lib` because electron-vite with Vite 8 loses its CommonJS
// and `electron` external settings when `rollupOptions.input` is set.
export default defineConfig({
  main: {
    build: { lib: { entry: { index: main('index'), e2e: main('e2e') }, formats: ['cjs'] } },
  },
  preload: {},
  renderer: {
    plugins: [react(), tailwindcss()],
  },
})
