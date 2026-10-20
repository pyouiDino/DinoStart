/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Build compatible extension Chrome : chemins relatifs, aucune ressource distante,
// pas de script inline (CSP MV3). Le dossier `dist` se charge via
// chrome://extensions → « Charger l'extension non empaquetée ».
export default defineConfig({
  base: './',
  plugins: [react()],
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    modulePreload: { polyfill: false },
    rollupOptions: {
      // Deux points d'entrée : la page (newtab.html) et le service worker de la version « page d'accueil » (nom fixe).
      input: { newtab: resolve(__dirname, 'newtab.html'), background: resolve(__dirname, 'src/background/index.ts') },
      output: { entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js') },
    },
  },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
    restoreMocks: true,
  },
});
