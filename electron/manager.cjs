/**
 * ダウンロード・変換の待ち行列。同時に動かす数（設定の maxConcurrent）を守って順に yt-dlp / ffmpeg を動かす。
 * プロセスの起動・停止は外から渡す（テストでは偽物を使う）。
 */
const { EventEmitter } = require("node:events")
const { randomUUID } = require("node:crypto")
const ytdlp = require("./ytdlp.cjs")

const ACTIVE = new Set(["running", "processing"])
const FINISHED = new Set(["done", "error", "canceled"])
/** 自動でやり直すエラー（通信の切断・止まったまま動かない など） */
const RETRYABLE = new Set(["network", "other", "stalled"])
const MAX_AUTO_RETRY = 5
/** yt-dlp が拒まれたとき、専用ブラウザ経由に切り替えるエラー */
const BROWSER_FALLBACK = new Set(["noresponse", "forbidden", "network", "login", "other", "stalled"])
const STAGE_LABEL = {
  Merger: "映像と音声を結合中",
  ExtractAudio: "音声を取り出し中",
  VideoConvertor: "形式を変換中",
  VideoRemuxer: "形式を整えています",
  EmbedSubtitle: "字幕を埋め込み中",
  EmbedThumbnail: "サムネイルを埋め込み中",
  Metadata: "情報を書き込み中",
  SponsorBlock: "区間を除去中",
  ModifyChapters: "区間を除去中",
}

class DownloadManager extends EventEmitter {
  /**
   * @param {{ getSettings: () => any, spawnYtdlp: (args: string[]) => any, spawnFfmpeg: (args: string[]) => any, killTree: (child: any) => void,
   *           getFfmpegDir?: () => string | undefined, onFinished?: (job: any) => void, persist?: (jobs: any[]) => void, beforeStart?: (job: any) => Promise<void> | void,
   *           afterEnd?: (job: any) => void, now?: () => number, stallMs?: number, retryDelayMs?: number,
   *           startBrowser?: (job: any) => any, canBrowser?: (job: any) => boolean, discard?: (job: any) => void }} deps
   */
  constructor(deps) {
    super()
    this.deps = deps
    this.jobs = []
    this.children = new Map()
    this.stopReason = new Map()
    this.lastEmit = new Map()
    this.watchdogs = new Map()
    this.now = deps.now ?? (() => Date.now())
  }

  restore(jobs) {
    for (const j of jobs ?? []) {
      if (!j || !j.id || FINISHED.has(j.status)) continue
      this.jobs.push({ ...j, status: ACTIVE.has(j.status) || j.status === "queued" ? "paused" : j.status, progress: { ...(j.progress ?? {}), speed: null, eta: null } })
    }
  }

  list() {
    return this.jobs
  }

  /** 追加して返す。input は 1 件または配列 */
  add(input) {
    const items = Array.isArray(input) ? input : [input]
    const added = items.map((raw) => ({
      ...raw,
      id: randomUUID(),
      type: raw.type === "convert" ? "convert" : "download",
      status: "queued",
      title: raw.title || raw.url || raw.input || "",
      progress: { percent: null, downloaded: null, total: null, speed: null, eta: null, stage: null },
      files: [],
      error: null,
      createdAt: new Date(this.now()).toISOString(),
      finishedAt: null,
    }))
    this.jobs.push(...added)
    // 同時に動かす数を超えて待っているものも、すぐ一覧に出す
    for (const j of added) this.emit("job", j)
    this.changed()
    this.pump()
    return added
  }

  get(id) {
    return this.jobs.find((j) => j.id === id)
  }

  pause(id) {
    const job = this.get(id)
    if (!job) return
    if (ACTIVE.has(job.status)) this.stop(job, "paused")
    else if (job.status === "queued") this.update(job, { status: "paused" })
  }

  resume(id) {
    const job = this.get(id)
    if (!job || !(job.status === "paused" || job.status === "error" || job.status === "canceled")) return
    this.update(job, { status: "queued", error: null, autoRetries: 0, retryAt: null })
    this.pump()
  }

  cancel(id) {
    const job = this.get(id)
    if (!job) return
    if (ACTIVE.has(job.status)) this.stop(job, "canceled")
    else if (!FINISHED.has(job.status)) this.finish(job, { status: "canceled" })
  }

  remove(id) {
    const job = this.get(id)
    if (!job) return
    if (ACTIVE.has(job.status)) this.stop(job, "removed")
    else if (job.via === "browser") this.deps.discard?.(job)
    this.jobs = this.jobs.filter((j) => j.id !== id)
    this.emit("removed", id)
    this.changed()
  }

  clearFinished() {
    const before = this.jobs.length
    for (const j of this.jobs) if (FINISHED.has(j.status) && j.via === "browser") this.deps.discard?.(j)
    this.jobs = this.jobs.filter((j) => !FINISHED.has(j.status))
    if (before !== this.jobs.length) {
      this.emit("reset", this.jobs)
      this.changed()
    }
  }

  pauseAll() {
    for (const j of [...this.jobs]) if (ACTIVE.has(j.status) || j.status === "queued") this.pause(j.id)
  }

  resumeAll() {
    for (const j of this.jobs) if (j.status === "paused") j.status = "queued"
    this.emit("reset", this.jobs)
    this.changed()
    this.pump()
  }

  stopAll() {
    for (const j of this.jobs) if (ACTIVE.has(j.status)) this.stop(j, "paused")
  }

  /* ---- 内部 ---- */

  stop(job, reason) {
    const child = this.children.get(job.id)
    this.stopReason.set(job.id, reason)
    if (child) {
      try { this.deps.killTree(child) } catch { /* すでに終わっている */ }
    }
  }

  pump() {
    const max = Math.max(1, Number(this.deps.getSettings().maxConcurrent) || 1)
    let running = this.jobs.filter((j) => ACTIVE.has(j.status)).length
    for (const job of this.jobs) {
      if (running >= max) break
      if (job.status !== "queued") continue
      if (job.retryAt && job.retryAt > this.now()) continue
      running++
      void this.start(job)
    }
  }

  async start(job) {
    this.update(job, { status: "running", error: null, progress: { ...job.progress, speed: null, eta: null, stage: job.type === "convert" ? "変換中" : null } })
    try {
      await this.deps.beforeStart?.(job)
    } catch (e) {
      this.finish(job, { status: "error", error: { code: "prepare", text: e instanceof Error ? e.message : String(e) } })
      return
    }
    if (job.status !== "running") return
    let child
    try {
      if (job.type === "convert") {
        child = this.deps.spawnFfmpeg(ytdlp.buildConvertArgs(job.input, job.output, job.target, { start: job.start, end: job.end }))
      } else if (job.via === "browser" && this.deps.startBrowser) {
        child = this.deps.startBrowser(job)
      } else {
        child = this.deps.spawnYtdlp(ytdlp.buildDownloadArgs(job, this.deps.getSettings(), { ffmpegDir: this.deps.getFfmpegDir?.() }))
      }
    } catch (e) {
      this.finish(job, { status: "error", error: { code: "spawn", text: e instanceof Error ? e.message : String(e) } })
      return
    }
    this.children.set(job.id, child)
    // 進まないまま長く止まっていたら打ち切る（HLS の断片が届かないときなど）。
    // 準備の間は出力があれば進んでいるとみなし、取得が始まってからはデータが増えたときだけ進んだとみなす
    let lastActivity = this.now()
    let started = false
    let gotData = false
    let lastBytes = null
    let lastRetry = null
    const stallMs = this.deps.stallMs ?? 120_000
    if (job.type === "download") {
      const timer = setInterval(() => {
        if (job.status === "running" && this.now() - lastActivity > stallMs) {
          clearInterval(timer)
          job.stallInfo = { gotData, lastRetry }
          this.stop(job, "stalled")
        }
      }, Math.min(15_000, stallMs))
      timer.unref?.()
      this.watchdogs.set(job.id, timer)
    }
    const errors = []
    let stderrTail = ""
    let duration = job.duration ?? null
    const onLine = (line, fromErr) => {
      if (job.type === "convert" || !started) lastActivity = this.now()
      if (job.type === "convert") {
        if (fromErr) {
          stderrTail = (stderrTail + line + "\n").slice(-4000)
          duration ??= ytdlp.parseFfmpegDuration(line)
          return
        }
        const p = ytdlp.parseFfmpegProgress(line)
        if (p && p.seconds !== undefined && duration) this.progress(job, { percent: Math.min(100, (p.seconds / duration) * 100) })
        return
      }
      const p = ytdlp.parseLine(line)
      if (!p) {
        if (fromErr) stderrTail = (stderrTail + line + "\n").slice(-4000)
        return
      }
      if (p.type === "progress") {
        const { type: _t, status: _s, ...rest } = p
        started = true
        if (p.downloaded !== null && p.downloaded !== lastBytes) {
          if (lastBytes !== null || p.downloaded > 0) gotData = true
          lastBytes = p.downloaded
          lastActivity = this.now()
        }
        this.progress(job, { ...rest, stage: p.status === "finished" ? job.progress.stage : null })
      } else if (p.type === "prep") {
        if (p.started) started = true
        // 「全 N 個」のあとに来る「最初のデータを待っています」で上書きしない
        if (job.progress.downloaded == null && !(p.started && /^最初の/.test(job.progress.stage ?? "") && /^最初の/.test(p.text))) {
          this.update(job, { progress: { ...job.progress, stage: p.text } })
        }
      } else if (p.type === "retry") {
        lastRetry = p.message
        // サイトに拒まれた（403）ら、取り直しを待たずにすぐブラウザ経由へ切り替える
        if (job.via !== "browser" && /HTTP Error 403/i.test(p.message) && this.deps.startBrowser && this.deps.canBrowser?.(job) && !this.stopReason.has(job.id)) {
          this.stop(job, "tobrowser")
          return
        }
        this.update(job, { progress: { ...job.progress, stage: `サーバーの応答を待っています（取り直し ${p.attempt}${p.max ? `/${p.max}` : ""}）`, speed: null, eta: null } })
      } else if (p.type === "ffstats") {
        started = true
        if (p.bytes > 0 && p.bytes !== lastBytes) {
          gotData = true
          lastBytes = p.bytes
          lastActivity = this.now()
          const dur = job.duration ?? duration
          this.progress(job, { downloaded: p.bytes, total: null, percent: dur ? Math.min(99, (p.seconds / dur) * 100) : null, speed: null, eta: null, stage: dur ? null : `取得中（${Math.floor(p.seconds / 60)}:${String(Math.floor(p.seconds % 60)).padStart(2, "0")} 分）` })
        }
      } else if (p.type === "info") {
        started = false
        const patch = {}
        if (p.title && p.title !== "NA" && (!job.titleLocked || job.playlist)) patch.currentTitle = p.title
        if (!job.title || job.title === job.url) patch.title = p.title
        if (p.thumbnail && !job.thumbnail) patch.thumbnail = p.thumbnail
        if (p.duration) patch.duration = p.duration
        this.update(job, { ...patch, status: "running", progress: { ...job.progress, playlistIndex: p.playlistIndex ?? job.progress.playlistIndex, playlistCount: p.playlistCount ?? job.progress.playlistCount, stage: null } })
      } else if (p.type === "stage") {
        this.update(job, { status: "processing", progress: { ...job.progress, stage: STAGE_LABEL[p.stage] ?? "仕上げ中", speed: null, eta: null } })
      } else if (p.type === "file") {
        this.update(job, { files: [...job.files.filter((f) => f !== p.path), p.path] })
      } else if (p.type === "error") {
        errors.push(p.message)
      }
    }
    pipeLines(child.stdout, (l) => onLine(l, false))
    pipeLines(child.stderr, (l) => onLine(l, true))
    child.on("error", (e) => errors.push(e.message))
    child.on("close", (code) => {
      this.children.delete(job.id)
      clearInterval(this.watchdogs.get(job.id))
      this.watchdogs.delete(job.id)
      const reason = this.stopReason.get(job.id)
      this.stopReason.delete(job.id)
      this.deps.afterEnd?.(job)
      if (reason === "removed") {
        if (job.via === "browser") this.deps.discard?.(job)
        return
      }
      if (reason === "paused") {
        this.update(job, { status: "paused", progress: { ...job.progress, speed: null, eta: null } })
      } else if (reason === "canceled") {
        this.finish(job, { status: "canceled" })
      } else if (reason === "tobrowser" && this.switchToBrowser(job)) {
        // 切り替えた
      } else if (reason === "stalled") {
        const info = job.stallInfo ?? {}
        delete job.stallInfo
        if (!info.gotData && !job.progress.downloaded && this.switchToBrowser(job)) {
          // 切り替えた
        } else if (!info.gotData && !job.progress.downloaded) {
          // 一度もデータが届かないときは、待ち続けずに理由を出して止める
          this.finish(job, {
            status: "error",
            error: { code: "noresponse", text: "サーバーからデータが届きません。サイトが取得を拒んでいるか、極端に混み合っています。" },
            detail: info.lastRetry ? `最後のエラー：${info.lastRetry}` : "接続はできましたが、データが 1 バイトも届きませんでした。",
            progress: { ...job.progress, speed: null, eta: null, stage: null },
          })
        } else {
          this.retryLater(job, "止まったため、続きからやり直します", { code: "stalled", text: "途中から応答が止まったままになりました。" }, info.lastRetry)
        }
      } else if (code === 0) {
        const files = job.type === "convert" ? [job.output] : job.files
        this.finish(job, { status: "done", files, progress: { ...job.progress, percent: 100, speed: null, eta: null, stage: null } })
      } else {
        const message = errors[errors.length - 1] || stderrTail.trim().split("\n").filter(Boolean).pop() || `終了コード ${code}`
        const friendly = ytdlp.friendlyError(message)
        if (BROWSER_FALLBACK.has(friendly.code) && this.switchToBrowser(job)) return
        if (job.type === "download" && RETRYABLE.has(friendly.code) && !(job.playlist && job.files.length > 0)) {
          this.retryLater(job, "接続をやり直しています", friendly, message)
          return
        }
        // プレイリストで一部だけ失敗したときは、できた分を残して「一部失敗」にする
        const partial = job.playlist && job.files.length > 0
        this.finish(job, { status: partial ? "done" : "error", partial, error: friendly, detail: message.slice(0, 2000), progress: { ...job.progress, speed: null, eta: null, stage: null } })
      }
      this.pump()
    })
  }

  /** yt-dlp での取得をあきらめ、専用ブラウザ経由で取り直す（1 回だけ）。切り替えたら true */
  switchToBrowser(job) {
    if (job.type !== "download" || job.via === "browser" || !this.deps.startBrowser || !this.deps.canBrowser?.(job)) return false
    this.update(job, { via: "browser", status: "queued", autoRetries: 0, retryAt: null, progress: { ...job.progress, percent: null, downloaded: null, total: null, speed: null, eta: null, stage: "ブラウザ経由に切り替えています" } })
    this.pump()
    return true
  }

  /** 少し待って続きからやり直す（--continue で取得済みの分は使う）。回数を使い切ったら失敗にして false */
  retryLater(job, label, error, detail) {
    const n = (job.autoRetries ?? 0) + 1
    if (n > MAX_AUTO_RETRY) {
      this.finish(job, { status: "error", error, detail: detail ? String(detail).slice(0, 2000) : undefined, progress: { ...job.progress, speed: null, eta: null, stage: null } })
      this.pump()
      return false
    }
    this.update(job, { status: "queued", autoRetries: n, retryAt: this.now() + (this.deps.retryDelayMs ?? 3000) * n, progress: { ...job.progress, speed: null, eta: null, stage: `${label}（${n}/${MAX_AUTO_RETRY}）` } })
    const t = setTimeout(() => {
      if (job.status === "queued") this.pump()
    }, job.retryAt - this.now() + 5)
    t.unref?.()
    this.pump()
    return true
  }

  progress(job, patch) {
    job.progress = { ...job.progress, ...patch }
    const last = this.lastEmit.get(job.id) ?? 0
    const t = this.now()
    if (t - last < 200 && patch.percent !== 100) return
    this.lastEmit.set(job.id, t)
    this.emit("job", job)
  }

  update(job, patch) {
    Object.assign(job, patch)
    this.emit("job", job)
    this.changed()
  }

  finish(job, patch) {
    this.update(job, { ...patch, finishedAt: new Date(this.now()).toISOString() })
    if (job.via === "browser" && job.status === "canceled") this.deps.discard?.(job)
    this.deps.onFinished?.(job)
  }

  changed() {
    if (this.persistTimer) return
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      this.deps.persist?.(this.jobs.filter((j) => !FINISHED.has(j.status)))
    }, 300)
  }
}

/** ストリームを行ごとに読む（\r も区切りにする） */
function pipeLines(stream, onLine) {
  if (!stream) return
  let buf = ""
  stream.setEncoding?.("utf8")
  stream.on("data", (chunk) => {
    buf += chunk
    const parts = buf.split(/\r?\n|\r/)
    buf = parts.pop() ?? ""
    for (const p of parts) if (p) onLine(p)
  })
  stream.on("end", () => {
    if (buf) onLine(buf)
    buf = ""
  })
}

module.exports = { DownloadManager, pipeLines, STAGE_LABEL }
