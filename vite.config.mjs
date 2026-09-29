import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: "./",
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/files": "http://127.0.0.1:8787",
    },
    warmup: {
      clientFiles: ["./src/user-app/main.jsx", "./src/manager-app/main.jsx", "./src/admin-app/main.jsx", "./src/developer-app/main.jsx"],
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        user: resolve(__dirname, "user.html"),
        manager: resolve(__dirname, "manager.html"),
        admin: resolve(__dirname, "admin.html"),
        developer: resolve(__dirname, "developer.html"),
      },
    },
  },
  plugins: [react()],
});
