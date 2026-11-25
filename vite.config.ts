import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // Rapier (compat) embarque son module WebAssembly en base64 : le bundle est volontairement gros.
    chunkSizeWarningLimit: 6000,
  },
  server: {
    open: false,
  },
});
