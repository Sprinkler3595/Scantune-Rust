import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri attend un serveur de dev sur un port fixe.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  // Empêche Vite d'obscurcir les erreurs Rust.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: {
      // Ne pas surveiller les sources Rust.
      ignored: ["**/src-tauri/**"],
    },
  },
});
