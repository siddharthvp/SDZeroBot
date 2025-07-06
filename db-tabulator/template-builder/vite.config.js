import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../../webservice/public/database-report/template-builder',
    assetsDir: 'database-report/template-builder',
    emptyOutDir: true,
    // This doesn't fully work, requires a hack in the package.json build command
  }
})
