import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {rollupOptions: {output: {assetFileNames: asset => asset.names.some(name => name.endsWith('eng.traineddata.gz')) ? 'assets/receipt-ocr/eng.traineddata.gz' : 'assets/[name]-[hash][extname]'}}},
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
