import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // `vite preview` (producción en Dokploy) debe aceptar el dominio público.
  preview: {
    host: true,
    allowedHosts: true,
  },
});
