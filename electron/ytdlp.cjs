/**
 * yt-dlp の引数づくりと出力の読み取り（Electron に依存しない純粋な処理。electron/ytdlp.test.cjs で確かめる）。
 * DRM（Widevine・PlayReady・FairPlay など）で保護された動画は扱わない。解除・回避の処理は入れない。
 */

const VIDEO_CONTAINERS = ["mp4", "mkv", "webm", "mov", "avi"]
const AUDIO_FORMATS = ["best", "mp3", "m4a", "aac", "flac", "opus", "wav", "ogg"]
const PROGRESS_PREFIX = "DLPROG "
const FILE_PREFIX = "DLFILE "
const INFO_PREFIX = "DLINFO "

/** 画質の上限（高さ）。null は上限なし（最高画質） */
function heightFilter(maxHeight) {
  return Number.isFinite(maxHeight) && maxHeight > 0 ? `[height<=${Math.round(maxHeight)}]` : ""
}

/** 動画コーデックの好み（-S）。互換性を優先したいときに H.264 を先に選ぶ */
function codecSort(codec, container) {
  const keys = []
  if (codec === "h264") keys.push("vcodec:h264", "acodec:aac")
  else if (codec === "h265") keys.push("vcodec:h265")
  else if (codec === "av1") keys.push("vcodec:av01")
  else if (codec === "vp9") keys.push("vcodec:vp9")
  else if (container === "webm") keys.push("vcodec:vp9", "acodec:opus")
  else if (container === "mov" || container === "avi") keys.push("vcodec:h264", "acodec:aac")
  return keys
}

/**
 * ダウンロード 1 件の yt-dlp 引数を作る。
 * @param {object} job  { url, mode: "video"|"audio"|"gif", container, audioFormat, maxHeight, codec, formatId, formatHasAudio,
 *                       sections, playlist, playlistItems, title, referer, headers, cookieFile }
 * @param {object} s    設定（Settings）
 * @param {object} t    { ffmpegDir }
 */
function buildDownloadArgs(job, s, t = {}) {
  const args = ["--newline", "--progress", "--no-colors", "--encoding", "utf-8", "--no-quiet"]
  args.push("--progress-template", `download:${PROGRESS_PREFIX}%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(info.playlist_index)s|%(info.n_entries)s|%(progress.fragment_index)s|%(progress.fragment_count)s`)
  args.push("--print", `before_dl:${INFO_PREFIX}%(id)s|%(title)s|%(thumbnail)s|%(duration)s|%(playlist_index)s|%(n_entries)s`)
  args.push("--print", `after_move:${FILE_PREFIX}%(filepath)s`)
  if (t.ffmpegDir) args.push("--ffmpeg-location", t.ffmpegDir)

  const mode = job.mode ?? "video"
  const h = heightFilter(job.maxHeight)
  if (mode === "audio") {
    const af = AUDIO_FORMATS.includes(job.audioFormat) ? job.audioFormat : "best"
    args.push("-f", job.formatId ? job.formatId : "ba/b")
    args.push("-x")
    if (af !== "best") args.push("--audio-format", af, "--audio-quality", af === "mp3" ? (s.mp3Bitrate || "320K") : "0")
  } else {
    if (job.formatId) {
      args.push("-f", job.formatHasAudio ? job.formatId : `${job.formatId}+ba/${job.formatId}`)
    } else {
      args.push("-f", `bv*${h}+ba/b${h}/bv*+ba/b`)
    }
    const container = mode === "gif" ? "gif" : VIDEO_CONTAINERS.includes(job.container) ? job.container : "mp4"
    const sort = codecSort(job.codec, container)
    if (sort.length) args.push("-S", sort.join(","))
    if (container === "gif") {
      args.push("--recode-video", "gif")
    } else if (container === "mp4" || container === "mkv") {
      args.push("--merge-output-format", container, "--remux-video", container)
    } else if (container === "webm") {
      args.push("--merge-output-format", "webm/mkv", "--recode-video", "webm")
    } else {
      // mov・avi は多くの組み合わせで作り直しが要る。音声・映像をまとめてから変換する
      args.push("--merge-output-format", "mkv", "--recode-video", container)
    }
    if (s.embedSubtitles && s.subtitles && container !== "gif" && container !== "avi") args.push("--embed-subs")
    if (s.embedChapters && container !== "gif" && container !== "avi") args.push("--embed-chapters")
  }

  if (s.subtitles && mode !== "gif") {
    args.push("--write-subs", "--sub-langs", (s.subtitleLangs || "ja,en").replace(/\s+/g, ""), "--convert-subs", "srt")
    if (s.autoSubtitles) args.push("--write-auto-subs")
  }
  if (s.embedThumbnail && mode !== "gif" && !(mode === "video" && ["webm", "avi"].includes(job.container)) && !(mode === "audio" && ["wav", "opus", "aac"].includes(job.audioFormat))) args.push("--embed-thumbnail")
  if (s.writeThumbnail) args.push("--write-thumbnail")
  if (s.embedMetadata && mode !== "gif") args.push("--embed-metadata")
  if (s.sponsorBlockRemove && mode !== "gif") args.push("--sponsorblock-remove", "sponsor,selfpromo,interaction")

  if (job.sections) {
    for (const range of String(job.sections).split(",").map((r) => r.trim()).filter(Boolean)) args.push("--download-sections", `*${range}`)
    args.push("--force-keyframes-at-cuts")
  }

  if (job.playlist) {
    args.push("--yes-playlist")
    if (job.playlistItems) args.push("-I", String(job.playlistItems).replace(/\s+/g, ""))
  } else {
    args.push("--no-playlist")
  }

  const dir = job.outputDir || s.outputDir
  const template = sanitizeTemplate(job.playlist ? s.playlistTemplate : s.filenameTemplate)
  args.push("-P", dir, "-P", `temp:${dir}`, "-o", template, "-o", "subtitle:%(title).150B.%(ext)s", "-o", "thumbnail:%(title).150B.%(ext)s")
  args.push("--windows-filenames", "--trim-filenames", "180")
  if (!s.overwrite) args.push("--no-overwrites")
  else args.push("--force-overwrites")
  args.push("--continue", "--no-mtime")

  args.push("-N", String(clampInt(s.concurrentFragments, 1, 16, 4)))
  // 途中で止まらないように：固まった接続は 30 秒で切って取り直し、失敗した断片は間をあけて何度も取り直す
  args.push("--socket-timeout", "30", "--retries", "20", "--fragment-retries", "50", "--retry-sleep", "http:exp=1:20", "--retry-sleep", "fragment:exp=1:20", "--extractor-retries", "5")
  if (s.rateLimit) args.push("-r", String(s.rateLimit))
  if (s.proxy) args.push("--proxy", String(s.proxy))
  if (job.cookieFile) args.push("--cookies", job.cookieFile)
  else if (s.cookiesFromBrowser) args.push("--cookies-from-browser", s.cookiesFromBrowser)
  if (job.referer) args.push("--referer", job.referer)
  for (const [k, v] of Object.entries(job.headers ?? {})) args.push("--add-header", `${k}:${v}`)
  if (s.extraArgs) args.push(...splitArgs(s.extraArgs))

  args.push("--", job.url)
  return args
}

/** 解析（形式の一覧づくり）の引数 */
function buildAnalyzeArgs(url, s, extra = {}) {
  const args = ["-J", "--no-warnings", "--encoding", "utf-8", "--flat-playlist", "--no-colors"]
  if (s.proxy) args.push("--proxy", String(s.proxy))
  if (extra.cookieFile) args.push("--cookies", extra.cookieFile)
  else if (s.cookiesFromBrowser) args.push("--cookies-from-browser", s.cookiesFromBrowser)
  if (extra.referer) args.push("--referer", extra.referer)
  for (const [k, v] of Object.entries(extra.headers ?? {})) args.push("--add-header", `${k}:${v}`)
  args.push("--", url)
  return args
}

/** ファイル名のひな形。パス区切りの外へ出る指定（..）は消す */
function sanitizeTemplate(t) {
  const v = String(t || "%(title).150B [%(id)s].%(ext)s").replace(/\.\.[\\/]/g, "").replace(/^[\\/]+/, "")
  return v.includes("%(ext)s") ? v : `${v}.%(ext)s`
}

function clampInt(v, min, max, def) {
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def
}

/** 追加の引数（上級者向け）。"..." と '...' のまとまりを 1 つとして分ける */
function splitArgs(text) {
  const out = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m
  while ((m = re.exec(String(text)))) out.push(m[1] ?? m[2] ?? m[3])
  return out
}

const num = (v) => {
  if (v === undefined || v === null || v === "NA" || v === "None" || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * yt-dlp の 1 行を読み取る。
 * 戻り値：{ type: "progress", ... } | { type: "file", path } | { type: "info", ... } | { type: "stage", stage } | { type: "error", message } | null
 */
function parseLine(line) {
  const text = String(line).replace(/\r/g, "").trimEnd()
  if (!text) return null
  if (text.startsWith(PROGRESS_PREFIX)) {
    const [status, downloaded, total, estimate, speed, eta, index, count, fragIndex, fragCount] = text.slice(PROGRESS_PREFIX.length).split("|")
    const totalBytes = num(total) ?? num(estimate)
    const done = num(downloaded)
    const fi = num(fragIndex)
    const fc = num(fragCount)
    return {
      type: "progress",
      status,
      downloaded: done,
      total: totalBytes,
      // HLS などで全体の大きさがわからないときは、取得した断片の数で進み具合を出す
      percent: done !== null && totalBytes ? Math.min(100, (done / totalBytes) * 100) : fi !== null && fc ? Math.min(100, (fi / fc) * 100) : null,
      speed: num(speed),
      eta: num(eta),
      playlistIndex: num(index),
      playlistCount: num(count),
    }
  }
  if (text.startsWith(FILE_PREFIX)) return { type: "file", path: text.slice(FILE_PREFIX.length) }
  if (text.startsWith(INFO_PREFIX)) {
    const [id, ...rest] = text.slice(INFO_PREFIX.length).split("|")
    // タイトルに | が入ることがあるため、後ろから数える
    const count = rest.pop()
    const index = rest.pop()
    const duration = rest.pop()
    const thumbnail = rest.pop()
    const title = rest.join("|")
    return { type: "info", id, title, thumbnail: thumbnail && thumbnail !== "NA" ? thumbnail : null, duration: num(duration), playlistIndex: num(index), playlistCount: num(count) }
  }
  const stage = /^\[(Merger|ExtractAudio|VideoConvertor|VideoRemuxer|EmbedSubtitle|EmbedThumbnail|Metadata|FixupM3u8|FixupM4a|FixupStretched|FixupDuplicateMoov|SponsorBlock|ModifyChapters|ThumbnailsConvertor|SubtitlesConvertor)\]/.exec(text)
  if (stage) return { type: "stage", stage: stage[1] }
  if (/^ERROR:/.test(text)) return { type: "error", message: text.replace(/^ERROR:\s*/, "") }
  return null
}

/** エラー文を利用者向けの短い日本語にする */
function friendlyError(message) {
  const m = String(message || "")
  if (/DRM|drm protected|Widevine|PlayReady|FairPlay/i.test(m)) return { code: "drm", text: "DRM（著作権保護）がかかっているため、ダウンロードできません。" }
  if (/Unsupported URL/i.test(m)) return { code: "unsupported", text: "このページには対応していません。［見つける］でページを開くと、動画を見つけられることがあります。" }
  if (/private video|Private video/i.test(m)) return { code: "private", text: "非公開の動画です。" }
  if (/not available in your country|geo.?restrict/i.test(m)) return { code: "geo", text: "お住まいの地域では視聴できない動画です。" }
  if (/ffmpeg|ffprobe/i.test(m) && /not found|not installed/i.test(m)) return { code: "ffmpeg", text: "ffmpeg が見つかりません。［設定］の「ツール」から準備してください。" }
  if (/HTTP Error 404|not found/i.test(m)) return { code: "notfound", text: "動画が見つかりません（削除された可能性があります）。" }
  if (/HTTP Error 403/i.test(m)) return { code: "forbidden", text: "サイトに拒否されました。しばらくしてから再試行するか、yt-dlp を更新してください。" }
  if (/timed out|Connection|network|getaddrinfo|resolve/i.test(m)) return { code: "network", text: "接続できませんでした。ネットワークを確認してください。" }
  if (/Sign in|log ?in|members[- ]only|--cookies|confirm you.?re not a bot|\bage[- ]restricted|\bconfirm your age|\bage verification/i.test(m)) return { code: "login", text: "ログインが必要な動画です。［設定］の「ブラウザのログイン情報」を使うか、［見つける］でログインしてから試してください。" }
  if (/No space left|disk full/i.test(m)) return { code: "disk", text: "保存先の空き容量が足りません。" }
  if (/Requested format is not available/i.test(m)) return { code: "format", text: "選んだ形式はこの動画にありません。別の画質・形式を選んでください。" }
  return { code: "other", text: m.split("\n")[0].slice(0, 300) || "ダウンロードに失敗しました。" }
}

/** yt-dlp -J の結果を、画面で使う形にまとめる */
function summarizeInfo(info) {
  if (!info || typeof info !== "object") throw new Error("解析結果を読み取れません。")
  if (info._type === "playlist" || Array.isArray(info.entries)) {
    const entries = (info.entries ?? []).filter(Boolean).map((e, i) => ({
      index: i + 1,
      id: String(e.id ?? ""),
      title: String(e.title ?? e.id ?? `#${i + 1}`),
      url: String(e.url ?? e.webpage_url ?? ""),
      duration: num(e.duration),
      thumbnail: pickThumb(e),
    }))
    return {
      kind: "playlist",
      id: String(info.id ?? ""),
      title: String(info.title ?? "プレイリスト"),
      uploader: info.uploader ?? info.channel ?? null,
      webpageUrl: info.webpage_url ?? info.original_url ?? null,
      extractor: info.extractor_key ?? info.extractor ?? null,
      thumbnail: pickThumb(info) ?? entries.find((e) => e.thumbnail)?.thumbnail ?? null,
      count: entries.length,
      entries,
    }
  }
  const formats = (info.formats ?? []).filter((f) => f && f.format_id && !/storyboard|mhtml/i.test(String(f.format_note ?? f.ext ?? "")) && f.ext !== "mhtml")
  const drm = formats.length > 0 && formats.every((f) => f.has_drm === true)
  const mapped = formats.map((f) => {
    const hasVideo = f.vcodec && f.vcodec !== "none"
    const hasAudio = f.acodec && f.acodec !== "none"
    return {
      id: String(f.format_id),
      ext: String(f.ext ?? ""),
      kind: hasVideo && hasAudio ? "av" : hasVideo ? "video" : hasAudio ? "audio" : "unknown",
      width: num(f.width),
      height: num(f.height),
      fps: num(f.fps),
      vcodec: hasVideo ? shortCodec(f.vcodec) : null,
      acodec: hasAudio ? shortCodec(f.acodec) : null,
      tbr: num(f.tbr),
      abr: num(f.abr),
      size: num(f.filesize) ?? num(f.filesize_approx),
      note: f.format_note ? String(f.format_note) : null,
      protocol: f.protocol ? String(f.protocol) : null,
      dynamicRange: f.dynamic_range && f.dynamic_range !== "SDR" ? String(f.dynamic_range) : null,
      drm: f.has_drm === true,
    }
  })
  const heights = [...new Set(mapped.filter((f) => f.height && f.kind !== "audio" && !f.drm).map((f) => f.height))].sort((a, b) => b - a)
  const subs = Object.keys(info.subtitles ?? {}).filter((k) => k !== "live_chat")
  const autoSubs = Object.keys(info.automatic_captions ?? {})
  return {
    kind: "video",
    id: String(info.id ?? ""),
    title: String(info.title ?? info.id ?? "動画"),
    uploader: info.uploader ?? info.channel ?? null,
    duration: num(info.duration),
    thumbnail: pickThumb(info),
    webpageUrl: info.webpage_url ?? info.original_url ?? null,
    extractor: info.extractor_key ?? info.extractor ?? null,
    isLive: info.is_live === true,
    drm,
    bestHeight: heights[0] ?? null,
    heights,
    formats: mapped.reverse(),
    subtitles: subs,
    autoSubtitles: autoSubs.length > 0 ? autoSubs.slice(0, 200) : [],
    chapters: Array.isArray(info.chapters) ? info.chapters.length : 0,
  }
}

function pickThumb(info) {
  if (info.thumbnail) return String(info.thumbnail)
  const list = Array.isArray(info.thumbnails) ? info.thumbnails.filter((t) => t && t.url) : []
  if (!list.length) return null
  const best = [...list].sort((a, b) => (num(b.width) ?? 0) - (num(a.width) ?? 0))
  const mid = best.find((t) => (num(t.width) ?? 0) <= 720) ?? best[0]
  return String(mid.url)
}

function shortCodec(c) {
  const v = String(c)
  if (/^avc|h264/i.test(v)) return "H.264"
  if (/^hvc|hev|h265/i.test(v)) return "H.265"
  if (/^av01/i.test(v)) return "AV1"
  if (/^vp0?9/i.test(v)) return "VP9"
  if (/^vp0?8/i.test(v)) return "VP8"
  if (/^mp4a|aac/i.test(v)) return "AAC"
  if (/opus/i.test(v)) return "Opus"
  if (/vorbis/i.test(v)) return "Vorbis"
  if (/^mp3/i.test(v)) return "MP3"
  if (/^ac-?3|ec-?3/i.test(v)) return v.toUpperCase().replace("-", "")
  if (/flac/i.test(v)) return "FLAC"
  return v.split(".")[0]
}

/* ローカルのファイル変換（ffmpeg） */
const CONVERT_TARGETS = {
  mp4: { ext: "mp4", args: ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"] },
  mkv: { ext: "mkv", args: ["-c", "copy"] },
  webm: { ext: "webm", args: ["-c:v", "libvpx-vp9", "-crf", "30", "-b:v", "0", "-row-mt", "1", "-c:a", "libopus", "-b:a", "160k"] },
  mov: { ext: "mov", args: ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-c:a", "aac", "-b:a", "192k"] },
  avi: { ext: "avi", args: ["-c:v", "mpeg4", "-q:v", "3", "-c:a", "libmp3lame", "-b:a", "192k"] },
  gif: { ext: "gif", args: ["-vf", "fps=12,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse", "-loop", "0"] },
  mp3: { ext: "mp3", args: ["-vn", "-c:a", "libmp3lame", "-b:a", "320k"] },
  m4a: { ext: "m4a", args: ["-vn", "-c:a", "aac", "-b:a", "256k"] },
  aac: { ext: "aac", args: ["-vn", "-c:a", "aac", "-b:a", "256k"] },
  flac: { ext: "flac", args: ["-vn", "-c:a", "flac"] },
  opus: { ext: "opus", args: ["-vn", "-c:a", "libopus", "-b:a", "160k"] },
  wav: { ext: "wav", args: ["-vn", "-c:a", "pcm_s16le"] },
  ogg: { ext: "ogg", args: ["-vn", "-c:a", "libvorbis", "-q:a", "6"] },
}

function buildConvertArgs(input, output, target, opts = {}) {
  const t = CONVERT_TARGETS[target]
  if (!t) throw new Error("この形式には変換できません。")
  const args = ["-hide_banner", "-nostdin", "-y", "-progress", "pipe:1", "-nostats"]
  if (opts.start) args.push("-ss", String(opts.start))
  if (opts.end) args.push("-to", String(opts.end))
  args.push("-i", input)
  args.push(...t.args)
  args.push(output)
  return args
}

/** ffmpeg の -progress 出力から経過時間（秒）を取る */
function parseFfmpegProgress(line) {
  const m = /^out_time_(?:us|ms)=(\d+)/.exec(String(line).trim())
  if (m) return { seconds: Number(m[1]) / 1e6 }
  if (/^progress=end/.test(String(line).trim())) return { end: true }
  return null
}

function parseFfmpegDuration(text) {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(String(text))
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null
}

module.exports = {
  VIDEO_CONTAINERS,
  AUDIO_FORMATS,
  CONVERT_TARGETS,
  buildDownloadArgs,
  buildAnalyzeArgs,
  buildConvertArgs,
  parseLine,
  parseFfmpegProgress,
  parseFfmpegDuration,
  friendlyError,
  summarizeInfo,
  sanitizeTemplate,
  splitArgs,
}
