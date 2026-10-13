import { defineConfig } from 'vite'

// Safari on iOS 12 can load ES modules, but cannot parse Vite's modern default output.
export default defineConfig({ build: { target: 'es2015' } })
