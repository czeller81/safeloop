import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: resolve(import.meta.dirname, 'src/monitor/ui'),
  build: {
    outDir: resolve(import.meta.dirname, 'dist/monitor'),
    emptyOutDir: false,
    sourcemap: false,
    rollupOptions: {
      input: resolve(import.meta.dirname, 'src/monitor/ui/index.html'),
    },
  },
});
