#!/usr/bin/env node
/**
 * assets/fonts → public/fonts へ同期（Rakuform・RakuManual の scripts/sync-fonts.mjs と同じ方式）。
 * Segoe UI・BIZ UDゴシックは Rakuform の assets/fonts/qg から写したもの。Microsoft などのフォントで再配布の条件があるため Git 管理外。
 * 置いていない場合は OS のフォント（Windows 標準）→ 代替フォントの順で表示する。
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const srcDir = path.join(root, "assets", "fonts")
const destDir = path.join(root, "public", "fonts")

if (!fs.existsSync(srcDir)) process.exit(0)
fs.mkdirSync(destDir, { recursive: true })
for (const name of fs.readdirSync(srcDir)) {
  if (!/\.(ttf|ttc|otf)$/i.test(name)) continue
  const from = path.join(srcDir, name)
  const to = path.join(destDir, name)
  if (fs.existsSync(to) && fs.statSync(to).size === fs.statSync(from).size) continue
  fs.copyFileSync(from, to)
  console.log(`fonts: synced ${name}`)
}
