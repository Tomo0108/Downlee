const assert = require("node:assert/strict")
const { test } = require("node:test")
const { parseHls, parseDash, parseIsoDuration, estimateSize } = require("./manifest.cjs")

test("HLS master：画質の高い順に並べ、音声の URL も拾う", () => {
  const m = parseHls(
    ["#EXTM3U", '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="audio/a.m3u8"', "#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360", "360/i.m3u8", "#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080", "https://cdn/1080/i.m3u8"].join("\n"),
    "https://c/v/master.m3u8",
  )
  assert.equal(m.type, "master")
  assert.equal(m.variants[0].height, 1080)
  assert.equal(m.variants[1].url, "https://c/v/360/i.m3u8")
  assert.deepEqual(m.audio, ["https://c/v/audio/a.m3u8"])
})

test("HLS media：長さ・断片の数・最初の断片", () => {
  const m = parseHls(["#EXTM3U", "#EXTINF:6.0,", "s1.ts", "#EXTINF:4.5,", "s2.ts", "#EXT-X-ENDLIST"].join("\n"), "https://c/x/i.m3u8")
  assert.equal(m.duration, 10.5)
  assert.equal(m.segments, 2)
  assert.equal(m.firstSegment, "https://c/x/s1.ts")
  assert.equal(m.live, false)
  assert.equal(parseHls("<html>", "https://c/"), null)
})

test("DASH：長さと帯域から容量を見積もる", () => {
  const xml = `<MPD mediaPresentationDuration="PT1M40S"><Period><AdaptationSet mimeType="video/mp4"><Representation bandwidth="2000000" height="720"/><Representation bandwidth="4000000" height="1080"/></AdaptationSet><AdaptationSet mimeType="audio/mp4"><Representation bandwidth="128000"/></AdaptationSet></Period></MPD>`
  const d = parseDash(xml)
  assert.equal(d.duration, 100)
  assert.equal(d.height, 1080)
  assert.equal(d.size, estimateSize(4128000, 100))
  assert.equal(parseIsoDuration("PT1H2M3.5S"), 3723.5)
})
