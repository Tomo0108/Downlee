const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const crypto = require("node:crypto")
const { sniffSegment, assembleTrack, ivFor } = require("./assemble.cjs")
const { localizeMedia } = require("./browserdl.cjs")

const ts = (n, fill) => Buffer.concat(Array.from({ length: n }, () => Buffer.concat([Buffer.from([0x47]), Buffer.alloc(187, fill)])))
const box = (type, body = Buffer.alloc(8)) => {
  const b = Buffer.alloc(8)
  b.writeUInt32BE(8 + body.length)
  b.write(type, 4, "latin1")
  return Buffer.concat([b, body])
}

test("sniffSegment は TS・fMP4・HTML を見分け、先頭の余分なデータを飛ばす", () => {
  assert.deepEqual(sniffSegment(ts(4, 1)), { kind: "ts", offset: 0 })
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex")
  assert.deepEqual(sniffSegment(Buffer.concat([png, ts(4, 2)])), { kind: "ts", offset: png.length })
  assert.deepEqual(sniffSegment(box("moof")), { kind: "mp4", offset: 0 })
  assert.deepEqual(sniffSegment(Buffer.concat([Buffer.from("junkjunk"), box("styp"), box("moof")])), { kind: "mp4", offset: 8 })
  assert.equal(sniffSegment(Buffer.from("<!DOCTYPE html><html>403</html>")).kind, "html")
  assert.equal(sniffSegment(Buffer.alloc(0)).kind, "empty")
})

test("ivFor は IV の指定がなければ番号を 16 バイトにする", () => {
  assert.equal(ivFor(null, 5).toString("hex"), "00000000000000000000000000000005")
  assert.equal(ivFor({ iv: "0x0102" }, 5).toString("hex"), "00000000000000000000000000000102")
})

function workdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "downlee-asm-"))
}

test("fMP4：頭の情報と断片を 1 本の .mp4 につなぐ（.bin の名前のままでよい）", () => {
  const dir = workdir()
  const loc = localizeMedia('#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:1\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4,\na.m4s\n#EXTINF:4,\nb.m4s\n#EXT-X-ENDLIST\n', "https://c/")
  const init = Buffer.concat([box("ftyp"), box("moov")])
  const parts = [box("moof", Buffer.alloc(16, 1)), box("moof", Buffer.alloc(16, 2))]
  fs.writeFileSync(path.join(dir, "map0.mp4"), init)
  fs.writeFileSync(path.join(dir, "seg00000.bin"), parts[0])
  fs.writeFileSync(path.join(dir, "seg00001.bin"), parts[1])
  const r = assembleTrack(loc.files.map((f) => ({ ...f, file: path.join(dir, f.name) })), path.join(dir, "track"))
  assert.equal(r.kind, "mp4")
  assert.ok(r.file.endsWith("track.mp4"))
  assert.deepEqual(fs.readFileSync(r.file), Buffer.concat([init, ...parts]))
  fs.rmSync(dir, { recursive: true, force: true })
})

test("AES-128：手元で復号し、余分な先頭を外して .ts につなぐ", () => {
  const dir = workdir()
  const key = crypto.randomBytes(16)
  const loc = localizeMedia('#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:7\n#EXT-X-KEY:METHOD=AES-128,URI="k"\n#EXTINF:4,\na.ts\n#EXTINF:4,\nb.ts\n#EXT-X-ENDLIST\n', "https://c/")
  assert.equal(loc.files[1].seq, 7)
  assert.equal(loc.files[2].seq, 8)
  fs.writeFileSync(path.join(dir, "key0.bin"), key)
  const plain = [Buffer.concat([Buffer.from("GIF89a"), ts(3, 3)]), ts(3, 4)]
  plain.forEach((p, i) => {
    const c = crypto.createCipheriv("aes-128-cbc", key, ivFor(null, 7 + i))
    fs.writeFileSync(path.join(dir, `seg0000${i}.bin`), Buffer.concat([c.update(p), c.final()]))
  })
  const r = assembleTrack(loc.files.map((f) => ({ ...f, file: path.join(dir, f.name) })), path.join(dir, "track"))
  assert.equal(r.kind, "ts")
  assert.deepEqual(fs.readFileSync(r.file), Buffer.concat([ts(3, 3), ts(3, 4)]))
  fs.rmSync(dir, { recursive: true, force: true })
})

test("エラーページばかりの断片はつながずに止める", () => {
  const dir = workdir()
  const loc = localizeMedia("#EXTM3U\n#EXTINF:4,\na.ts\n#EXTINF:4,\nb.ts\n#EXTINF:4,\nc.ts\n#EXT-X-ENDLIST\n", "https://c/")
  fs.writeFileSync(path.join(dir, "seg00000.bin"), ts(3, 1))
  fs.writeFileSync(path.join(dir, "seg00001.bin"), "<html>denied</html>")
  fs.writeFileSync(path.join(dir, "seg00002.bin"), "<html>denied</html>")
  assert.throws(() => assembleTrack(loc.files.map((f) => ({ ...f, file: path.join(dir, f.name) })), path.join(dir, "track")), /エラーページ/)
  assert.equal(fs.existsSync(path.join(dir, "track.ts")), false)
  fs.rmSync(dir, { recursive: true, force: true })
})
