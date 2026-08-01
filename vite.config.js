import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,   // expose on the LAN so a phone on the same Wi-Fi can connect
  },
});
