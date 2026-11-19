#!/usr/bin/env node
/**
 * 配布物に同梱する yt-dlp.exe・ffmpeg.exe・ffprobe.exe を vendor/bin に取得する（npm run desktop:build の途中で動く）。
 * すでにあれば取得しない。同梱しなくても、アプリは初回に［設定］→［ツールを準備する］で同じものを取得できる。
 * 取得元：yt-dlp 公式の GitHub Releases、ffmpeg は yt-dlp が配布する Windows 用ビルド（GPL）。
 */
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const bin = path.join(root, "vendor", "bin")
const YTDLP = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
const FFMPEG = "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"

if (process.platform !== "win32") {
  console.log("tools: Windows 以外では取得しません（配布物は Windows で作ってください）")
  process.exit(0)
}
fs.mkdirSync(bin, { recursive: true })

async function download(url, dest) {
  console.log(`tools: 取得中 ${url}`)
  const res = await fetch(url, { redirect: "follow" })
  if (!res.ok) throw new Error(`取得できませんでした（HTTP ${res.status}）：${url}`)
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
}

function find(dir, name) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      const f = find(p, name)
      if (f) return f
    } else if (e.name.toLowerCase() === name) return p
  }
  return null
}

if (!fs.existsSync(path.join(bin, "yt-dlp.exe"))) await download(YTDLP, path.join(bin, "yt-dlp.exe"))
if (!fs.existsSync(path.join(bin, "ffmpeg.exe"))) {
  const zip = path.join(bin, "ffmpeg.zip")
  const work = path.join(bin, "ffmpeg-extract")
  await download(FFMPEG, zip)
  fs.rmSync(work, { recursive: true, force: true })
  fs.mkdirSync(work)
  execFileSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe"), ["-xf", zip, "-C", work])
  for (const name of ["ffmpeg.exe", "ffprobe.exe"]) fs.copyFileSync(find(work, name), path.join(bin, name))
  fs.rmSync(work, { recursive: true, force: true })
  fs.rmSync(zip, { force: true })
}
console.log("tools: vendor/bin の準備ができました")
