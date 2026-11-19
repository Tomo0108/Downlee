/**
 * Downlee の Electron メインプロセス。
 * 画面（renderer）からは用途を限定した IPC だけを受け、yt-dlp・ffmpeg の起動、保存、専用ブラウザの管理をここで行う。
 */
const { app, BrowserWindow, Notification, clipboard, dialog, ipcMain, nativeImage, nativeTheme, net, session, shell } = require("electron")
const fs = require("node:fs")
const path = require("node:path")
const { spawn, execFile } = require("node:child_process")
const { randomUUID } = require("node:crypto")
const { createStore } = require("./store.cjs")
const { createTools } = require("./tools.cjs")
const { DownloadManager } = require("./manager.cjs")
const { createSniffer } = require("./sniffer.cjs")
const { createAdblock } = require("./adblock.cjs")
const ytdlp = require("./ytdlp.cjs")

const IS_WIN = process.platform === "win32"
app.setName("Downlee")
app.setPath("userData", path.join(app.getPath("appData"), "Downlee"))
if (IS_WIN) app.setAppUserModelId("com.downlee.app")

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
}

let mainWindow = null
let store = null
let tools = null
let manager = null
let sniffer = null
const iconPath = () => path.join(__dirname, "..", "dist", "icon.png")

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

function assertSender(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error("この操作は許可されていません。")
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    assertSender(event)
    return fn(...args)
  })
}

function titleBarOverlayFor(dark) {
  return { color: "#00000000", symbolColor: dark ? "#E6E6E6" : "#3C3C3C", height: 32 }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: "Downlee",
    icon: iconPath(),
    titleBarStyle: "hidden",
    titleBarOverlay: titleBarOverlayFor(nativeTheme.shouldUseDarkColors),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })
  mainWindow.setMenuBarVisibility(false)
  mainWindow.once("ready-to-show", () => mainWindow.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: "deny" }
  })
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault())
  mainWindow.on("closed", () => {
    mainWindow = null
    // 本体を閉じたら専用ブラウザも閉じて終了する
    sniffer?.control("close")
  })
  const devUrl = process.env.DOWNLEE_DEV_URL
  if (devUrl && !app.isPackaged) void mainWindow.loadURL(devUrl)
  else void mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"))
}

/* ---- プロセス ---- */

function childEnv() {
  return { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" }
}

function spawnTool(file, args) {
  if (!file) throw new Error("必要なツールがありません。［設定］の「ツール」から準備してください。")
  return spawn(file, args, { windowsHide: true, env: childEnv(), detached: !IS_WIN })
}

/** yt-dlp が起動した ffmpeg も一緒に止める */
function killTree(child) {
  if (!child.pid) return
  if (IS_WIN) execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, () => undefined)
  else {
    try { process.kill(-child.pid, "SIGTERM") } catch { child.kill("SIGTERM") }
  }
}

/* ---- 解析 ---- */

let analyzing = null
async function analyze(url, opts = {}) {
  const target = String(url || "").trim()
  if (!/^https?:\/\//i.test(target)) throw new Error("http:// か https:// で始まる URL を入れてください。")
  if (analyzing) killTree(analyzing)
  const p = tools.paths()
  let cookieFile = null
  if (opts.fromBrowser) cookieFile = await writeCookieFile([target, opts.referer], `analyze-${Date.now()}`)
  const args = ytdlp.buildAnalyzeArgs(target, store.getSettings(), { cookieFile, referer: opts.referer, headers: opts.fromBrowser ? browserHeaders(target, opts.referer) : undefined })
  return new Promise((resolve, reject) => {
    let child
    try { child = spawnTool(p.ytdlp, args) } catch (e) { return reject(e) }
    analyzing = child
    let out = ""
    let err = ""
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (d) => (out += d))
    child.stderr.on("data", (d) => (err = (err + d).slice(-8000)))
    const timer = setTimeout(() => killTree(child), 120000)
    child.on("error", (e) => reject(e))
    child.on("close", (code) => {
      clearTimeout(timer)
      if (analyzing === child) analyzing = null
      if (cookieFile) fs.rm(cookieFile, { force: true }, () => undefined)
      if (code !== 0 || !out.trim()) {
        const line = err.split("\n").filter((l) => /^ERROR:/.test(l)).pop() || err.trim().split("\n").pop() || "解析できませんでした。"
        const friendly = ytdlp.friendlyError(line.replace(/^ERROR:\s*/, ""))
        const e = new Error(friendly.text)
        e.code = friendly.code
        return reject(e)
      }
      try {
        resolve(ytdlp.summarizeInfo(JSON.parse(out)))
      } catch (e) {
        reject(e)
      }
    })
  })
}

/* ---- 専用ブラウザの cookie（ログインが必要なサイト用） ---- */

/** 専用ブラウザで見つけたものを取りに行くときのヘッダー（ブラウザが送ったものに合わせる） */
function browserHeaders(url, referer) {
  const h = { ...sniffer.headersFor(url), "User-Agent": sniffer.userAgent() }
  // 別のサイトから読み込まれる配信（HLS など）は Origin を見て断ることがある
  if (referer && !Object.keys(h).some((k) => k.toLowerCase() === "origin")) {
    try {
      const o = new URL(referer).origin
      if (o !== new URL(url).origin) h.Origin = o
    } catch {
      /* URL でなければ付けない */
    }
  }
  return h
}

async function writeCookieFile(urls, name) {
  const text = await sniffer.cookiesFor(...[].concat(urls))
  if (!text) return null
  const dir = path.join(app.getPath("userData"), "tmp")
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `cookies-${name}.txt`)
  fs.writeFileSync(file, text, { encoding: "utf8", mode: 0o600 })
  return file
}

/* ---- 待ち行列に入れる前の確認（画面から来た値をそのまま使わない） ---- */

const JOB_KEYS = ["url", "title", "thumbnail", "duration", "mode", "container", "audioFormat", "maxHeight", "codec", "formatId", "formatHasAudio", "sections", "playlist", "playlistItems", "referer", "presetLabel", "fromBrowser", "uploader", "sourceKind"]

function sanitizeJob(raw) {
  const job = {}
  for (const k of JOB_KEYS) if (raw && raw[k] !== undefined && raw[k] !== null) job[k] = raw[k]
  if (raw?.type === "convert") {
    const input = String(raw.input || "")
    if (!input || !fs.existsSync(input)) throw new Error("変換するファイルが見つかりません。")
    const target = String(raw.target || "")
    const spec = ytdlp.CONVERT_TARGETS[target]
    if (!spec) throw new Error("この形式には変換できません。")
    const dir = raw.sameFolder === false ? store.getSettings().outputDir : path.dirname(input)
    fs.mkdirSync(dir, { recursive: true })
    const base = path.basename(input, path.extname(input))
    return { type: "convert", input, target, output: uniquePath(dir, base, spec.ext), title: path.basename(input), presetLabel: target.toUpperCase(), start: cleanTime(raw.start), end: cleanTime(raw.end) }
  }
  if (!/^https?:\/\//i.test(String(job.url || ""))) throw new Error("URL が正しくありません。")
  if (job.referer && !/^https?:\/\//i.test(String(job.referer))) delete job.referer
  if (job.formatId && !/^[\w.+\-/]+$/.test(String(job.formatId))) delete job.formatId
  if (job.sections && !/^[\d:.,\s-]+$/.test(String(job.sections))) delete job.sections
  if (job.playlistItems && !/^[\d:,\s-]+$/.test(String(job.playlistItems))) delete job.playlistItems
  job.maxHeight = Number(job.maxHeight) || 0
  job.playlist = job.playlist === true
  job.fromBrowser = job.fromBrowser === true
  return job
}

function cleanTime(v) {
  const s = String(v ?? "").trim()
  return /^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(s) ? s : undefined
}

function uniquePath(dir, base, ext) {
  let p = path.join(dir, `${base}.${ext}`)
  for (let i = 2; fs.existsSync(p); i++) p = path.join(dir, `${base} (${i}).${ext}`)
  return p
}

/* ---- 完了したときの処理 ---- */

function onFinished(job) {
  if (job.status === "done") {
    let size = 0
    for (const f of job.files ?? []) {
      try { size += fs.statSync(f).size } catch { /* 移動・削除された */ }
    }
    store.addHistory({
      id: job.id,
      type: job.type,
      url: job.url ?? null,
      title: job.title,
      thumbnail: job.thumbnail ?? null,
      uploader: job.uploader ?? null,
      duration: job.duration ?? null,
      files: job.files ?? [],
      size,
      presetLabel: job.presetLabel ?? null,
      partial: job.partial === true,
      finishedAt: job.finishedAt,
      request: job.type === "download" ? Object.fromEntries(JOB_KEYS.filter((k) => job[k] !== undefined).map((k) => [k, job[k]])) : null,
    })
    send("history:changed")
    const s = store.getSettings()
    if (s.notifyOnDone && Notification.isSupported() && !(mainWindow?.isFocused())) {
      const n = new Notification({ title: job.type === "convert" ? "変換が終わりました" : "ダウンロードが終わりました", body: job.title || "", icon: iconPath(), silent: false })
      n.on("click", () => {
        const f = job.files?.[0]
        if (f) shell.showItemInFolder(f)
      })
      n.show()
    }
  }
  updateTaskbar()
}

function updateTaskbar() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const active = manager.list().filter((j) => j.status === "running" || j.status === "processing")
  if (!active.length) return mainWindow.setProgressBar(-1)
  const known = active.filter((j) => typeof j.progress?.percent === "number")
  if (!known.length) return mainWindow.setProgressBar(2, { mode: "indeterminate" })
  mainWindow.setProgressBar(known.reduce((a, j) => a + j.progress.percent, 0) / known.length / 100)
}

/* ---- IPC ---- */

function registerIpc() {
  handle("app:info", () => ({ version: app.getVersion(), userData: app.getPath("userData"), isPackaged: app.isPackaged, platform: process.platform }))
  handle("theme:set", (pref) => {
    nativeTheme.themeSource = pref === "dark" || pref === "light" ? pref : "system"
    try { mainWindow?.setTitleBarOverlay(titleBarOverlayFor(nativeTheme.shouldUseDarkColors)) } catch { /* 重ねない環境 */ }
  })
  nativeTheme.on("updated", () => {
    try { mainWindow?.setTitleBarOverlay(titleBarOverlayFor(nativeTheme.shouldUseDarkColors)) } catch { /* 重ねない環境 */ }
  })

  handle("settings:get", () => store.getSettings())
  handle("settings:defaults", () => store.defaults)
  handle("settings:set", async (patch) => {
    const next = store.setSettings(patch)
    manager.pump()
    if (patch && ("adBlock" in patch || "extensions" in patch)) await sniffer.applySettings().catch(() => undefined)
    return next
  })
  handle("settings:pick-folder", async () => {
    const r = await dialog.showOpenDialog(mainWindow, { title: "保存先のフォルダを選ぶ", defaultPath: store.getSettings().outputDir, properties: ["openDirectory", "createDirectory"] })
    if (r.canceled || !r.filePaths[0]) return null
    return store.setSettings({ outputDir: r.filePaths[0] })
  })

  handle("tools:status", () => tools.status())
  handle("tools:install", () => tools.install((p) => send("tools:progress", p)))
  handle("tools:update", () => tools.updateYtdlp())

  handle("media:analyze", (url, opts) => analyze(url, opts))
  handle("media:analyze-cancel", () => {
    if (analyzing) killTree(analyzing)
  })

  handle("queue:list", () => manager.list())
  handle("queue:add", (items) => {
    const list = (Array.isArray(items) ? items : [items]).slice(0, 500).map(sanitizeJob)
    fs.mkdirSync(store.getSettings().outputDir, { recursive: true })
    return manager.add(list)
  })
  handle("queue:pause", (id) => manager.pause(id))
  handle("queue:resume", (id) => manager.resume(id))
  handle("queue:cancel", (id) => manager.cancel(id))
  handle("queue:remove", (id) => manager.remove(id))
  handle("queue:clear-finished", () => manager.clearFinished())
  handle("queue:pause-all", () => manager.pauseAll())
  handle("queue:resume-all", () => manager.resumeAll())

  handle("history:list", () => store.listHistory())
  handle("history:remove", (ids) => store.removeHistory(Array.isArray(ids) ? ids : [ids]))
  handle("history:clear", () => store.clearHistory())

  handle("shell:open", async (file) => {
    if (typeof file !== "string" || !fs.existsSync(file)) throw new Error("ファイルが見つかりません（移動・削除された可能性があります）。")
    const err = await shell.openPath(file)
    if (err) throw new Error(err)
  })
  handle("shell:show", (file) => {
    if (typeof file !== "string" || !fs.existsSync(file)) throw new Error("ファイルが見つかりません（移動・削除された可能性があります）。")
    shell.showItemInFolder(file)
  })
  handle("shell:open-output", async () => {
    const dir = store.getSettings().outputDir
    fs.mkdirSync(dir, { recursive: true })
    await shell.openPath(dir)
  })
  handle("shell:external", (url) => {
    if (typeof url === "string" && /^https?:\/\//i.test(url)) void shell.openExternal(url)
  })

  handle("convert:pick", async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: "変換するファイルを選ぶ",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "動画・音声", extensions: ["mp4", "mkv", "webm", "mov", "avi", "flv", "wmv", "m4v", "ts", "mts", "3gp", "mp3", "m4a", "aac", "wav", "flac", "ogg", "opus", "wma", "gif"] },
        { name: "すべてのファイル", extensions: ["*"] },
      ],
    })
    if (r.canceled) return []
    return r.filePaths.map((p) => {
      let size = null
      try { size = fs.statSync(p).size } catch { /* 読めない */ }
      return { path: p, name: path.basename(p), size }
    })
  })
  handle("convert:stat", (paths) =>
    (Array.isArray(paths) ? paths : []).filter((p) => typeof p === "string" && fs.existsSync(p) && fs.statSync(p).isFile()).map((p) => ({ path: p, name: path.basename(p), size: fs.statSync(p).size })),
  )

  handle("clipboard:read", async () => String((await clipboard.readText()) ?? "").slice(0, 20000))

  handle("browser:open", (url) => sniffer.open(url))
  handle("browser:control", (action) => sniffer.control(action))
  handle("browser:state", () => sniffer.state())
  handle("browser:list", () => sniffer.list())
  handle("browser:clear", () => sniffer.clear())
  handle("browser:clear-data", () => sniffer.clearData())
  handle("browser:extensions", () => sniffer.extensions())
  handle("browser:add-extension", async () => {
    const r = await dialog.showOpenDialog(mainWindow, { title: "拡張機能のフォルダを選ぶ（manifest.json があるフォルダ）", properties: ["openDirectory"] })
    if (r.canceled || !r.filePaths[0]) return null
    const dir = r.filePaths[0]
    if (!fs.existsSync(path.join(dir, "manifest.json"))) throw new Error("manifest.json がないフォルダです。展開済みの拡張機能のフォルダを選んでください。")
    const list = store.getSettings().extensions
    store.setSettings({ extensions: [...list.filter((p) => p !== dir), dir] })
    await sniffer.applySettings()
    return { settings: store.getSettings(), extensions: sniffer.extensions() }
  })
  handle("browser:remove-extension", async (dir) => {
    store.setSettings({ extensions: store.getSettings().extensions.filter((p) => p !== dir) })
    await sniffer.applySettings()
    return { settings: store.getSettings(), extensions: sniffer.extensions() }
  })
}

app.whenReady().then(() => {
  const userData = app.getPath("userData")
  store = createStore(userData, app.getPath("downloads"))
  tools = createTools({ userData, resourcesBin: app.isPackaged ? path.join(process.resourcesPath, "bin") : path.join(__dirname, "..", "vendor", "bin"), fetchImpl: (url, init) => net.fetch(url, init) })
  sniffer = createSniffer({
    BrowserWindow,
    session,
    nativeImage,
    getSettings: () => store.getSettings(),
    onFound: (items) => send("browser:found", items),
    onState: (state) => send("browser:state", state),
    iconPath: iconPath(),
    randomUUID,
    // Chromium の通信（OS のプロキシ設定に従う）で取り、だめなら Node の fetch で取り直す
    adblock: createAdblock({ userData, fetchImpl: (url, init) => net.fetch(url, init).catch(() => fetch(url, init)) }),
  })
  const cookieFiles = new Map()
  manager = new DownloadManager({
    getSettings: () => store.getSettings(),
    spawnYtdlp: (args) => spawnTool(tools.paths().ytdlp, args),
    spawnFfmpeg: (args) => spawnTool(tools.paths().ffmpeg, args),
    killTree,
    getFfmpegDir: () => {
      const f = tools.paths().ffmpeg
      return f ? path.dirname(f) : undefined
    },
    beforeStart: async (job) => {
      if (job.type !== "download") return
      if (job.fromBrowser) {
        const file = await writeCookieFile([job.url, job.referer], job.id)
        if (file) {
          cookieFiles.set(job.id, file)
          job.cookieFile = file
        }
        job.headers = browserHeaders(job.url, job.referer)
      }
    },
    afterEnd: (job) => {
      const file = cookieFiles.get(job.id)
      if (file) fs.rm(file, { force: true }, () => undefined)
      cookieFiles.delete(job.id)
      delete job.cookieFile
      delete job.headers
    },
    onFinished,
    persist: (jobs) => store.writeQueue(jobs.map(({ cookieFile: _c, headers: _h, ...j }) => j)),
  })
  manager.restore(store.readQueue())
  manager.on("job", (job) => {
    const { cookieFile: _c, headers: _h, ...safe } = job
    send("queue:job", safe)
    updateTaskbar()
  })
  manager.on("removed", (id) => send("queue:removed", id))
  manager.on("reset", (jobs) => send("queue:reset", jobs))
  registerIpc()
  createWindow()

  // 起動時に yt-dlp を最新にする（サイトの仕様変更に追従するため。失敗しても続ける）
  if (store.getSettings().autoUpdateYtdlp) {
    setTimeout(() => {
      tools.updateYtdlp().then((v) => send("tools:updated", v)).catch(() => undefined)
    }, 4000)
  }
})

app.on("window-all-closed", () => {
  app.quit()
})

app.on("before-quit", () => {
  manager?.stopAll()
  manager?.deps.persist?.(manager.list().filter((j) => !["done", "error", "canceled"].includes(j.status)))
  store?.flush()
})
