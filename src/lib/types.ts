/** 画面とメインプロセスでやり取りする型（electron/*.cjs と形をそろえる） */

export type Mode = "video" | "audio" | "gif"
export type VideoContainer = "mp4" | "mkv" | "webm" | "mov" | "avi"
export type AudioFormat = "best" | "mp3" | "m4a" | "aac" | "flac" | "opus" | "wav" | "ogg"
export type Codec = "any" | "h264" | "h265" | "av1" | "vp9"
export type ThemePreference = "system" | "light" | "dark"

export interface Settings {
  outputDir: string
  defaultPreset: string
  defaultHeight: number
  defaultCodec: Codec
  filenameTemplate: string
  playlistTemplate: string
  maxConcurrent: number
  concurrentFragments: number
  subtitles: boolean
  subtitleLangs: string
  autoSubtitles: boolean
  embedSubtitles: boolean
  embedThumbnail: boolean
  embedMetadata: boolean
  embedChapters: boolean
  writeThumbnail: boolean
  sponsorBlockRemove: boolean
  mp3Bitrate: string
  cookiesFromBrowser: string
  proxy: string
  rateLimit: string
  overwrite: boolean
  clipboardWatch: boolean
  quickMode: boolean
  notifyOnDone: boolean
  autoUpdateYtdlp: boolean
  extraArgs: string
  blockedDomains: string
  adBlock: boolean
  extensions: string[]
}

export interface FormatInfo {
  id: string
  ext: string
  kind: "av" | "video" | "audio" | "unknown"
  width: number | null
  height: number | null
  fps: number | null
  vcodec: string | null
  acodec: string | null
  tbr: number | null
  abr: number | null
  size: number | null
  note: string | null
  protocol: string | null
  dynamicRange: string | null
  drm: boolean
}

export interface VideoInfo {
  kind: "video"
  id: string
  title: string
  uploader: string | null
  duration: number | null
  thumbnail: string | null
  webpageUrl: string | null
  extractor: string | null
  isLive: boolean
  drm: boolean
  bestHeight: number | null
  heights: number[]
  formats: FormatInfo[]
  subtitles: string[]
  autoSubtitles: string[]
  chapters: number
}

export interface PlaylistEntry {
  index: number
  id: string
  title: string
  url: string
  duration: number | null
  thumbnail: string | null
}

export interface PlaylistInfo {
  kind: "playlist"
  id: string
  title: string
  uploader: string | null
  webpageUrl: string | null
  extractor: string | null
  thumbnail: string | null
  count: number
  entries: PlaylistEntry[]
}

export type MediaInfo = VideoInfo | PlaylistInfo

/** 待ち行列に入れるときの指定 */
export interface JobRequest {
  type?: "download" | "convert"
  url?: string
  title?: string
  thumbnail?: string | null
  duration?: number | null
  uploader?: string | null
  mode?: Mode
  container?: VideoContainer
  audioFormat?: AudioFormat
  maxHeight?: number
  codec?: Codec
  formatId?: string
  formatHasAudio?: boolean
  sections?: string
  playlist?: boolean
  playlistItems?: string
  referer?: string
  fromBrowser?: boolean
  presetLabel?: string
  sourceKind?: string
  /* 変換 */
  input?: string
  target?: string
  sameFolder?: boolean
  start?: string
  end?: string
}

export type JobStatus = "queued" | "running" | "processing" | "paused" | "done" | "error" | "canceled"

export interface JobProgress {
  percent: number | null
  downloaded: number | null
  total: number | null
  speed: number | null
  eta: number | null
  stage: string | null
  playlistIndex?: number | null
  playlistCount?: number | null
}

export interface Job extends JobRequest {
  id: string
  type: "download" | "convert"
  status: JobStatus
  title: string
  currentTitle?: string
  progress: JobProgress
  files: string[]
  error: { code: string; text: string } | null
  detail?: string
  partial?: boolean
  output?: string
  createdAt: string
  finishedAt: string | null
}

export interface HistoryEntry {
  id: string
  type: "download" | "convert"
  url: string | null
  title: string
  thumbnail: string | null
  uploader: string | null
  duration: number | null
  files: string[]
  size: number
  presetLabel: string | null
  partial: boolean
  finishedAt: string
  request: JobRequest | null
}

export interface ToolsStatus {
  ytdlp: { path: string | null; version: string | null; managed: boolean }
  ffmpeg: { path: string | null; version: string | null; managed: boolean }
  ready: boolean
  canInstall: boolean
}

export interface ToolsProgress {
  tool: string
  stage: "download" | "extract"
  downloaded: number | null
  total: number | null
}

export interface FoundMedia {
  id: string
  url: string
  pageUrl: string
  pageTitle: string
  kind: "hls" | "dash" | "mss" | "video" | "audio"
  contentType: string | null
  size: number | null
  at: string
  /** 見つけたときのページ移動の番号（BrowserState.nav と同じなら、いま開いているページの分） */
  nav?: number
  /** 広告のリストに当たったもの。ふだんは隠す */
  ad?: boolean
}

export interface BrowserState {
  open: boolean
  nav?: number
  url?: string
  title?: string
  canGoBack?: boolean
  canGoForward?: boolean
  loading?: boolean
}

export interface ExtensionInfo {
  path: string
  name: string
  version: string | null
  loaded: boolean
  error: string | null
}

export interface LocalFile {
  path: string
  name: string
  size: number | null
}

type Unsub = () => void

export interface DownleeBridge {
  appInfo(): Promise<{ version: string; userData: string; isPackaged: boolean; platform: string }>
  setTheme(pref: ThemePreference): Promise<void>
  getSettings(): Promise<Settings>
  getDefaultSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  pickOutputFolder(): Promise<Settings | null>
  toolsStatus(): Promise<ToolsStatus>
  installTools(): Promise<ToolsStatus>
  updateYtdlp(): Promise<string | null>
  onToolsProgress(cb: (p: ToolsProgress) => void): Unsub
  onToolsUpdated(cb: (version: string | null) => void): Unsub
  analyze(url: string, opts?: { fromBrowser?: boolean; referer?: string }): Promise<MediaInfo>
  cancelAnalyze(): Promise<void>
  listQueue(): Promise<Job[]>
  addToQueue(items: JobRequest[]): Promise<Job[]>
  pauseJob(id: string): Promise<void>
  resumeJob(id: string): Promise<void>
  cancelJob(id: string): Promise<void>
  removeJob(id: string): Promise<void>
  clearFinished(): Promise<void>
  pauseAll(): Promise<void>
  resumeAll(): Promise<void>
  onJob(cb: (job: Job) => void): Unsub
  onJobRemoved(cb: (id: string) => void): Unsub
  onQueueReset(cb: (jobs: Job[]) => void): Unsub
  listHistory(): Promise<HistoryEntry[]>
  removeHistory(ids: string[]): Promise<void>
  clearHistory(): Promise<void>
  onHistoryChanged(cb: () => void): Unsub
  openFile(path: string): Promise<void>
  showInFolder(path: string): Promise<void>
  openOutputFolder(): Promise<void>
  openExternal(url: string): Promise<void>
  pickConvertFiles(): Promise<LocalFile[]>
  statFiles(paths: string[]): Promise<LocalFile[]>
  pathForFile(file: File): string
  readClipboard(): Promise<string>
  openBrowser(url?: string): Promise<BrowserState>
  controlBrowser(action: "back" | "forward" | "reload" | "close" | "focus"): Promise<BrowserState>
  browserState(): Promise<BrowserState>
  listFound(): Promise<FoundMedia[]>
  clearFound(): Promise<void>
  clearBrowserData(): Promise<void>
  listExtensions(): Promise<ExtensionInfo[]>
  addExtension(): Promise<{ settings: Settings; extensions: ExtensionInfo[] } | null>
  removeExtension(dir: string): Promise<{ settings: Settings; extensions: ExtensionInfo[] }>
  onFound(cb: (items: FoundMedia[]) => void): Unsub
  onBrowserState(cb: (s: BrowserState) => void): Unsub
}

declare global {
  interface Window {
    downlee?: DownleeBridge
  }
}
