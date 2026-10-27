import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "https://storycast-web.aguzz.workers.dev", changeOrigin: true },
      "/s": { target: "https://storycast-web.aguzz.workers.dev", changeOrigin: true },
      "/m": { target: "https://storycast-web.aguzz.workers.dev", changeOrigin: true },
    },
  },
  // Hidden sourcemaps: only devtools fetches them, and only to un-minify
  // production stack traces when something crashes.
  build: { sourcemap: "hidden" },
})
