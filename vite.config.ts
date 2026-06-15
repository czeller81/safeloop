import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: resolve(__dirname, 'src/monitor/ui'),
  build: {
    outDir: resolve(__dirname, 'dist/monitor'),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: resolve(__dirname, 'src/monitor/ui/index.html'),
    },
  },
});
