/**
 * ［見つける］：Downlee 専用のブラウザ窓でページを開き、ページが読み込む動画・音声（mp4・HLS・DASH など）を拾う。
 * 専用の保存領域（persist:downlee-browser）を使うので、ここでログインした状態はふだんのブラウザと分かれる。
 * DRM で保護されたストリーム（EME / Widevine）は再生もダウンロードもしない。
 */
const { parseHls, parseDash, estimateSize } = require("./manifest.cjs")
const { startCapture, PLAY_SCRIPT, STATE_SCRIPT, DRAIN_SCRIPT } = require("./capture.cjs")

const MEDIA_EXT = /\.(m3u8|mpd|mp4|m4v|webm|mov|mkv|flv|f4v|ogv|mp3|m4a|aac|ogg|oga|opus|wav|flac)(?:$|[?#])/i
const SEGMENT = /\.(ts|m4s|aac|vtt|webvtt|key)(?:$|[?#])|\/(seg|segment|frag|fragment|chunk)[-_]?\d+/i
const MEDIA_TYPE = /^(video\/(?!mp2t)|audio\/|application\/(x-mpegurl|vnd\.apple\.mpegurl|dash\+xml|vnd\.ms-sstr\+xml))/i
/** 拡張子のないマニフェスト（?format=m3u8 や Smooth Streaming の .ism/Manifest など） */
const MANIFEST_HINT = /[?&](format|type|fmt|protocol)=(m3u8|hls|mpd|dash)\b|\.isml?\/manifest\b/i
/** Range をクエリで指定する配信（分割読み込み）。取り除くとファイル全体の URL になる */
const RANGE_PARAMS = ["range", "bytestart", "byteend", "rn", "rbuf"]
const RANGE_QUERY = /[?&](range|bytestart|byteend)=/i

function stripRange(url) {
  try {
    const u = new URL(url)
    for (const k of RANGE_PARAMS) u.searchParams.delete(k)
    return u.toString()
  } catch {
    return url
  }
}

/** 応答 1 件がメディアかを判定して、種類・大きさ・保存に使う URL を返す（純粋な処理。テストあり） */
function classifyResponse({ url, resourceType, contentType, contentLength, contentRange, statusCode }) {
  if (!/^https?:/i.test(url)) return null
  if (statusCode && statusCode >= 400) return null
  const type = String(contentType || "").split(";")[0].trim().toLowerCase()
  const byExt = MEDIA_EXT.exec(url)?.[1]?.toLowerCase()
  const hint = MANIFEST_HINT.exec(url)
  const hinted = hint ? (/isml?\/manifest/i.test(hint[0]) ? "mss" : /m3u8|hls/i.test(hint[2] ?? "") ? "hls" : "dash") : null
  const binary = !type || /octet-stream|^text\/plain$/.test(type)
  const kind =
    /mpegurl/.test(type) || byExt === "m3u8" ? "hls"
    : /dash\+xml/.test(type) || byExt === "mpd" ? "dash"
    : /ms-sstr/.test(type) ? "mss"
    : hinted && (binary || /xml|json|mpegurl/.test(type)) ? hinted
    : null
  const isManifest = kind !== null
  if (!isManifest && SEGMENT.test(url)) return null
  if (!isManifest && type === "video/mp2t") return null
  const isMedia = isManifest || MEDIA_TYPE.test(type) || resourceType === "media" || (byExt && !/^(text|image)\//.test(type) && type !== "text/html")
  if (!isMedia) return null
  const ranged = !isManifest && RANGE_QUERY.test(url)
  const finalKind = kind ?? (/^audio\//.test(type) || ["mp3", "m4a", "aac", "ogg", "oga", "opus", "wav", "flac"].includes(byExt) ? "audio" : "video")
  const total = /\/(\d+)\s*$/.exec(String(contentRange || ""))?.[1]
  // 分割読み込みの 1 片の大きさはファイルの大きさではない
  // マニフェストの大きさは動画の容量ではないので出さない（あとで中身から見積もる）
  const size = isManifest ? null : Number(total ?? (ranged || contentRange ? undefined : contentLength)) || null
  // ごく小さいファイル（広告のビーコン・効果音など）は拾わない（全体の大きさがわからない分割読み込みは拾う）
  if (!isManifest && size !== null && size < 100 * 1024) return null
  return { kind: finalKind, contentType: type || null, size, url: ranged ? stripRange(url) : url }
}

/** 同じメディアを 1 つにまとめるためのキー（Range 指定などの違いは無視する） */
function mediaKey(url) {
  try {
    const u = new URL(url)
    for (const k of ["range", "rn", "rbuf", "bytestart", "byteend", "_", "t", "cb", "sq"]) u.searchParams.delete(k)
    return `${u.origin}${u.pathname}?${[...u.searchParams.keys()].sort().join("&")}`
  } catch {
    return url
  }
}

function isBlocked(url, blockedText) {
  const list = String(blockedText || "").split(/[\s,]+/).map((d) => d.trim().toLowerCase()).filter(Boolean)
  if (!list.length) return false
  try {
    const host = new URL(url).hostname.toLowerCase()
    return list.some((d) => host === d || host.endsWith(`.${d}`))
  } catch {
    return false
  }
}

/** Electron の cookie を yt-dlp が読める Netscape 形式にする */
function toNetscapeCookies(cookies) {
  const lines = ["# Netscape HTTP Cookie File", "# Downlee が一時的に書き出したファイルです。ダウンロード後に削除します。", ""]
  for (const c of cookies) {
    const domain = c.domain || ""
    const include = domain.startsWith(".") ? "TRUE" : "FALSE"
    const expiry = c.expirationDate ? Math.round(c.expirationDate) : 0
    const name = String(c.name).replace(/[\t\n]/g, "")
    const value = String(c.value).replace(/[\t\n]/g, "")
    lines.push([c.httpOnly ? `#HttpOnly_${domain}` : domain, include, c.path || "/", c.secure ? "TRUE" : "FALSE", String(expiry), name, value].join("\t"))
  }
  return lines.join("\n") + "\n"
}

/** ダウンロードに引き継ぐリクエストヘッダー（cookie は別の一時ファイルで渡す。Range などは渡さない） */
const KEEP_HEADER = /^(origin|referer|authorization|x-[\w-]+)$/i
function pickHeaders(requestHeaders) {
  const out = {}
  for (const [k, v] of Object.entries(requestHeaders ?? {})) {
    if (!KEEP_HEADER.test(k) || /^x-(client-data|requested-with)$/i.test(k)) continue
    out[k] = String(v)
  }
  return out
}

/** ページの中の動画からサムネイルの候補を集める（いちばん大きく表示されている動画） */
const SNAP_SCRIPT = `(() => {
  const vids = [...document.querySelectorAll("video")].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)
  const v = vids[0]
  let frame = null
  if (v && v.readyState >= 2 && v.videoWidth && v.currentTime > 0.3) {
    try {
      const c = document.createElement("canvas")
      c.width = 320
      c.height = Math.round((320 * v.videoHeight) / v.videoWidth)
      c.getContext("2d").drawImage(v, 0, 0, c.width, c.height)
      frame = c.toDataURL("image/jpeg", 0.8)
    } catch {}
  }
  const meta = (s) => document.querySelector(s)?.content || null
  return { area: v ? v.clientWidth * v.clientHeight : 0, frame, poster: v?.poster || null, og: meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]') }
})()`

function createSniffer({ BrowserWindow, session, nativeImage, getSettings, onFound, onState, iconPath, randomUUID, adblock }) {
  const ses = session.fromPartition("persist:downlee-browser")
  let win = null
  const found = new Map()
  let pageTitle = ""
  // ページを移るたびに増える番号。SPA で URL だけ変わっても同じページの分として扱う
  let nav = 0
  // メディアの URL ごとに、ブラウザが送ったヘッダー（Origin・Authorization など）。メモリーにだけ置く
  const sentHeaders = new Map()
  // 自分で調べに行く通信（容量の確認など）。一覧には出さない
  const probing = new Set()
  // master の HLS に含まれる画質ごとのプレイリスト。master にまとめて、別には並べない
  const variants = new Set()
  const thumbs = new Map()

  const emit = () => onFound([...found.values()])

  // メディアを読み込んだ枠（iframe の中の再生プレーヤーなど）。ブラウザ経由で取得するときに同じ枠から取りに行く
  const frames = new Map()

  ses.webRequest.onSendHeaders((details) => {
    if (!MEDIA_EXT.test(details.url) && !MANIFEST_HINT.test(details.url) && !RANGE_QUERY.test(details.url)) return
    if (details.frame) {
      frames.set(mediaKey(details.url), details.frame)
      if (frames.size > 500) frames.delete(frames.keys().next().value)
    }
    const h = pickHeaders(details.requestHeaders)
    // Origin・Referer はこの段階のヘッダーに入らないので、読み込んだページ（枠）の URL から付け直す
    if (details.referrer && /^https?:/i.test(details.referrer)) {
      h.Referer ??= details.referrer
      try {
        const from = new URL(details.referrer).origin
        if (details.resourceType === "xhr" && from !== new URL(details.url).origin) h.Origin ??= from
      } catch {
        /* URL でなければ付けない */
      }
    }
    if (!Object.keys(h).length) return
    sentHeaders.set(mediaKey(details.url), h)
    if (sentHeaders.size > 500) sentHeaders.delete(sentHeaders.keys().next().value)
  })

  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === "fullscreen"))

  ses.webRequest.onResponseStarted((details) => {
    if (!win || win.isDestroyed()) return
    // Service Worker 経由の読み込みは webContentsId を持たない。専用の保存領域なので、ほかの窓の分は来ない
    if (details.webContentsId != null && details.webContentsId !== win.webContents.id) return
    const header = (name) => {
      const h = details.responseHeaders ?? {}
      const key = Object.keys(h).find((k) => k.toLowerCase() === name)
      return key ? [].concat(h[key])[0] : undefined
    }
    if (probing.has(details.url)) return
    const hit = classifyResponse({ url: details.url, resourceType: details.resourceType, contentType: header("content-type"), contentLength: header("content-length"), contentRange: header("content-range"), statusCode: details.statusCode })
    if (!hit) return
    const pageUrl = win.webContents.getURL()
    if (isBlocked(details.url, getSettings().blockedDomains) || isBlocked(pageUrl, getSettings().blockedDomains)) return
    // 広告のリストに当たるメディア（動画広告など）は印を付けて、ふだんは隠す（誤判定でも［すべて］で見られる）
    const ad = Boolean(getSettings().adBlock && adblock?.isAd(details.url, pageUrl))
    const key = mediaKey(hit.url)
    if (variants.has(key)) return
    const prev = found.get(key)
    const item = {
      id: prev?.id ?? randomUUID(),
      url: hit.url,
      pageUrl,
      nav,
      ad,
      pageTitle: win.webContents.getTitle() || pageTitle,
      kind: hit.kind,
      contentType: hit.contentType,
      size: hit.size ?? prev?.size ?? null,
      sizeApprox: hit.size ? false : prev?.sizeApprox ?? false,
      duration: prev?.duration ?? null,
      height: prev?.height ?? null,
      thumbnail: prev?.thumbnail ?? thumbs.get(nav)?.url ?? null,
      at: prev?.at ?? new Date().toISOString(),
    }
    found.set(key, item)
    emit()
    if (!prev) void probe(key)
    if (!item.thumbnail) scheduleThumb(nav)
  })

  /* ---- 容量・長さ・画質を調べる ---- */

  /**
   * 調べるための取得。ブラウザが送ったヘッダー・cookie・Referer をそろえて Node の fetch で取る
   * （Chromium の fetch では Referer を付けられず、Origin を付けると cookie が送られないため）。だめならセッションの fetch で取り直す。
   */
  async function get(url, item, init = {}) {
    probing.add(url)
    try {
      const headers = { ...(sentHeaders.get(mediaKey(url)) ?? sentHeaders.get(mediaKey(item.url)) ?? {}), "User-Agent": ses.getUserAgent(), ...(init.headers ?? {}) }
      if (!Object.keys(headers).some((k) => k.toLowerCase() === "referer") && item.pageUrl) headers.Referer = item.pageUrl
      const cookies = await ses.cookies.get({ url }).catch(() => [])
      if (cookies.length) headers.Cookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ")
      try {
        return await fetch(url, { ...init, headers, signal: AbortSignal.timeout(15000) })
      } catch {
        const { Referer: _r, Cookie: _c, ...rest } = headers
        return await ses.fetch(url, { ...init, headers: rest, signal: AbortSignal.timeout(15000) })
      }
    } finally {
      setTimeout(() => probing.delete(url), 30000)
    }
  }

  async function probe(key) {
    const item = found.get(key)
    if (!item || !ses.fetch) return
    try {
      let info = null
      if (item.kind === "hls") {
        const root = parseHls(await (await get(item.url, item)).text(), item.url)
        if (root?.type === "master") {
          for (const v of root.variants) {
            const k = mediaKey(v.url)
            variants.add(k)
            if (found.delete(k)) emit()
          }
          for (const a of root.audio) variants.add(mediaKey(a))
          const best = root.variants[0]
          const media = parseHls(await (await get(best.url, item)).text(), best.url)
          const duration = media?.type === "media" && !media.live ? media.duration : null
          info = { height: best.height, duration, size: media?.bytes ?? estimateSize(best.bandwidth, duration) }
        } else if (root?.type === "media") {
          let size = root.bytes
          if (!size && root.firstSegment && root.segments && !root.live) {
            const head = await get(root.firstSegment, item, { method: "HEAD" })
            const one = Number(head.headers.get("content-length")) || 0
            if (one) size = one * root.segments
          }
          info = { duration: root.live ? null : root.duration, size }
        }
      } else if (item.kind === "dash") {
        const d = parseDash(await (await get(item.url, item)).text())
        if (d) info = { duration: d.duration, height: d.height, size: d.size }
      } else if (item.size === null) {
        const res = await get(item.url, item, { headers: { Range: "bytes=0-0" } })
        const total = Number(/\/(\d+)/.exec(res.headers.get("content-range") || "")?.[1]) || null
        void res.body?.cancel().catch(() => undefined)
        if (total) info = { size: total, exact: true }
      }
      const cur = found.get(key)
      if (!cur || !info) return
      found.set(key, { ...cur, duration: info.duration ?? cur.duration, height: info.height ?? cur.height, size: cur.size ?? info.size ?? null, sizeApprox: cur.size ? cur.sizeApprox : Boolean(info.size && !info.exact) })
      emit()
    } catch (e) {
      /* 調べられないときは容量を出さない */
      if (process.env.DOWNLEE_DEBUG) console.error("probe", e)
    }
  }

  /* ---- サムネイル（ページを移るごとに 1 枚） ---- */

  const thumbTimers = new Map()
  function scheduleThumb(n, attempt = 0) {
    if (thumbTimers.has(n) || thumbs.get(n)?.strong) return
    const delay = [1500, 5000, 12000][attempt]
    if (delay === undefined) return
    thumbTimers.set(n, setTimeout(() => {
      thumbTimers.delete(n)
      void captureThumb(n, attempt)
    }, delay))
  }

  async function imageToDataUrl(url, pageUrl) {
    const res = await get(url, { url, pageUrl })
    if (!res.ok) return null
    const img = nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer()))
    if (img.isEmpty()) return null
    return `data:image/jpeg;base64,${img.resize({ width: 320, quality: "good" }).toJPEG(80).toString("base64")}`
  }

  async function captureThumb(n, attempt) {
    if (!win || win.isDestroyed() || n !== nav || !nativeImage) return
    const wc = win.webContents
    const pageUrl = wc.getURL()
    const frames = wc.mainFrame?.framesInSubtree ?? [wc.mainFrame]
    const snaps = []
    for (const f of frames) {
      try {
        const r = await Promise.race([f.executeJavaScript(SNAP_SCRIPT), new Promise((ok) => setTimeout(() => ok(null), 2000))])
        if (r) snaps.push(r)
      } catch {
        /* 読めない枠は飛ばす */
      }
    }
    snaps.sort((a, b) => b.area - a.area)
    let url = snaps.find((x) => x.frame)?.frame ?? null
    let strong = Boolean(url)
    for (const cand of [snaps.find((x) => x.poster)?.poster, snaps.find((x) => x.og)?.og]) {
      if (url || !cand || !/^https?:/i.test(cand)) continue
      try {
        url = await imageToDataUrl(cand, pageUrl)
        strong = Boolean(url)
      } catch {
        /* 次の候補へ */
      }
    }
    // 最後の手段：ページの見た目を縮めて使う
    if (!url && attempt >= 2 && !win.isMinimized()) {
      const img = await wc.capturePage().catch(() => null)
      if (img && !img.isEmpty()) url = `data:image/jpeg;base64,${img.resize({ width: 320, quality: "good" }).toJPEG(75).toString("base64")}`
    }
    if (n !== nav) return
    if (url) {
      thumbs.set(n, { url, strong })
      if (thumbs.size > 50) thumbs.delete(thumbs.keys().next().value)
      let changed = false
      for (const [k, it] of found) {
        if (it.nav === n && !it.thumbnail) {
          found.set(k, { ...it, thumbnail: url })
          changed = true
        }
      }
      if (changed) emit()
    }
    if (!strong) scheduleThumb(n, attempt + 1)
  }

  function state() {
    if (!win || win.isDestroyed()) return { open: false }
    const wc = win.webContents
    return { open: true, nav, url: wc.getURL(), title: wc.getTitle(), canGoBack: wc.navigationHistory.canGoBack(), canGoForward: wc.navigationHistory.canGoForward(), loading: wc.isLoading() }
  }

  /** 広告ブロックと拡張機能を設定に合わせる。戻り値は拡張機能ごとの状態 */
  async function applySettings() {
    const s = getSettings()
    await adblock?.apply(ses, s.adBlock !== false)
    return syncExtensions(Array.isArray(s.extensions) ? s.extensions : [])
  }

  const extErrors = new Map()
  async function syncExtensions(paths) {
    const api = ses.extensions ?? ses
    const loaded = api.getAllExtensions()
    for (const ext of loaded) if (!paths.includes(ext.path)) api.removeExtension(ext.id)
    for (const p of paths) {
      if (loaded.some((e) => e.path === p)) continue
      try {
        await api.loadExtension(p, { allowFileAccess: false })
        extErrors.delete(p)
      } catch (e) {
        extErrors.set(p, e instanceof Error ? e.message : String(e))
      }
    }
    return extensions()
  }

  function extensions() {
    const api = ses.extensions ?? ses
    const loaded = api.getAllExtensions()
    const paths = Array.isArray(getSettings().extensions) ? getSettings().extensions : []
    return paths.map((p) => {
      const e = loaded.find((x) => x.path === p)
      return { path: p, name: e?.name ?? p.split(/[\\/]/).pop(), version: e?.version ?? null, loaded: Boolean(e), error: e ? null : extErrors.get(p) ?? null }
    })
  }

  let ready = null
  async function open(url) {
    ready ??= applySettings().catch(() => undefined)
    await ready
    const target = normalizeUrl(url)
    if (win && !win.isDestroyed()) {
      if (target) void win.loadURL(target)
      win.show()
      win.focus()
      return state()
    }
    win = new BrowserWindow({
      width: 1280,
      height: 820,
      title: "Downlee ブラウザ",
      icon: iconPath,
      autoHideMenuBar: true,
      // 録画中に窓が隠れても再生を止めない
      webPreferences: { session: ses, contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false, backgroundThrottling: false },
    })
    win.setMenuBarVisibility(false)
    const wc = win.webContents
    wc.setWindowOpenHandler(({ url: next }) => {
      // ポップアップは同じ窓で開く（広告の別窓は増やさない）
      if (/^https?:/i.test(next)) void wc.loadURL(next)
      return { action: "deny" }
    })
    wc.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown") return
      if (input.alt && input.key === "ArrowLeft" && wc.navigationHistory.canGoBack()) { wc.navigationHistory.goBack(); event.preventDefault() }
      else if (input.alt && input.key === "ArrowRight" && wc.navigationHistory.canGoForward()) { wc.navigationHistory.goForward(); event.preventDefault() }
      else if (input.key === "F5") { wc.reload(); event.preventDefault() }
    })
    const push = () => onState(state())
    wc.on("did-navigate", () => {
      pageTitle = ""
      nav++
      push()
    })
    wc.on("did-navigate-in-page", push)
    wc.on("page-title-updated", (_e, t) => {
      pageTitle = t
      win?.setTitle(`${t} - Downlee ブラウザ`)
      push()
    })
    wc.on("did-start-loading", push)
    wc.on("did-stop-loading", push)
    win.on("closed", () => {
      win = null
      onState({ open: false })
    })
    void win.loadURL(target || "https://www.google.com/")
    return state()
  }

  function control(action) {
    if (!win || win.isDestroyed()) return state()
    const wc = win.webContents
    if (action === "back" && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
    else if (action === "forward" && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
    else if (action === "reload") wc.reload()
    else if (action === "close") win.close()
    else if (action === "focus") { win.show(); win.focus() }
    return state()
  }

  function list() {
    return [...found.values()]
  }

  function clear() {
    found.clear()
    onFound([])
  }

  /** いま使える枠（メディアを読み込んだ枠。なくなっていればページ全体） */
  function frameFor(url) {
    if (!win || win.isDestroyed()) return null
    const f = url ? frames.get(mediaKey(url)) : null
    try {
      if (f && !f.isDestroyed?.() && !f.detached && f.url) return f
    } catch {
      /* 枠が消えている */
    }
    return win.webContents.mainFrame
  }

  /**
   * 専用ブラウザのページの中から取得する（再生プレーヤーと同じ枠・同じ cookie・同じ通信で取りに行く）。
   * 戻り値：{ status, data: Buffer, contentType, contentRange }
   */
  // 取得に成功した枠を覚えておく（同じ動画の断片は同じ枠から取る）
  const workingFrame = new Map()

  function allFrames() {
    if (!win || win.isDestroyed()) return []
    try {
      return win.webContents.mainFrame.framesInSubtree.filter((f) => /^https?:/i.test(f.url))
    } catch {
      return [win.webContents.mainFrame]
    }
  }

  /**
   * 専用ブラウザのページの中から取得する（再生プレーヤーと同じ枠・同じ cookie・同じ通信で取りに行く）。
   * 1. 前に取れた枠 → メディアを読み込んだ枠 → ほかの枠（iframe の再生プレーヤーなど）の順に試す
   * 2. どの枠でもだめなら、ブラウザが送ったヘッダー・cookie・Referer を付けて取る
   * 戻り値：{ status, data: Buffer, contentType, contentRange }
   */
  async function fetchInPage(url, { frameUrl, range } = {}) {
    if (!win || win.isDestroyed()) throw new Error("専用ブラウザが閉じています。［見つける］でページを開いたまま、もう一度保存してください。")
    const key = mediaKey(frameUrl ?? url)
    const known = frameFor(frameUrl ?? url)
    const remembered = workingFrame.get(key)
    const candidates = [...new Set([remembered, known !== win.webContents.mainFrame ? known : null, ...allFrames().reverse(), win.webContents.mainFrame].filter(Boolean))]
    const code = `(async () => {
      const opts = ${JSON.stringify(range ? { headers: { Range: range } } : {})}
      let r
      try { r = await fetch(${JSON.stringify(url)}, opts) } catch (e) { r = null }
      // 拒まれたら cookie を付けて取り直す（プレーヤーが cookie 付きで取っている配信）
      if (!r || !r.ok) { try { r = await fetch(${JSON.stringify(url)}, { ...opts, credentials: "include" }) } catch (e) { if (!r) throw e } }
      if (!r.ok) return { status: r.status }
      const b = new Uint8Array(await r.arrayBuffer())
      let s = ""
      for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000))
      return { status: r.status, data: btoa(s), contentType: r.headers.get("content-type"), contentRange: r.headers.get("content-range") }
    })()`
    let lastStatus = 0
    for (const frame of candidates) {
      let r
      try {
        r = await frame.executeJavaScript(code)
      } catch {
        continue // CORS などでこの枠からは取れない
      }
      if (r && r.data != null) {
        workingFrame.set(key, frame)
        if (workingFrame.size > 200) workingFrame.delete(workingFrame.keys().next().value)
        return { status: r.status, data: Buffer.from(r.data, "base64"), contentType: r.contentType ?? null, contentRange: r.contentRange ?? null }
      }
      lastStatus = r?.status ?? lastStatus
    }
    // ページの中から取れないとき：枠の URL を Referer にして、ブラウザが送ったヘッダー・cookie を付けて取る
    const ref = (remembered ?? known)?.url
    const res = await get(url, { url: frameUrl ?? url, pageUrl: /^https?:/i.test(ref || "") ? ref : win.webContents.getURL() }, { headers: range ? { Range: range } : {} })
    if (!res.ok) return { status: res.status || lastStatus, data: null }
    return { status: res.status, data: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type"), contentRange: res.headers.get("content-range") }
  }

  /**
   * 再生しながら記録：通信の写し取りを始めてからページを読み直し、いちばん大きい動画を再生させる。
   * 戻り値：{ stop, state }（state はいちばん大きい動画の再生位置。DRM なら { drm: true }）
   */
  async function captureAndPlay(opts, onWaiting) {
    if (!win || win.isDestroyed()) throw new Error("専用ブラウザが閉じています。［見つける］で動画のページを開いたまま、もう一度保存してください。")
    const wc = win.webContents
    const cap = await startCapture(wc, opts)
    try {
      await new Promise((ok) => {
        const t = setTimeout(ok, 20000)
        wc.once("did-finish-load", () => {
          clearTimeout(t)
          ok()
        })
        wc.reload()
      })
      let frame = null
      for (let i = 0; i < 120 && !frame; i++) {
        for (const f of allFrames().reverse()) {
          const r = await f.executeJavaScript(PLAY_SCRIPT, true).catch(() => "none")
          if (r === "drm") throw new Error("DRM protected")
          if (r !== "none") {
            frame = f
            break
          }
        }
        if (!frame) {
          if (i === 5) onWaiting?.()
          await new Promise((ok) => setTimeout(ok, 1000))
        }
      }
      if (!frame) throw new Error("ページに動画が見つかりません。専用ブラウザで動画を再生してから、もう一度保存してください。")
      return {
        stop: () => cap.stop(),
        state: () => frame.executeJavaScript(STATE_SCRIPT).catch(() => null),
        // プレーヤーが流し込んだデータ（MediaSource）を受け取る
        drain: async () => {
          const r = await frame.executeJavaScript(DRAIN_SCRIPT).catch(() => null)
          if (!r) return null
          return { ...r, bufs: r.bufs.map((b) => ({ ...b, data: Buffer.from(b.data, "base64") })) }
        },
      }
    } catch (e) {
      await cap.stop()
      throw e
    }
  }

  function isOpen() {
    return Boolean(win && !win.isDestroyed())
  }

  /** ダウンロードに引き継ぐヘッダー（見つけたときにブラウザが送ったもの） */
  function headersFor(url) {
    return { ...(sentHeaders.get(mediaKey(url)) ?? {}) }
  }

  /** この URL に送られる cookie を Netscape 形式で返す（ダウンロード 1 件のための一時ファイル用） */
  async function cookiesFor(...urls) {
    try {
      const domains = new Set()
      for (const u of urls.filter(Boolean)) {
        const parts = new URL(u).hostname.split(".")
        for (let i = 0; i < parts.length - 1; i++) domains.add(parts.slice(i).join("."))
      }
      const all = []
      for (const d of domains) all.push(...(await ses.cookies.get({ domain: d })))
      const uniq = new Map(all.map((c) => [`${c.domain}|${c.path}|${c.name}`, c]))
      return uniq.size ? toNetscapeCookies([...uniq.values()]) : null
    } catch {
      return null
    }
  }

  async function clearData() {
    await ses.clearStorageData()
    await ses.clearCache()
  }

  return { open, control, state, list, clear, cookiesFor, headersFor, fetchInPage, captureAndPlay, isOpen, clearData, applySettings, extensions, userAgent: () => ses.getUserAgent() }
}

function normalizeUrl(input) {
  const v = String(input || "").trim()
  if (!v) return ""
  if (/^https?:\/\//i.test(v)) return v
  if (/^[\w-]+(\.[\w-]+)+(\/|$)/.test(v)) return `https://${v}`
  return `https://www.google.com/search?q=${encodeURIComponent(v)}`
}

module.exports = { createSniffer, classifyResponse, mediaKey, isBlocked, toNetscapeCookies, normalizeUrl }
