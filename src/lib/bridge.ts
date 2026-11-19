import type { BrowserState, DownleeBridge, FoundMedia, HistoryEntry, Job, JobRequest, MediaInfo, Settings, ToolsStatus } from "./types"

/**
 * デスクトップ版では preload が公開する window.downlee を使う。
 * ブラウザでの画面確認（npm run dev）では、見本の動きをする代わりの実装を使う（実際のダウンロードはしない）。
 */
export const isDesktop = typeof window !== "undefined" && Boolean(window.downlee)

export const bridge: DownleeBridge = typeof window !== "undefined" && window.downlee ? window.downlee : createMockBridge()

function createMockBridge(): DownleeBridge {
  type Cb<T> = (v: T) => void
  const subs = { job: new Set<Cb<Job>>(), removed: new Set<Cb<string>>(), reset: new Set<Cb<Job[]>>(), history: new Set<Cb<void>>(), found: new Set<Cb<FoundMedia[]>>(), state: new Set<Cb<BrowserState>>() }
  const sub = <T,>(set: Set<Cb<T>>) => (cb: Cb<T>) => {
    set.add(cb)
    return () => void set.delete(cb)
  }
  let settings: Settings = {
    outputDir: "C:\\Users\\user\\Downloads\\Downlee",
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
    clipboardWatch: false,
    quickMode: false,
    notifyOnDone: true,
    autoUpdateYtdlp: true,
    extraArgs: "",
    blockedDomains: "",
  }
  const defaults = { ...settings }
  let jobs: Job[] = []
  let history: HistoryEntry[] = [
    { id: "h1", type: "download", url: "https://video.example.com/watch/abc", title: "夕暮れの海辺 4K タイムラプス", thumbnail: thumb(1), uploader: "Example Channel", duration: 312, files: ["C:\\Users\\user\\Downloads\\Downlee\\夕暮れの海辺.mp4"], size: 812_000_000, presetLabel: "MP4・4K", partial: false, finishedAt: new Date(Date.now() - 3600_000).toISOString(), request: { url: "https://video.example.com/watch/abc", mode: "video", container: "mp4" } },
    { id: "h2", type: "download", url: "https://video.example.com/watch/def", title: "ピアノ練習曲 第3番", thumbnail: thumb(2), uploader: "Music Example", duration: 245, files: ["C:\\Users\\user\\Downloads\\Downlee\\ピアノ練習曲.mp3"], size: 9_400_000, presetLabel: "MP3", partial: false, finishedAt: new Date(Date.now() - 86400_000 * 2).toISOString(), request: null },
  ]
  let found: FoundMedia[] = []
  const emit = (j: Job) => subs.job.forEach((cb) => cb({ ...j, progress: { ...j.progress } }))
  const tick = () => {
    let running = jobs.filter((j) => j.status === "running" || j.status === "processing").length
    for (const j of jobs) {
      if (j.status === "queued" && running < settings.maxConcurrent) {
        j.status = "running"
        running++
        emit(j)
      }
      if (j.status !== "running" && j.status !== "processing") continue
      const total = j.progress.total ?? 150_000_000 + Math.round(Math.random() * 400_000_000)
      const pct = Math.min(100, (j.progress.percent ?? 0) + 1.5 + Math.random() * 4)
      if (pct >= 100 && j.status === "running") {
        j.status = "processing"
        j.progress = { ...j.progress, percent: 100, stage: "映像と音声を結合中", speed: null, eta: null }
      } else if (j.status === "processing") {
        j.status = "done"
        j.finishedAt = new Date().toISOString()
        j.files = [`${settings.outputDir}\\${j.title}.mp4`]
        j.progress = { ...j.progress, stage: null }
        history = [{ id: j.id, type: j.type, url: j.url ?? null, title: j.title, thumbnail: j.thumbnail ?? null, uploader: j.uploader ?? null, duration: j.duration ?? null, files: j.files, size: total, presetLabel: j.presetLabel ?? null, partial: false, finishedAt: j.finishedAt, request: null }, ...history]
        subs.history.forEach((cb) => cb())
      } else {
        const speed = 4_000_000 + Math.random() * 9_000_000
        j.progress = { ...j.progress, percent: pct, total, downloaded: (total * pct) / 100, speed, eta: ((100 - pct) / 100) * (total / speed) }
      }
      emit(j)
    }
  }
  setInterval(tick, 700)
  const find = (id: string) => jobs.find((j) => j.id === id)
  const ok = async () => undefined
  const status: ToolsStatus = { ytdlp: { path: "C:\\Users\\user\\AppData\\Roaming\\Downlee\\bin\\yt-dlp.exe", version: "2026.10.26", managed: true }, ffmpeg: { path: "C:\\Users\\user\\AppData\\Roaming\\Downlee\\bin\\ffmpeg.exe", version: "7.1", managed: true }, ready: true, canInstall: true }

  return {
    appInfo: async () => ({ version: "0.1.0", userData: "(画面確認モード)", isPackaged: false, platform: "browser" }),
    setTheme: ok,
    getSettings: async () => settings,
    getDefaultSettings: async () => defaults,
    setSettings: async (patch) => (settings = { ...settings, ...patch }),
    pickOutputFolder: async () => null,
    toolsStatus: async () => status,
    installTools: async () => status,
    updateYtdlp: async () => status.ytdlp.version,
    onToolsProgress: () => () => undefined,
    onToolsUpdated: () => () => undefined,
    analyze: async (url) => {
      await new Promise((r) => setTimeout(r, 900))
      return sampleInfo(url)
    },
    cancelAnalyze: ok,
    listQueue: async () => jobs,
    addToQueue: async (items: JobRequest[]) => {
      const added = items.map((r, i): Job => ({ ...r, id: `${Date.now()}-${i}`, type: r.type ?? "download", status: "queued", title: r.title || r.url || r.input || "", progress: { percent: null, downloaded: null, total: null, speed: null, eta: null, stage: null }, files: [], error: null, createdAt: new Date().toISOString(), finishedAt: null }))
      jobs = [...jobs, ...added]
      added.forEach(emit)
      return added
    },
    pauseJob: async (id) => {
      const j = find(id)
      if (j) {
        j.status = "paused"
        j.progress = { ...j.progress, speed: null, eta: null }
        emit(j)
      }
    },
    resumeJob: async (id) => {
      const j = find(id)
      if (j) {
        j.status = "queued"
        j.error = null
        emit(j)
      }
    },
    cancelJob: async (id) => {
      const j = find(id)
      if (j) {
        j.status = "canceled"
        emit(j)
      }
    },
    removeJob: async (id) => {
      jobs = jobs.filter((j) => j.id !== id)
      subs.removed.forEach((cb) => cb(id))
    },
    clearFinished: async () => {
      jobs = jobs.filter((j) => !["done", "error", "canceled"].includes(j.status))
      subs.reset.forEach((cb) => cb(jobs))
    },
    pauseAll: async () => {
      jobs.forEach((j) => {
        if (["queued", "running", "processing"].includes(j.status)) {
          j.status = "paused"
          emit(j)
        }
      })
    },
    resumeAll: async () => {
      jobs.forEach((j) => {
        if (j.status === "paused") {
          j.status = "queued"
          emit(j)
        }
      })
    },
    onJob: sub(subs.job),
    onJobRemoved: sub(subs.removed),
    onQueueReset: sub(subs.reset),
    listHistory: async () => history,
    removeHistory: async (ids) => {
      history = history.filter((h) => !ids.includes(h.id))
    },
    clearHistory: async () => {
      history = []
    },
    onHistoryChanged: sub(subs.history),
    openFile: ok,
    showInFolder: ok,
    openOutputFolder: ok,
    openExternal: async (url) => void window.open(url, "_blank", "noopener"),
    pickConvertFiles: async () => [{ path: "C:\\Users\\user\\Videos\\会議の録画.mov", name: "会議の録画.mov", size: 1_240_000_000 }],
    statFiles: async () => [],
    pathForFile: (f) => f.name,
    readClipboard: async () => "",
    openBrowser: async (url) => {
      const s: BrowserState = { open: true, url: url || "https://video.example.com/", title: "Example 動画ページ", canGoBack: false, canGoForward: false, loading: false }
      subs.state.forEach((cb) => cb(s))
      setTimeout(() => {
        found = [
          { id: "f1", url: "https://cdn.example.com/hls/master.m3u8", pageUrl: s.url!, pageTitle: "Example 動画ページ", kind: "hls", contentType: "application/vnd.apple.mpegurl", size: null, at: new Date().toISOString() },
          { id: "f2", url: "https://cdn.example.com/media/intro.mp4", pageUrl: s.url!, pageTitle: "Example 動画ページ", kind: "video", contentType: "video/mp4", size: 48_200_000, at: new Date().toISOString() },
        ]
        subs.found.forEach((cb) => cb(found))
      }, 1200)
      return s
    },
    controlBrowser: async (action) => {
      const s: BrowserState = action === "close" ? { open: false } : { open: true, url: "https://video.example.com/", title: "Example 動画ページ" }
      subs.state.forEach((cb) => cb(s))
      return s
    },
    browserState: async () => ({ open: false }),
    listFound: async () => found,
    clearFound: async () => {
      found = []
      subs.found.forEach((cb) => cb(found))
    },
    clearBrowserData: ok,
    onFound: sub(subs.found),
    onBrowserState: sub(subs.state),
  }
}

function thumb(n: number) {
  const hues = [265, 200, 330, 20, 150]
  const h = hues[n % hues.length]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},70%,62%)"/><stop offset="1" stop-color="hsl(${h + 40},70%,40%)"/></linearGradient></defs><rect width="320" height="180" fill="url(#g)"/><circle cx="160" cy="90" r="26" fill="white" fill-opacity=".85"/><path d="M152 76 L174 90 L152 104 Z" fill="hsl(${h},60%,45%)"/></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function sampleInfo(url: string): MediaInfo {
  if (/list|playlist/i.test(url)) {
    return {
      kind: "playlist",
      id: "pl1",
      title: "旅の記録 2026",
      uploader: "Example Channel",
      webpageUrl: url,
      extractor: "Example",
      thumbnail: thumb(3),
      count: 5,
      entries: ["京都の朝", "金沢の市場", "富山湾の夕日", "立山の雪の大谷", "帰りの新幹線"].map((title, i) => ({ index: i + 1, id: `e${i}`, title, url: `${url}#${i + 1}`, duration: 180 + i * 47, thumbnail: thumb(i) })),
    }
  }
  const f = (id: string, ext: string, kind: "av" | "video" | "audio", height: number | null, vcodec: string | null, acodec: string | null, size: number, fps: number | null = 30, hdr: string | null = null) => ({ id, ext, kind, width: height ? Math.round((height * 16) / 9) : null, height, fps, vcodec, acodec, tbr: null, abr: kind === "audio" ? 160 : null, size, note: null, protocol: "https", dynamicRange: hdr, drm: false })
  return {
    kind: "video",
    id: "abc123",
    title: "夕暮れの海辺 4K タイムラプス",
    uploader: "Example Channel",
    duration: 312,
    thumbnail: thumb(0),
    webpageUrl: url,
    extractor: "Example",
    isLive: false,
    drm: false,
    bestHeight: 2160,
    heights: [2160, 1440, 1080, 720, 480, 360],
    formats: [
      f("401", "mp4", "video", 2160, "AV1", null, 820_000_000, 60, "HDR10"),
      f("313", "webm", "video", 2160, "VP9", null, 760_000_000, 60),
      f("271", "webm", "video", 1440, "VP9", null, 410_000_000, 60),
      f("137", "mp4", "video", 1080, "H.264", null, 210_000_000),
      f("22", "mp4", "av", 720, "H.264", "AAC", 98_000_000),
      f("18", "mp4", "av", 360, "H.264", "AAC", 31_000_000),
      f("251", "webm", "audio", null, null, "Opus", 6_100_000, null),
      f("140", "m4a", "audio", null, null, "AAC", 5_000_000, null),
    ],
    subtitles: ["ja", "en"],
    autoSubtitles: ["ja", "en", "fr"],
    chapters: 4,
  }
}
