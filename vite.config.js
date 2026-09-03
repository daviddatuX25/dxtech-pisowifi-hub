import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    allowedHosts: ['.ngrok-free.app', 'f1a8-136-239-226-48.ngrok-free.app'],
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: ['.ngrok-free.app', 'f1a8-136-239-226-48.ngrok-free.app'],
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
});
