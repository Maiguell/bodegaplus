import { defineConfig } from 'vite';

export default defineConfig({
  // Servidor de desarrollo
  server: {
    port: 5173,
    open: true,   // Abre el navegador automáticamente
    // Proxy para evitar CORS en desarrollo: redirige /api → backend Express
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  // Configuración de build
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
