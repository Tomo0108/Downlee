import path from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  // Electron から file:// で読み込むため相対パスで出力する
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  // RakuManual は 5180、Rakuform は 5190 を使うため、Downlee は 5200 に固定して衝突を避ける
  server: { port: 5200, strictPort: true },
})
