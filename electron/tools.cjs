/**
 * yt-dlp と ffmpeg の場所・準備・更新。
 * Windows では %APPDATA%\Downlee\bin に置く（yt-dlp -U で自分を更新できるよう、書き込める場所にする）。
 * 配布物に同梱した分（resources\bin）があれば最初にそこから写し、なければ公式の配布元から取得する。
 */
const fs = require("node:fs")
const path = require("node:path")
const { spawn, execFile } = require("node:child_process")

const IS_WIN = process.platform === "win32"
const EXE = IS_WIN ? ".exe" : ""
const SOURCES = {
  ytdlp: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe",
  ffmpeg: "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip",
}

function createTools({ userData, resourcesBin, fetchImpl }) {
  const bin = path.join(userData, "bin")
  const local = (name) => path.join(bin, name + EXE)
  const bundled = (name) => (resourcesBin ? path.join(resourcesBin, name + EXE) : null)
  let installing = null

  /** PATH から探す（開発時・Windows 以外） */
  function which(name) {
    const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean)
    for (const d of dirs) {
      const p = path.join(d, name + EXE)
      try {
        if (fs.statSync(p).isFile()) return p
      } catch { /* 次へ */ }
    }
    return null
  }

  function resolve(name) {
    if (fs.existsSync(local(name))) return local(name)
    const b = bundled(name)
    if (b && fs.existsSync(b)) {
      try {
        fs.mkdirSync(bin, { recursive: true })
        fs.copyFileSync(b, local(name))
        return local(name)
      } catch {
        return b
      }
    }
    return which(name)
  }

  const paths = () => ({ ytdlp: resolve("yt-dlp"), ffmpeg: resolve("ffmpeg"), ffprobe: resolve("ffprobe") })

  function version(file, args) {
    return new Promise((res) => {
      if (!file) return res(null)
      execFile(file, args, { windowsHide: true, timeout: 20000 }, (err, stdout) => {
        if (err) return res(null)
        const text = String(stdout).trim()
        res(args[0] === "-version" ? (/version\s+(\S+)/.exec(text)?.[1] ?? text.split("\n")[0]) : text.split("\n")[0])
      })
    })
  }

  async function status() {
    const p = paths()
    const [yv, fv] = await Promise.all([version(p.ytdlp, ["--version"]), version(p.ffmpeg, ["-version"])])
    return {
      ytdlp: { path: p.ytdlp, version: yv, managed: p.ytdlp === local("yt-dlp") },
      ffmpeg: { path: p.ffmpeg, version: fv, managed: p.ffmpeg === local("ffmpeg") },
      ready: Boolean(p.ytdlp && yv && p.ffmpeg && fv),
      canInstall: IS_WIN,
    }
  }

  async function download(url, dest, onProgress) {
    const res = await fetchImpl(url, { redirect: "follow" })
    if (!res.ok || !res.body) throw new Error(`取得できませんでした（HTTP ${res.status}）。`)
    const total = Number(res.headers.get("content-length")) || null
    const tmp = `${dest}.download`
    const out = fs.createWriteStream(tmp)
    let done = 0
    const reader = res.body.getReader()
    try {
      for (;;) {
        const { done: end, value } = await reader.read()
        if (end) break
        done += value.length
        if (!out.write(Buffer.from(value))) await new Promise((r) => out.once("drain", r))
        onProgress?.({ downloaded: done, total })
      }
    } finally {
      await new Promise((r) => out.end(r))
    }
    fs.renameSync(tmp, dest)
  }

  /** 足りないツールを取得する（Windows のみ）。onProgress({ tool, downloaded, total, stage }) */
  function install(onProgress) {
    if (installing) return installing
    installing = (async () => {
      if (!IS_WIN) throw new Error("自動の準備は Windows のみです。yt-dlp と ffmpeg を PATH に入れてください。")
      fs.mkdirSync(bin, { recursive: true })
      const p = paths()
      if (!p.ytdlp) {
        await download(SOURCES.ytdlp, local("yt-dlp"), (x) => onProgress?.({ tool: "yt-dlp", stage: "download", ...x }))
      }
      if (!p.ffmpeg) {
        const zip = path.join(bin, "ffmpeg.zip")
        await download(SOURCES.ffmpeg, zip, (x) => onProgress?.({ tool: "ffmpeg", stage: "download", ...x }))
        onProgress?.({ tool: "ffmpeg", stage: "extract", downloaded: null, total: null })
        await extractFfmpeg(zip, bin)
        fs.rmSync(zip, { force: true })
      }
      return status()
    })().finally(() => {
      installing = null
    })
    return installing
  }

  /** zip から bin\ffmpeg.exe と ffprobe.exe だけを取り出す（Windows 10 以降の tar.exe を使う） */
  function extractFfmpeg(zip, dest) {
    return new Promise((res, rej) => {
      const work = path.join(dest, "ffmpeg-extract")
      fs.rmSync(work, { recursive: true, force: true })
      fs.mkdirSync(work, { recursive: true })
      const tar = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe")
      execFile(tar, ["-xf", zip, "-C", work], { windowsHide: true, timeout: 10 * 60 * 1000 }, (err) => {
        if (err) return rej(new Error("ffmpeg を展開できませんでした。"))
        try {
          const found = findFiles(work, ["ffmpeg.exe", "ffprobe.exe"])
          if (!found["ffmpeg.exe"]) throw new Error("ffmpeg.exe が見つかりません。")
          for (const [name, file] of Object.entries(found)) fs.copyFileSync(file, path.join(dest, name))
          fs.rmSync(work, { recursive: true, force: true })
          res()
        } catch (e) {
          rej(e)
        }
      })
    })
  }

  /** yt-dlp を最新にする（自分で置いたものだけ）。戻り値は新しいバージョン */
  function updateYtdlp() {
    return new Promise((res, rej) => {
      const p = paths()
      if (!p.ytdlp) return rej(new Error("yt-dlp がありません。"))
      if (p.ytdlp !== local("yt-dlp")) return rej(new Error("この yt-dlp は Downlee の管理外です。配布元の方法で更新してください。"))
      const child = spawn(p.ytdlp, ["-U"], { windowsHide: true })
      let out = ""
      child.stdout.on("data", (d) => (out += d))
      child.stderr.on("data", (d) => (out += d))
      child.on("error", rej)
      child.on("close", async (code) => {
        if (code !== 0 && !/up to date|Updated yt-dlp/i.test(out)) return rej(new Error(out.trim().split("\n").pop() || "更新できませんでした。"))
        res(await version(p.ytdlp, ["--version"]))
      })
    })
  }

  return { paths, status, install, updateYtdlp, binDir: bin }
}

function findFiles(dir, names) {
  const out = {}
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (names.includes(e.name.toLowerCase()) && !out[e.name.toLowerCase()]) out[e.name.toLowerCase()] = p
    }
  }
  walk(dir)
  return out
}

module.exports = { createTools, SOURCES }
