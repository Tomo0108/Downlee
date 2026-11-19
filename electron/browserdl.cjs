/**
 * ブラウザ経由の保存：yt-dlp の取得をサイトが拒むとき、専用ブラウザのページの中から断片を取り、ffmpeg でつなぐ。
 * ページが再生しているものと同じ通信で取るので、ブラウザで再生できるものは取れる。
 * DRM（SAMPLE-AES・FairPlay・Widevine など）がかかったものは扱わない（「ダウンロードできません」にする）。
 */
const fs = require("node:fs")
const path = require("node:path")
const { EventEmitter } = require("node:events")
const { PassThrough } = require("node:stream")
const { stripQuery } = require("./capture.cjs")

const PROGRESS_PREFIX = "DLPROG "
const FILE_PREFIX = "DLFILE "

function attrs(line) {
  const out = {}
  const re = /([A-Z0-9-]+)=("([^"]*)"|[^,]*)/g
  let m
  while ((m = re.exec(line))) out[m[1]] = m[3] ?? m[2]
  return out
}

function resolve(uri, base) {
  try {
    return new URL(uri, base).toString()
  } catch {
    return uri
  }
}

/** master の HLS から、映像の画質一覧と音声の別トラックを読む */
function parseMaster(text, base) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim())
  const variants = []
  const audio = []
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (l.startsWith("#EXT-X-STREAM-INF:")) {
      const a = attrs(l.slice(18))
      const uri = lines.slice(i + 1).find((x) => x && !x.startsWith("#"))
      if (!uri) continue
      const res = /(\d+)x(\d+)/.exec(a.RESOLUTION || "")
      variants.push({ url: resolve(uri, base), bandwidth: Number(a.BANDWIDTH) || 0, height: res ? Number(res[2]) : null, audioGroup: a.AUDIO ?? null })
    } else if (l.startsWith("#EXT-X-MEDIA:")) {
      const a = attrs(l.slice(13))
      if (a.TYPE === "AUDIO" && a.URI) audio.push({ url: resolve(a.URI, base), group: a["GROUP-ID"], isDefault: a.DEFAULT === "YES", language: a.LANGUAGE ?? null })
    }
  }
  return { variants, audio }
}

/** 画質を選ぶ（上限があればそれ以下でいちばん高いもの）と、それに合う音声トラック */
function pickVariant(master, maxHeight) {
  const sorted = [...master.variants].sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || b.bandwidth - a.bandwidth)
  const limit = Number(maxHeight) || 0
  const video = (limit ? sorted.find((v) => !v.height || v.height <= limit) : null) ?? sorted[0] ?? null
  if (!video) return null
  const group = master.audio.filter((a) => a.group === video.audioGroup)
  const audio = group.find((a) => a.isDefault) ?? group[0] ?? null
  return { video, audio }
}

/**
 * media の HLS を、手元のファイルを指す形に書き換える。
 * 戻り値：{ playlist, files: [{ url, name, range }], drm, live }
 * BYTERANGE の断片は取るときに範囲を指定するので、書き換えたあとは丸ごとのファイルになる。
 */
function localizeMedia(text, base) {
  const lines = String(text || "").split(/\r?\n/)
  const out = []
  const files = []
  let drm = false
  let pendingRange = null
  const lastEnd = new Map()
  let seg = 0
  let key = 0
  let map = 0
  const rangeOf = (spec, url) => {
    const [len, off] = String(spec).split("@").map(Number)
    const start = Number.isFinite(off) ? off : lastEnd.get(url) ?? 0
    lastEnd.set(url, start + len)
    return `bytes=${start}-${start + len - 1}`
  }
  for (const raw of lines) {
    const l = raw.trim()
    if (!l) continue
    if (l.startsWith("#EXT-X-KEY:") || l.startsWith("#EXT-X-SESSION-KEY:")) {
      const a = attrs(l.slice(l.indexOf(":") + 1))
      const method = String(a.METHOD || "NONE").toUpperCase()
      if (method === "NONE") {
        out.push(l)
        continue
      }
      // AES-128 は鍵がそのまま配られる通常の暗号化（DRM ではない）。それ以外（SAMPLE-AES・鍵の形式の指定）は DRM とみなす
      if (method !== "AES-128" || (a.KEYFORMAT && a.KEYFORMAT !== "identity")) {
        drm = true
        continue
      }
      const name = `key${key++}.bin`
      files.push({ url: resolve(a.URI, base), name })
      out.push(l.replace(/URI="[^"]*"/, `URI="${name}"`))
      continue
    }
    if (l.startsWith("#EXT-X-MAP:")) {
      const a = attrs(l.slice(11))
      const url = resolve(a.URI, base)
      const name = `map${map++}.mp4`
      files.push({ url, name, range: a.BYTERANGE ? rangeOf(a.BYTERANGE, url) : null })
      out.push(`#EXT-X-MAP:URI="${name}"`)
      continue
    }
    if (l.startsWith("#EXT-X-BYTERANGE:")) {
      pendingRange = l.slice(17)
      continue
    }
    if (l.startsWith("#")) {
      out.push(l)
      continue
    }
    const url = resolve(l, base)
    const name = `seg${String(seg++).padStart(5, "0")}.bin`
    files.push({ url, name, range: pendingRange ? rangeOf(pendingRange, url) : null, segment: true })
    pendingRange = null
    out.push(name)
  }
  return { playlist: out.join("\n") + "\n", files, drm, live: !lines.some((l) => l.trim() === "#EXT-X-ENDLIST") }
}

function safeName(title) {
  const t = String(title || "video").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 150)
  return t || "video"
}

function uniquePath(dir, base, ext) {
  let p = path.join(dir, `${base}.${ext}`)
  for (let i = 2; fs.existsSync(p); i++) p = path.join(dir, `${base} (${i}).${ext}`)
  return p
}

/**
 * @param {{ fetchInPage: (url: string, o?: { frameUrl?: string, range?: string }) => Promise<{ status: number, data: Buffer | null, contentType?: string | null, contentRange?: string | null }>,
 *           captureAndPlay?: (opts: any, onWaiting?: () => void) => Promise<{ stop: () => Promise<void>, state: () => Promise<any> }>,
 *           spawnFfmpeg: (args: string[]) => any, now?: () => number, idleMs?: number }} deps
 */
function createBrowserDownloader(deps) {
  const now = deps.now ?? (() => Date.now())

  /** yt-dlp の子プロセスと同じ形（stdout・stderr・close）で返す。止めるときは abort() */
  function start(job, settings) {
    const child = new EventEmitter()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    let aborted = false
    let finishNow = false
    let ff = null
    // 録画を「ここで終える」：それまでに記録した分で仕上げる
    child.finishNow = () => {
      finishNow = true
    }
    child.abort = () => {
      aborted = true
      try { ff?.kill() } catch { /* 終わっている */ }
    }
    const say = (line) => child.stdout.write(line + "\n")
    const fail = (msg) => child.stderr.write(`ERROR: ${msg}\n`)
    const dir = job.outputDir || settings.outputDir
    const work = path.join(dir, `.downlee-${job.id}`)

    const run = async () => {
      fs.mkdirSync(work, { recursive: true })
      if (job.via === "record") return runRecord()
      say("[browser] ブラウザ経由で取得します")
      const kind = job.sourceKind
      if (kind === "dash" || kind === "mss") throw new Error("この形式（DASH・Smooth Streaming）はブラウザ経由の取得に対応していません。")
      if (kind === "hls" || /\.m3u8(?:$|[?#])/i.test(job.url)) return runHls()
      return runFile()
    }

    const get = async (url, range) => {
      let last = null
      for (let attempt = 1; attempt <= 5; attempt++) {
        if (aborted) throw new Error("aborted")
        try {
          const r = await deps.fetchInPage(url, { frameUrl: job.url, range })
          if (r.data && r.status < 400) return r
          last = `HTTP Error ${r.status}`
          if (r.status === 404 || r.status === 410) break
        } catch (e) {
          last = e instanceof Error ? e.message : String(e)
          if (/専用ブラウザが閉じています/.test(last)) break
        }
        child.stderr.write(`[download] Got error: ${last}. Retrying (${attempt}/5)...\n`)
        await new Promise((r) => setTimeout(r, 1000 * attempt))
      }
      throw new Error(last || "取得できませんでした。")
    }

    async function runHls() {
      say("[generic] page: Downloading m3u8 information")
      const top = await get(job.url)
      const text = top.data.toString("utf8")
      let videoUrl = job.url
      let videoText = text
      let audioUrl = null
      if (/#EXT-X-STREAM-INF/.test(text)) {
        const pick = pickVariant(parseMaster(text, job.url), job.maxHeight)
        if (!pick) throw new Error("再生できる画質が見つかりません。")
        videoUrl = pick.video.url
        videoText = (await get(videoUrl)).data.toString("utf8")
        audioUrl = pick.audio?.url ?? null
      }
      const tracks = [{ name: "v", ...localizeMedia(videoText, videoUrl) }]
      if (audioUrl && job.mode !== "video-only") tracks.push({ name: "a", ...localizeMedia((await get(audioUrl)).data.toString("utf8"), audioUrl) })
      if (tracks.some((t) => t.drm)) throw new Error("DRM protected")
      const all = tracks.flatMap((t) => t.files.map((f) => ({ ...f, file: path.join(work, t.name, f.name) })))
      for (const t of tracks) {
        fs.mkdirSync(path.join(work, t.name), { recursive: true })
        fs.writeFileSync(path.join(work, t.name, "index.m3u8"), t.playlist)
      }
      const segs = all.filter((f) => f.segment).length
      say(`[hlsnative] Total fragments: ${segs}`)
      let done = 0
      let bytes = 0
      const t0 = now()
      const report = () => {
        const est = done ? Math.round((bytes / done) * all.length) : "NA"
        const secs = Math.max(0.001, (now() - t0) / 1000)
        const speed = bytes / secs
        const eta = done ? Math.round(((all.length - done) * secs) / done) : "NA"
        say(`${PROGRESS_PREFIX}downloading|${bytes}|NA|${est}|${Math.round(speed)}|${eta}|NA|NA|${done}|${all.length}`)
      }
      // 4 本まで同時に取る。取得済み（途中まで取った分の続き）は飛ばす
      let next = 0
      const worker = async () => {
        while (next < all.length) {
          const f = all[next++]
          if (aborted) return
          if (fs.existsSync(f.file) && fs.statSync(f.file).size > 0) {
            bytes += fs.statSync(f.file).size
          } else {
            const r = await get(f.url, f.range ?? undefined)
            fs.writeFileSync(f.file + ".tmp", r.data)
            fs.renameSync(f.file + ".tmp", f.file)
            bytes += r.data.length
          }
          done++
          report()
        }
      }
      await Promise.all(Array.from({ length: Math.min(4, Math.max(1, Number(settings.concurrentFragments) || 4)) }, worker))
      if (aborted) throw new Error("aborted")
      return mux(tracks.map((t) => path.join(work, t.name, "index.m3u8")))
    }

    /** 再生しながら記録：プレーヤーが受け取った断片をそのまま保存する（最高画質に固定して再生させる） */
    async function runRecord() {
      if (!deps.captureAndPlay) throw new Error("再生しながらの記録に対応していません。")
      say("[record] 再生しながら記録します（最高画質）")
      let videoUri = null
      let audioUri = null
      const tracks = []
      const byUrl = new Map()
      let total = 0
      let done = 0
      let bytes = 0
      let lastNew = now()
      const t0 = now()
      const report = () => {
        const secs = Math.max(0.001, (now() - t0) / 1000)
        say(`${PROGRESS_PREFIX}downloading|${bytes}|NA|${done ? Math.round((bytes / done) * total) : "NA"}|${Math.round(bytes / secs)}|NA|NA|NA|${done}|${total}`)
      }
      const onMaster = (url, text) => {
        if (!/^#EXTM3U/.test(text.trim())) return
        const lines = text.split(/\r?\n/)
        const uri = lines.filter((l) => l.trim() && !l.startsWith("#")).pop()
        videoUri = uri ? stripQuery(resolve(uri, url)) : null
        const a = /#EXT-X-MEDIA:[^\n]*TYPE=AUDIO[^\n]*URI="([^"]+)"/.exec(text)?.[1]
        audioUri = a ? stripQuery(resolve(a, url)) : null
      }
      const onPlaylist = (url, text) => {
        const bare = stripQuery(url)
        if (tracks.some((t) => t.bare === bare)) return
        const name = audioUri && bare === audioUri ? "a" : videoUri && bare === videoUri ? "v" : tracks.some((t) => t.name === "v") ? null : "v"
        if (!name || tracks.some((t) => t.name === name)) return
        const loc = localizeMedia(text, url)
        if (loc.drm) {
          drmSeen = true
          return
        }
        // ライブ配信は、プレーヤーが流し込むデータを写す方式で記録する
        if (loc.live) {
          liveSeen = true
          return
        }
        fs.mkdirSync(path.join(work, name), { recursive: true })
        fs.writeFileSync(path.join(work, name, "index.m3u8"), loc.playlist)
        tracks.push({ name, bare, ...loc })
        for (const f of loc.files) {
          const file = path.join(work, name, f.name)
          total++
          if (fs.existsSync(file) && fs.statSync(file).size > 0) {
            done++
            bytes += fs.statSync(file).size
            continue
          }
          const entry = { ...f, file }
          for (const k of [f.url, stripQuery(f.url)]) {
            if (!byUrl.has(k)) byUrl.set(k, [])
            byUrl.get(k).push(entry)
          }
        }
        say(`[hlsnative] Total fragments: ${total}`)
      }
      let drmSeen = false
      let liveSeen = false
      const take = (url) => {
        for (const k of [url, stripQuery(url)]) {
          const list = byUrl.get(k)
          const e = list?.find((x) => !x.written)
          if (e) return e
        }
        return null
      }
      const onBody = (url, data) => {
        const e = take(url)
        if (!e || !data?.length) return
        e.written = true
        fs.writeFileSync(e.file, data)
        done++
        bytes += data.length
        lastNew = now()
        report()
      }
      const wants = (url) => Boolean(take(url))
      const session = await deps.captureAndPlay({ maxHeight: job.maxHeight, onMaster, onPlaylist, onBody, wants }, () => say("[record] ページで動画の再生を始めてください"))
      // MediaSource に流し込まれたデータ（DASH・独自プレーヤー・ライブ配信）
      const mse = new Map()
      let mseBytes = 0
      const fmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`
      const pullMse = async () => {
        if (!session.drain) return null
        for (let guard = 0; guard < 20; guard++) {
          const r = await session.drain()
          if (!r) return null
          if (r.drm) throw new Error("DRM protected")
          for (const b of r.bufs) {
            if (!mse.has(b.i)) mse.set(b.i, { mime: b.mime, file: path.join(work, `mse${b.i}.${/webm/i.test(b.mime) ? "webm" : "mp4"}`) })
            fs.appendFileSync(mse.get(b.i).file, b.data)
            mseBytes += b.data.length
            lastNew = now()
          }
          if (!r.more) return r
        }
        return null
      }
      let mode = null
      try {
        const idle = deps.idleMs ?? 120_000
        for (;;) {
          if (aborted) throw new Error("aborted")
          if (drmSeen) throw new Error("DRM protected")
          const m = await pullMse()
          // HLS の断片を取れていればそちらを使う（元の断片そのもの）。ライブ配信・HLS 以外は流し込まれたデータを使う
          if (!mode && tracks.length && !liveSeen) mode = "hls"
          if (!mode && (liveSeen || (mseBytes > 0 && !tracks.length && now() - t0 > 8000))) mode = "mse"
          if (mode === "hls" && done >= total) break
          if (mode === "mse") {
            const live = !isFinite(m?.d ?? NaN)
            const pct = !live && m?.d ? Math.min(99, ((m.t ?? 0) / m.d) * 100) : "NA"
            if (live) say(`[record] ライブ配信を録画中 ${fmt(m?.t ?? 0)} · ${(mseBytes / 1048576).toFixed(1)} MB`)
            else say(`${PROGRESS_PREFIX}downloading|${mseBytes}|NA|${pct !== "NA" && pct > 0 ? Math.round((mseBytes * 100) / pct) : "NA"}|NA|NA|NA|NA|NA|NA`)
            if (m?.ended || finishNow) break
          }
          if (mode === "hls" && finishNow) throw new Error("断片の記録が途中です。HLS は最後まで記録してから仕上げます。")
          const st = mode === "mse" ? m : await session.state()
          if (st?.drm) throw new Error("DRM protected")
          const ended = st?.ended === true
          if (mode !== "mse" && ((ended && tracks.length) || now() - lastNew > idle)) {
            // 再生が終わった・しばらく増えない：残りはページの中から取ってみる
            const missing = [...new Set([...byUrl.values()].flat().filter((x) => !x.written))]
            for (const e of missing) {
              if (aborted) throw new Error("aborted")
              const r = await deps.fetchInPage(e.url, { frameUrl: job.url, range: e.range ?? undefined }).catch(() => null)
              if (r?.data && r.status < 400) onBody(e.url, r.data)
            }
            if (done < total || !tracks.length) {
              if (mseBytes > 0) {
                mode = "mse"
                break
              }
              throw new Error(tracks.length ? `記録できなかった断片が ${total - done} 個あります。もう一度保存すると、続きから記録します。` : "再生された動画のデータを受け取れませんでした。")
            }
            break
          }
          if (mode === "mse" && now() - lastNew > idle) break
          await new Promise((r) => setTimeout(r, 1000))
        }
        if (mode === "mse") await pullMse()
      } finally {
        await session.stop()
      }
      if (mode === "mse") {
        const inputs = [...mse.values()].sort((a, b) => (/^video/.test(a.mime) ? -1 : 1) - (/^video/.test(b.mime) ? -1 : 1)).map((x) => x.file).filter((f) => fs.existsSync(f) && fs.statSync(f).size > 0)
        if (!inputs.length) throw new Error("再生された動画のデータを受け取れませんでした。")
        return mux(inputs)
      }
      tracks.sort((a, b) => (a.name === "v" ? -1 : 1) - (b.name === "v" ? -1 : 1))
      return mux(tracks.map((t) => path.join(work, t.name, "index.m3u8")))
    }

    async function runFile() {
      say("[download] Destination: (ブラウザ経由)")
      const CHUNK = 8 * 1024 * 1024
      const tmp = path.join(work, "file.part")
      let have = fs.existsSync(tmp) ? fs.statSync(tmp).size : 0
      let total = null
      let type = null
      const t0 = now()
      const start = have
      for (;;) {
        const r = await get(job.url, `bytes=${have}-${have + CHUNK - 1}`)
        type ??= r.contentType
        total ??= Number(/\/(\d+)/.exec(r.contentRange || "")?.[1]) || null
        if (r.status === 200 && have > 0) {
          // 範囲指定に対応していないサーバー：最初から丸ごと受け取った
          fs.writeFileSync(tmp, r.data)
          have = r.data.length
          total = have
        } else {
          fs.appendFileSync(tmp, r.data)
          have += r.data.length
        }
        const secs = Math.max(0.001, (now() - t0) / 1000)
        say(`${PROGRESS_PREFIX}downloading|${have}|${total ?? "NA"}|NA|${Math.round((have - start) / secs)}|NA|NA|NA|NA|NA`)
        if (r.status === 200 || !total || have >= total || r.data.length === 0) break
      }
      const ext = (/\.(mp4|m4v|webm|mov|mkv|flv|ogv|mp3|m4a|aac|ogg|oga|opus|wav|flac)(?:$|[?#])/i.exec(job.url)?.[1] ?? (/webm/.test(type ?? "") ? "webm" : /audio\/mpeg/.test(type ?? "") ? "mp3" : /audio/.test(type ?? "") ? "m4a" : "mp4")).toLowerCase()
      const wantAudio = job.mode === "audio"
      if (!wantAudio && (job.container ?? "mp4") === ext) {
        const out = uniquePath(dir, safeName(job.title), ext)
        fs.renameSync(tmp, out)
        return out
      }
      return mux([tmp])
    }

    function mux(inputs) {
      const audioOnly = job.mode === "audio"
      const container = audioOnly ? (job.audioFormat === "mp3" ? "mp3" : "m4a") : job.container === "mkv" ? "mkv" : job.container === "webm" ? "mkv" : "mp4"
      const out = uniquePath(dir, safeName(job.title), container)
      const args = ["-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-stats"]
      for (const i of inputs) {
        if (i.endsWith(".m3u8")) args.push("-allowed_extensions", "ALL", "-protocol_whitelist", "file,crypto,data")
        args.push("-i", i)
      }
      if (audioOnly) {
        args.push("-vn", ...(container === "mp3" ? ["-c:a", "libmp3lame", "-b:a", settings.mp3Bitrate || "320K"] : ["-c:a", "copy"]))
      } else if (inputs.length > 1) {
        args.push("-map", "0:v:0?", "-map", "1:a:0?", "-c", "copy")
      } else {
        args.push("-c", "copy")
      }
      if (container === "mp4" || container === "m4a") args.push("-movflags", "+faststart")
      args.push(out)
      say(inputs.length > 1 ? "[Merger] 映像と音声を結合" : "[VideoRemuxer] 形式を整えています")
      return new Promise((ok, ng) => {
        ff = deps.spawnFfmpeg(args)
        let err = ""
        ff.stderr?.setEncoding?.("utf8")
        ff.stderr?.on("data", (d) => (err = (err + d).slice(-4000)))
        ff.on("error", ng)
        ff.on("close", (code) => {
          ff = null
          if (aborted) return ng(new Error("aborted"))
          if (code === 0 && fs.existsSync(out)) return ok(out)
          fs.rmSync(out, { force: true })
          ng(new Error(`ffmpeg でつなげませんでした。${err.trim().split("\n").pop() ?? ""}`))
        })
      })
    }

    setImmediate(() => {
      run()
        .then((out) => {
          say(`${FILE_PREFIX}${out}`)
          fs.rmSync(work, { recursive: true, force: true })
          end(0)
        })
        .catch((e) => {
          const msg = e instanceof Error ? e.message : String(e)
          // 一時停止のときは取得済みの断片を残す（続きから再開する）。それ以外の失敗でも残し、取り消し・削除で消える
          if (!aborted) fail(msg)
          end(1)
        })
    })
    const end = (code) => {
      child.stdout.end()
      child.stderr.end()
      setImmediate(() => child.emit("close", code))
    }
    return child
  }

  /** 途中までの取得を消す（中止・一覧から削除のとき） */
  function discard(job, settings) {
    const dir = job.outputDir || settings.outputDir
    if (dir && job.id) fs.rmSync(path.join(dir, `.downlee-${job.id}`), { recursive: true, force: true })
  }

  return { start, discard }
}

module.exports = { createBrowserDownloader, parseMaster, pickVariant, localizeMedia, safeName }
