/**
 * HLS（m3u8）・DASH（mpd）のマニフェストを読んで、長さ・画質・おおよその容量を出す（純粋な処理。テストあり）。
 * 暗号の鍵や DRM の情報は扱わない。
 */

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

/** HLS。master なら画質ごとの一覧、media なら長さと断片の数を返す */
function parseHls(text, base) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim())
  if (!lines.some((l) => l.startsWith("#EXTM3U"))) return null
  const variants = []
  const audio = []
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (l.startsWith("#EXT-X-STREAM-INF:")) {
      const a = attrs(l.slice(18))
      const uri = lines.slice(i + 1).find((x) => x && !x.startsWith("#"))
      if (!uri) continue
      const res = /(\d+)x(\d+)/.exec(a.RESOLUTION || "")
      variants.push({ url: resolve(uri, base), bandwidth: Number(a["AVERAGE-BANDWIDTH"] || a.BANDWIDTH) || null, height: res ? Number(res[2]) : null })
    } else if (l.startsWith("#EXT-X-MEDIA:")) {
      const a = attrs(l.slice(13))
      if (a.TYPE === "AUDIO" && a.URI) audio.push(resolve(a.URI, base))
    }
  }
  if (variants.length) {
    variants.sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.bandwidth ?? 0) - (a.bandwidth ?? 0))
    return { type: "master", variants, audio }
  }
  let duration = 0
  let segments = 0
  let bytes = 0
  let byteRanges = true
  let first = null
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (l.startsWith("#EXTINF:")) {
      duration += Number.parseFloat(l.slice(8)) || 0
      segments++
      const range = lines[i + 1]?.startsWith("#EXT-X-BYTERANGE:") ? lines[i + 1] : null
      if (range) bytes += Number.parseInt(range.slice(17), 10) || 0
      else byteRanges = false
      const uri = lines.slice(i + 1).find((x) => x && !x.startsWith("#"))
      first ??= uri ? resolve(uri, base) : null
    }
  }
  return { type: "media", duration: duration || null, segments, bytes: byteRanges && bytes ? bytes : null, firstSegment: first, live: !lines.includes("#EXT-X-ENDLIST") }
}

/** ISO 8601 の長さ（PT1H2M3.5S）を秒にする */
function parseIsoDuration(v) {
  const m = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(String(v || "").trim())
  if (!m) return null
  const [, d, h, mi, s] = m.map((x) => Number(x) || 0)
  const total = d * 86400 + h * 3600 + mi * 60 + s
  return total || null
}

/** DASH。長さ・いちばん高い画質・映像と音声の帯域の合計 */
function parseDash(text) {
  const xml = String(text || "")
  if (!/<MPD[\s>]/.test(xml)) return null
  const duration = parseIsoDuration(/mediaPresentationDuration="([^"]+)"/.exec(xml)?.[1])
  let video = 0
  let audio = 0
  let height = null
  const sets = xml.split(/<AdaptationSet\b/).slice(1)
  for (const set of sets) {
    const head = set.slice(0, set.indexOf(">"))
    const isAudio = /contentType="audio"|mimeType="audio\//.test(head) || (!/contentType="video"|mimeType="video\//.test(head) && /mimeType="audio\//.test(set))
    for (const rep of set.matchAll(/<Representation\b([^>]*)>?/g)) {
      const bw = Number(/bandwidth="(\d+)"/.exec(rep[1])?.[1]) || 0
      const h = Number(/height="(\d+)"/.exec(rep[1])?.[1] || /height="(\d+)"/.exec(head)?.[1]) || null
      if (isAudio) audio = Math.max(audio, bw)
      else if (bw > video) {
        video = bw
        height = h
      }
    }
  }
  const bandwidth = video + audio || null
  return { duration, height, bandwidth, size: estimateSize(bandwidth, duration) }
}

/** 帯域（bit/s）と長さ（秒）からおおよその容量（バイト） */
function estimateSize(bandwidth, duration) {
  if (!bandwidth || !duration) return null
  return Math.round((bandwidth * duration) / 8)
}

module.exports = { parseHls, parseDash, parseIsoDuration, estimateSize }
