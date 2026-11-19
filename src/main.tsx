import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import App from "./App"
import "./index.css"
import { applyTheme, readThemePreference, resolveTheme, systemPrefersDark } from "./lib/theme"

// 主軸の色はアイコンの紫〜青（index.css の violet）
document.documentElement.dataset.accent = "violet"

// 配色（ライト／ダーク）は描画前に決めて、起動時のちらつきを防ぐ
applyTheme(resolveTheme(readThemePreference(), systemPrefersDark()))

// 文字は Rakuform・RakuManual と同じ：英数字は Segoe UI、日本語は BIZ UDゴシック。
// OS に入っているもの → assets/fonts から同期したファイル（public/fonts）の順で使う
const fontBase = `${import.meta.env.BASE_URL}fonts/`
const faces: [string, number, string[], string][] = [
  ["Segoe UI", 400, ["Segoe UI"], "segoeui.ttf"],
  ["Segoe UI", 600, ["Segoe UI Semibold"], "seguisb.ttf"],
  ["Segoe UI", 700, ["Segoe UI Bold"], "segoeuib.ttf"],
  ["BIZ UDGothic", 400, ["BIZ UDGothic", "BIZ UDゴシック"], "BIZ-UDGothicR.ttc"],
  ["BIZ UDGothic", 700, ["BIZ UDGothic Bold", "BIZ UDゴシック Bold"], "BIZ-UDGothicB.ttc"],
]
const fontStyle = document.createElement("style")
fontStyle.textContent = faces
  .map(([family, weight, locals, file]) => `@font-face{font-family:"${family}";font-weight:${weight};font-display:swap;src:${locals.map((l) => `local("${l}")`).join(",")},url("${fontBase}${file}")}`)
  .join("")
document.head.appendChild(fontStyle)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
