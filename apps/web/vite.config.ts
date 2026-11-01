import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The BFF from Plan 1 listens on 8787 and allows the 5173 origin (R40).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 5173,
    strictPort: true,
  },
});
