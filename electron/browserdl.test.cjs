const assert = require("node:assert/strict")
const { test } = require("node:test")
const { parseMaster, pickVariant, localizeMedia, safeName } = require("./browserdl.cjs")

test("画質の上限に合う画質と、その音声トラックを選ぶ", () => {
  const m = parseMaster(
    [
      "#EXTM3U",
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",DEFAULT=YES,URI="a/en.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,AUDIO="aud"',
      "1080.m3u8",
      '#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720,AUDIO="aud"',
      "720.m3u8",
    ].join("\n"),
    "https://c/v/master.m3u8",
  )
  assert.equal(pickVariant(m).video.height, 1080)
  const p = pickVariant(m, 720)
  assert.equal(p.video.url, "https://c/v/720.m3u8")
  assert.equal(p.audio.url, "https://c/v/a/en.m3u8")
})

test("断片・鍵・初期化の URL を手元のファイル名に置き換える", () => {
  const r = localizeMedia(
    ["#EXTM3U", "#EXT-X-MEDIA-SEQUENCE:7", '#EXT-X-KEY:METHOD=AES-128,URI="https://k/key"', '#EXT-X-MAP:URI="init.mp4"', "#EXTINF:4,", "s1.m4s", "#EXT-X-BYTERANGE:100@0", "#EXTINF:4,", "all.ts", "#EXT-X-BYTERANGE:50", "#EXTINF:4,", "all.ts", "#EXT-X-ENDLIST"].join("\n"),
    "https://c/x/i.m3u8",
  )
  assert.equal(r.drm, false)
  assert.equal(r.live, false)
  assert.match(r.playlist, /URI="key0\.bin"/)
  assert.match(r.playlist, /#EXT-X-MAP:URI="map0\.mp4"/)
  assert.match(r.playlist, /#EXT-X-MEDIA-SEQUENCE:7/)
  assert.doesNotMatch(r.playlist, /BYTERANGE|https:/)
  const segs = r.files.filter((f) => f.segment)
  assert.deepEqual(segs.map((f) => [f.url, f.range]), [["https://c/x/s1.m4s", null], ["https://c/x/all.ts", "bytes=0-99"], ["https://c/x/all.ts", "bytes=100-149"]])
})

test("SAMPLE-AES や鍵の形式の指定（DRM）は扱わない", () => {
  assert.equal(localizeMedia('#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://x",KEYFORMAT="com.apple.streamingkeydelivery"\n#EXTINF:4,\ns.ts\n', "https://c/").drm, true)
  assert.equal(localizeMedia('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="k",KEYFORMAT="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"\n#EXTINF:4,\ns.ts\n', "https://c/").drm, true)
  assert.equal(safeName('a/b:c*?"<>|'), "a_b_c______")
})
