import { defineConfig } from 'tsup'

// devDependencies, which includes @jira-mgr/core, are bundled into the binary.
export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  target: 'node24',
  clean: true,
})
