/**
 * 設定・履歴・待ち行列の保存（%APPDATA%\Downlee の JSON）。書き込みは一時ファイル経由で置き換え、途中で落ちても壊さない。
 */
const fs = require("node:fs")
const path = require("node:path")

const HISTORY_LIMIT = 3000

function defaultSettings(downloadsDir) {
  return {
    outputDir: path.join(downloadsDir, "Downlee"),
    defaultPreset: "video-mp4",
    defaultHeight: 0,
    defaultCodec: "any",
    filenameTemplate: "%(title).150B [%(id)s].%(ext)s",
    playlistTemplate: "%(playlist_title).80B/%(playlist_index)03d - %(title).120B.%(ext)s",
    maxConcurrent: 3,
    concurrentFragments: 4,
    subtitles: false,
    subtitleLangs: "ja,en",
    autoSubtitles: false,
    embedSubtitles: true,
    embedThumbnail: true,
    embedMetadata: true,
    embedChapters: true,
    writeThumbnail: false,
    sponsorBlockRemove: false,
    mp3Bitrate: "320K",
    cookiesFromBrowser: "",
    proxy: "",
    rateLimit: "",
    overwrite: false,
    clipboardWatch: true,
    quickMode: false,
    notifyOnDone: true,
    autoUpdateYtdlp: true,
    extraArgs: "",
    blockedDomains: "",
  }
}

const STRING_KEYS = ["outputDir", "defaultPreset", "defaultCodec", "filenameTemplate", "playlistTemplate", "subtitleLangs", "mp3Bitrate", "cookiesFromBrowser", "proxy", "rateLimit", "extraArgs", "blockedDomains"]
const BOOL_KEYS = ["subtitles", "autoSubtitles", "embedSubtitles", "embedThumbnail", "embedMetadata", "embedChapters", "writeThumbnail", "sponsorBlockRemove", "overwrite", "clipboardWatch", "quickMode", "notifyOnDone", "autoUpdateYtdlp"]
const BROWSERS = ["", "chrome", "edge", "firefox", "brave", "opera", "vivaldi", "chromium", "whale"]

/** 画面から来た設定を、決まった型・範囲に直してから保存する */
function normalizeSettings(input, defaults) {
  const out = { ...defaults }
  const src = input && typeof input === "object" ? input : {}
  for (const k of STRING_KEYS) if (typeof src[k] === "string") out[k] = src[k].slice(0, 2000)
  for (const k of BOOL_KEYS) if (typeof src[k] === "boolean") out[k] = src[k]
  const int = (v, min, max, d) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Math.round(Number(v)))) : d)
  out.maxConcurrent = int(src.maxConcurrent, 1, 8, defaults.maxConcurrent)
  out.concurrentFragments = int(src.concurrentFragments, 1, 16, defaults.concurrentFragments)
  out.defaultHeight = int(src.defaultHeight, 0, 4320, defaults.defaultHeight)
  if (!BROWSERS.includes(out.cookiesFromBrowser)) out.cookiesFromBrowser = ""
  if (!out.outputDir.trim()) out.outputDir = defaults.outputDir
  if (!/^\d+(\.\d+)?[KMG]?$/i.test(out.rateLimit.trim())) out.rateLimit = ""
  if (!/^\d+K$/i.test(out.mp3Bitrate)) out.mp3Bitrate = "320K"
  return out
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {
    return fallback
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 1), "utf8")
  fs.renameSync(tmp, file)
}

function createStore(userData, downloadsDir) {
  const defaults = defaultSettings(downloadsDir)
  const files = {
    settings: path.join(userData, "settings.json"),
    history: path.join(userData, "history.json"),
    queue: path.join(userData, "queue.json"),
  }
  let settings = normalizeSettings(readJson(files.settings, {}), defaults)
  let history = Array.isArray(readJson(files.history, [])) ? readJson(files.history, []) : []
  let historyTimer = null
  const flushHistory = () => {
    historyTimer = null
    try { writeJson(files.history, history) } catch { /* 次の書き込みで再試行する */ }
  }
  return {
    defaults,
    getSettings: () => settings,
    setSettings(patch) {
      settings = normalizeSettings({ ...settings, ...(patch ?? {}) }, defaults)
      writeJson(files.settings, settings)
      return settings
    },
    listHistory: () => history,
    addHistory(entry) {
      history = [entry, ...history.filter((h) => h.id !== entry.id)].slice(0, HISTORY_LIMIT)
      if (!historyTimer) historyTimer = setTimeout(flushHistory, 400)
    },
    removeHistory(ids) {
      const set = new Set(ids)
      history = history.filter((h) => !set.has(h.id))
      flushHistory()
    },
    clearHistory() {
      history = []
      flushHistory()
    },
    flush() {
      if (historyTimer) { clearTimeout(historyTimer); flushHistory() }
    },
    readQueue: () => {
      const q = readJson(files.queue, [])
      return Array.isArray(q) ? q : []
    },
    writeQueue: (jobs) => {
      try { writeJson(files.queue, jobs) } catch { /* 保存できなくてもダウンロードは続ける */ }
    },
  }
}

module.exports = { createStore, defaultSettings, normalizeSettings, HISTORY_LIMIT }
