/**
 * 取った HLS の断片を、ffmpeg に渡す前に自分で 1 本のファイルにつなぐ。
 * ffmpeg の HLS 読み込みは、見慣れない拡張子の断片（seg00000.bin など）を安全のために開かないので、
 * 断片のリストではなく、つないだ 1 本（TS なら .ts、fMP4 なら .mp4）を渡す。
 * - AES-128（鍵がそのまま配られる通常の暗号化）は手元で復号する。DRM は扱わない。
 * - CDN が断片の先頭に付けた余分なデータ（画像の見出しなど）を外す。
 * - HTML のエラーページなど、動画でない中身が混じっていたら止める。
 */
const fs = require("node:fs")
const crypto = require("node:crypto")

const MP4_BOXES = new Set(["ftyp", "styp", "moof", "sidx", "emsg", "prft", "moov", "mdat", "free", "skip"])

function boxAt(buf, i) {
  if (i + 8 > buf.length) return null
  const size = buf.readUInt32BE(i)
  const type = buf.toString("latin1", i + 4, i + 8)
  if (!MP4_BOXES.has(type)) return null
  if (size !== 1 && size !== 0 && size < 8) return null
  return type
}

function tsAt(buf, i) {
  if (buf[i] !== 0x47) return false
  // 188 バイトごとに同期バイトが並ぶ。短い断片は並んでいる分だけ確かめる
  let ok = 0
  for (let k = i; k < buf.length && ok < 4; k += 188) {
    if (buf[k] !== 0x47) return false
    ok++
  }
  return ok >= Math.min(3, Math.floor((buf.length - i) / 188) || 1)
}

/** 断片の中身の種類と、動画のデータが始まる位置 */
function sniffSegment(buf) {
  if (!buf?.length) return { kind: "empty", offset: 0 }
  const head = buf.toString("latin1", 0, Math.min(buf.length, 512)).trimStart().toLowerCase()
  if (head.startsWith("<!doctype") || head.startsWith("<html") || head.startsWith("<?xml") || head.startsWith("{\"") || head.startsWith("<head") || head.startsWith("<body")) return { kind: "html", offset: 0 }
  const limit = Math.min(buf.length, 64 * 1024)
  for (let i = 0; i < limit; i++) {
    if (buf[i] === 0x47 && tsAt(buf, i)) return { kind: "ts", offset: i }
    if (i + 8 <= buf.length && buf[i + 4] >= 0x61 && boxAt(buf, i)) return { kind: "mp4", offset: i }
  }
  // ID3 付きの AAC・MP3 など。手を付けずにそのまま使う
  return { kind: "raw", offset: 0 }
}

function ivFor(key, seq) {
  if (key?.iv) {
    const hex = String(key.iv).replace(/^0x/i, "").padStart(32, "0").slice(-32)
    return Buffer.from(hex, "hex")
  }
  const iv = Buffer.alloc(16)
  iv.writeBigUInt64BE(BigInt(seq ?? 0), 8)
  return iv
}

function decrypt(data, keyBytes, iv) {
  const d = crypto.createDecipheriv("aes-128-cbc", keyBytes, iv)
  return Buffer.concat([d.update(data), d.final()])
}

/**
 * 1 本につなぐ。files は localizeMedia の files（file に手元のパスを足したもの）。
 * 戻り値：{ file, kind }。つなげないときは日本語のエラーを投げる。
 */
function assembleTrack(files, outBase) {
  const keys = new Map()
  const keyOf = (k) => {
    if (!k) return null
    if (!keys.has(k.file)) {
      const f = files.find((x) => x.name === k.file)
      const bytes = f && fs.existsSync(f.file) ? fs.readFileSync(f.file) : null
      if (!bytes || bytes.length !== 16) throw new Error("暗号の鍵を受け取れませんでした。もう一度保存してください。")
      keys.set(k.file, bytes)
    }
    return keys.get(k.file)
  }
  const read = (f) => {
    if (!fs.existsSync(f.file)) throw new Error(`記録できなかった断片があります（${f.name}）。もう一度保存すると、続きから記録します。`)
    let data = fs.readFileSync(f.file)
    const k = keyOf(f.key)
    if (k) {
      try {
        data = decrypt(data, k, ivFor(f.key, f.seq))
      } catch {
        throw new Error("暗号を解けない断片がありました。もう一度保存してください。")
      }
    }
    return data
  }
  const segs = files.filter((f) => f.segment)
  if (!segs.length) throw new Error("動画の断片がありません。")
  const maps = new Map(files.filter((f) => !f.segment && f.name.startsWith("map")).map((f) => [f.name, f]))
  const first = sniffSegment(read(segs[0]))
  const kind = segs[0].map || first.kind === "mp4" ? "mp4" : first.kind === "ts" ? "ts" : "raw"
  const ext = kind === "mp4" ? "mp4" : kind === "ts" ? "ts" : "bin"
  const out = `${outBase}.${ext}`
  const fd = fs.openSync(out, "w")
  try {
    let lastMap = null
    let bad = 0
    for (const f of segs) {
      if (f.map && f.map !== lastMap) {
        const m = maps.get(f.map)
        if (!m) throw new Error("動画の頭の情報を受け取れませんでした。")
        const init = read(m)
        const s = sniffSegment(init)
        fs.writeSync(fd, s.kind === "mp4" ? init.subarray(s.offset) : init)
        lastMap = f.map
      }
      const data = read(f)
      const s = sniffSegment(data)
      if (s.kind === "html" || s.kind === "empty") {
        bad++
        continue
      }
      fs.writeSync(fd, s.kind === "ts" || s.kind === "mp4" ? data.subarray(s.offset) : data)
    }
    // 少しだけ壊れた断片は飛ばしてつなぐ（一瞬止まるだけ）。多いときは止める
    if (bad > Math.max(1, segs.length * 0.02)) throw new Error(`動画でない中身（エラーページなど）の断片が ${bad} 個ありました。しばらくしてからもう一度保存してください。`)
  } catch (e) {
    fs.closeSync(fd)
    fs.rmSync(out, { force: true })
    throw e
  }
  fs.closeSync(fd)
  return { file: out, kind }
}

module.exports = { sniffSegment, assembleTrack, ivFor }
