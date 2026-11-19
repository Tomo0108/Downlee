/**
 * ［見つける］：Downlee 専用のブラウザ窓でページを開き、ページが読み込む動画・音声（mp4・HLS・DASH など）を拾う。
 * 専用の保存領域（persist:downlee-browser）を使うので、ここでログインした状態はふだんのブラウザと分かれる。
 * DRM で保護されたストリーム（EME / Widevine）は再生もダウンロードもしない。
 */
const MEDIA_EXT = /\.(m3u8|mpd|mp4|m4v|webm|mov|mkv|flv|f4v|ogv|mp3|m4a|aac|ogg|oga|opus|wav|flac)(?:$|[?#])/i
const SEGMENT = /\.(ts|m4s|aac|vtt|webvtt|key)(?:$|[?#])|\/(seg|segment|frag|fragment|chunk)[-_]?\d+|[?&](range|bytestart|byteend)=/i
const MEDIA_TYPE = /^(video\/(?!mp2t)|audio\/|application\/(x-mpegurl|vnd\.apple\.mpegurl|dash\+xml|vnd\.ms-sstr\+xml))/i

/** 応答 1 件がメディアかを判定して、種類・大きさを返す（純粋な処理。テストあり） */
function classifyResponse({ url, resourceType, contentType, contentLength, contentRange, statusCode }) {
  if (!/^https?:/i.test(url)) return null
  if (statusCode && statusCode >= 400) return null
  const type = String(contentType || "").split(";")[0].trim().toLowerCase()
  const byExt = MEDIA_EXT.exec(url)?.[1]?.toLowerCase()
  const isManifest = /mpegurl/.test(type) || byExt === "m3u8" || /dash\+xml/.test(type) || byExt === "mpd" || /ms-sstr/.test(type)
  if (!isManifest && SEGMENT.test(url)) return null
  if (!isManifest && type === "video/mp2t") return null
  const isMedia = isManifest || MEDIA_TYPE.test(type) || resourceType === "media" || (byExt && !/^(text|image)\//.test(type) && type !== "text/html")
  if (!isMedia) return null
  const kind = /mpegurl/.test(type) || byExt === "m3u8" ? "hls" : /dash\+xml/.test(type) || byExt === "mpd" ? "dash" : /ms-sstr/.test(type) ? "mss" : /^audio\//.test(type) || ["mp3", "m4a", "aac", "ogg", "oga", "opus", "wav", "flac"].includes(byExt) ? "audio" : "video"
  const total = /\/(\d+)\s*$/.exec(String(contentRange || ""))?.[1]
  const size = Number(total ?? contentLength) || null
  // ごく小さいファイル（広告のビーコン・効果音など）は拾わない
  if ((kind === "video" || kind === "audio") && size !== null && size < 100 * 1024) return null
  return { kind, contentType: type || null, size }
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

function createSniffer({ BrowserWindow, session, getSettings, onFound, onState, iconPath, randomUUID, adblock }) {
  const ses = session.fromPartition("persist:downlee-browser")
  let win = null
  const found = new Map()
  let pageTitle = ""

  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === "fullscreen"))

  ses.webRequest.onResponseStarted((details) => {
    if (!win || win.isDestroyed() || details.webContentsId !== win.webContents.id) return
    const header = (name) => {
      const h = details.responseHeaders ?? {}
      const key = Object.keys(h).find((k) => k.toLowerCase() === name)
      return key ? [].concat(h[key])[0] : undefined
    }
    const hit = classifyResponse({ url: details.url, resourceType: details.resourceType, contentType: header("content-type"), contentLength: header("content-length"), contentRange: header("content-range"), statusCode: details.statusCode })
    if (!hit) return
    const pageUrl = win.webContents.getURL()
    if (isBlocked(details.url, getSettings().blockedDomains) || isBlocked(pageUrl, getSettings().blockedDomains)) return
    // 広告のリストに当たるメディア（動画広告など）は並べない
    if (getSettings().adBlock && adblock?.isAd(details.url, pageUrl)) return
    const key = mediaKey(details.url)
    const prev = found.get(key)
    const item = {
      id: prev?.id ?? randomUUID(),
      url: details.url,
      pageUrl,
      pageTitle: win.webContents.getTitle() || pageTitle,
      kind: hit.kind,
      contentType: hit.contentType,
      size: hit.size ?? prev?.size ?? null,
      at: prev?.at ?? new Date().toISOString(),
    }
    found.set(key, item)
    onFound([...found.values()])
  })

  function state() {
    if (!win || win.isDestroyed()) return { open: false }
    const wc = win.webContents
    return { open: true, url: wc.getURL(), title: wc.getTitle(), canGoBack: wc.navigationHistory.canGoBack(), canGoForward: wc.navigationHistory.canGoForward(), loading: wc.isLoading() }
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
      webPreferences: { session: ses, contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
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

  /** この URL に送られる cookie を Netscape 形式で返す（ダウンロード 1 件のための一時ファイル用） */
  async function cookiesFor(url) {
    try {
      const host = new URL(url).hostname
      const parts = host.split(".")
      const domains = new Set()
      for (let i = 0; i < parts.length - 1; i++) domains.add(parts.slice(i).join("."))
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

  return { open, control, state, list, clear, cookiesFor, clearData, applySettings, extensions, userAgent: () => ses.getUserAgent() }
}

function normalizeUrl(input) {
  const v = String(input || "").trim()
  if (!v) return ""
  if (/^https?:\/\//i.test(v)) return v
  if (/^[\w-]+(\.[\w-]+)+(\/|$)/.test(v)) return `https://${v}`
  return `https://www.google.com/search?q=${encodeURIComponent(v)}`
}

module.exports = { createSniffer, classifyResponse, mediaKey, isBlocked, toNetscapeCookies, normalizeUrl }
