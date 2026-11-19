/**
 * 再生しながら記録：専用ブラウザの再生プレーヤーが受け取ったデータ（HLS の断片）を、そのまま写し取る。
 * Chromium の開発者向けの仕組み（DevTools Protocol）で通信の中身を読む。画質の作り直しはしない。
 * - master の HLS を、いちばん高い画質だけにして渡す（プレーヤーが最高画質で再生する）
 * - プレーヤーが取った断片・鍵・初期化データを保存する
 * DRM（EME）で保護された再生は対象外（データは暗号化されたままで、解除もしない）。
 */

/** master の HLS を、選んだ 1 つの画質（とその音声）だけにする。master でなければ null */
function filterMaster(text, maxHeight) {
  const lines = String(text || "").split(/\r?\n/)
  if (!lines.some((l) => l.startsWith("#EXT-X-STREAM-INF:"))) return null
  const variants = []
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("#EXT-X-STREAM-INF:")) continue
    let j = i + 1
    while (j < lines.length && (!lines[j].trim() || lines[j].startsWith("#"))) j++
    const head = lines[i]
    const res = /RESOLUTION=(\d+)x(\d+)/.exec(head)
    variants.push({ head, uri: lines[j], height: res ? Number(res[2]) : 0, bandwidth: Number(/[:,]BANDWIDTH=(\d+)/.exec(head)?.[1]) || 0, audio: /AUDIO="([^"]*)"/.exec(head)?.[1] ?? null })
  }
  const limit = Number(maxHeight) || 0
  const sorted = variants.sort((a, b) => b.height - a.height || b.bandwidth - a.bandwidth)
  const best = (limit ? sorted.find((v) => !v.height || v.height <= limit) : null) ?? sorted[0]
  if (!best) return null
  const out = []
  for (const l of lines) {
    if (l.startsWith("#EXT-X-STREAM-INF:") || l.startsWith("#EXT-X-I-FRAME-STREAM-INF:")) continue
    if (l.startsWith("#EXT-X-MEDIA:") && /TYPE=AUDIO/.test(l) && best.audio && !l.includes(`GROUP-ID="${best.audio}"`)) continue
    if (l.startsWith("#EXT-X-MEDIA:") && /TYPE=(VIDEO|SUBTITLES|CLOSED-CAPTIONS)/.test(l)) continue
    if (!l.startsWith("#") && l.trim()) continue // 画質ごとの URI はあとで 1 つだけ足す
    out.push(l)
  }
  while (out.length && !out[out.length - 1].trim()) out.pop()
  out.push(best.head.replace(/,?(VIDEO|SUBTITLES|CLOSED-CAPTIONS)="[^"]*"/g, ""), best.uri)
  return { text: out.join("\n") + "\n", height: best.height }
}

const stripQuery = (u) => String(u).split(/[?#]/)[0]

/**
 * @param {any} wc 専用ブラウザの webContents
 * @param {{ maxHeight?: number, onMaster?: (url: string, text: string) => void, onPlaylist: (url: string, text: string) => void, onBody: (url: string, data: Buffer) => void, wants: (url: string) => boolean }} o
 */
async function startCapture(wc, o) {
  const dbg = wc.debugger
  let attachedHere = false
  if (!dbg.isAttached()) {
    dbg.attach("1.3")
    attachedHere = true
  }
  // 最上位のページの通知は sessionId が空文字で届く。空のまま渡すと失敗するので undefined にする
  const send = (method, params = {}, sessionId) => (sessionId ? dbg.sendCommand(method, params, sessionId) : dbg.sendCommand(method, params))
  const pending = new Map() // requestId|session → url
  const sessions = new Set([undefined])

  async function setup(sessionId) {
    await send("Network.enable", { maxResourceBufferSize: 64 * 1024 * 1024, maxTotalBufferSize: 512 * 1024 * 1024 }, sessionId).catch(() => undefined)
    await send("Fetch.enable", { patterns: [{ urlPattern: "*m3u8*", requestStage: "Response" }, { urlPattern: "*format=m3u8*", requestStage: "Response" }] }, sessionId).catch(() => undefined)
    await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId).catch(() => undefined)
  }

  const onMessage = async (_e, method, params, sessionId) => {
    if (process.env.DOWNLEE_DEBUG && /^(Fetch|Target)\.|Network\.(responseReceived|loadingFinished)/.test(method)) console.error("cdp", method, sessionId ?? "-", params?.request?.url ?? params?.response?.url ?? params?.requestId ?? "")
    try {
      if (method === "Target.attachedToTarget") {
        const sid = params.sessionId
        sessions.add(sid)
        await setup(sid)
        await send("Runtime.runIfWaitingForDebugger", {}, sid).catch(() => undefined)
      } else if (method === "Fetch.requestPaused") {
        // master の HLS を最高画質だけにして渡す。それ以外はそのまま通す
        const { requestId, request, responseStatusCode, responseHeaders } = params
        let body = null
        if (responseStatusCode && responseStatusCode < 300) {
          const r = await send("Fetch.getResponseBody", { requestId }, sessionId).catch(() => null)
          if (r) body = r.base64Encoded ? Buffer.from(r.body, "base64").toString("utf8") : r.body
        }
        const filtered = body ? filterMaster(body, o.maxHeight) : null
        if (filtered) {
          o.onMaster?.(request.url, filtered.text)
          const headers = (responseHeaders ?? []).filter((h) => !/^content-(length|encoding)$/i.test(h.name))
          await send("Fetch.fulfillRequest", { requestId, responseCode: responseStatusCode, responseHeaders: headers, body: Buffer.from(filtered.text).toString("base64") }, sessionId)
        } else {
          if (body && /#EXTINF/.test(body)) o.onPlaylist(request.url, body)
          await send("Fetch.continueRequest", { requestId }, sessionId).catch(() => send("Fetch.continueResponse", { requestId }, sessionId).catch(() => undefined))
        }
      } else if (method === "Network.responseReceived") {
        const url = params.response?.url
        if (url && params.response.status < 400 && o.wants(url)) pending.set(`${sessionId}|${params.requestId}`, url)
      } else if (method === "Network.loadingFinished") {
        const k = `${sessionId}|${params.requestId}`
        const url = pending.get(k)
        if (!url) return
        pending.delete(k)
        const r = await send("Network.getResponseBody", { requestId: params.requestId }, sessionId).catch(() => null)
        if (r) o.onBody(url, r.base64Encoded ? Buffer.from(r.body, "base64") : Buffer.from(r.body, "utf8"))
      }
    } catch (e) {
      /* 1 件の失敗では止めない。止めた通信は必ず流す */
      if (process.env.DOWNLEE_DEBUG) console.error("cdp-error", method, e instanceof Error ? e.message : e)
      if (method === "Fetch.requestPaused") await send("Fetch.continueRequest", { requestId: params.requestId }, sessionId).catch(() => undefined)
    }
  }
  dbg.on("message", onMessage)
  await setup(undefined)

  return {
    async stop() {
      dbg.removeListener("message", onMessage)
      for (const sid of sessions) {
        await send("Fetch.disable", {}, sid).catch(() => undefined)
        await send("Network.disable", {}, sid).catch(() => undefined)
      }
      if (attachedHere && dbg.isAttached()) {
        try { dbg.detach() } catch { /* すでに外れている */ }
      }
    },
  }
}

/** ページの中で、いちばん大きい動画を最高速で再生させる（音は消す）。DRM の再生なら "drm" を返す */
const PLAY_SCRIPT = `(() => {
  const vids = [...document.querySelectorAll("video")].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)
  const v = vids[0]
  if (!v) return "none"
  if (v.mediaKeys) return "drm"
  v.muted = true
  const speed = () => { try { v.playbackRate = 4 } catch {} }
  speed()
  v.addEventListener("ratechange", () => { if (v.playbackRate < 4) setTimeout(speed, 50) })
  v.addEventListener("loadedmetadata", speed)
  v.play().catch(() => {})
  return JSON.stringify({ t: v.currentTime, d: v.duration, ended: v.ended, paused: v.paused })
})()`

const STATE_SCRIPT = `(() => {
  const v = [...document.querySelectorAll("video")].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0]
  if (!v) return null
  if (v.mediaKeys) return { drm: true }
  if (v.paused && !v.ended) v.play().catch(() => {})
  return { t: v.currentTime, d: v.duration, ended: v.ended }
})()`

module.exports = { filterMaster, startCapture, stripQuery, PLAY_SCRIPT, STATE_SCRIPT }
