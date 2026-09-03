import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    allowedHosts: ['f1a8-136-239-226-48.ngrok-free.app', 'localhost', '127.0.0.1'],
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: ['f1a8-136-239-226-48.ngrok-free.app', 'localhost', '127.0.0.1'],
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
});
