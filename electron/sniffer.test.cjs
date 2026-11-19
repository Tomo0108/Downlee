const assert = require("node:assert/strict")
const { test } = require("node:test")
const { classifyResponse, mediaKey, isBlocked, toNetscapeCookies, normalizeUrl } = require("./sniffer.cjs")

test("メディアの応答を見分ける", () => {
  assert.equal(classifyResponse({ url: "https://c/x/master.m3u8?t=1", contentType: "application/vnd.apple.mpegurl" }).kind, "hls")
  assert.equal(classifyResponse({ url: "https://c/manifest.mpd" }).kind, "dash")
  assert.equal(classifyResponse({ url: "https://c/v.mp4", contentType: "video/mp4", contentLength: "5000000" }).kind, "video")
  assert.equal(classifyResponse({ url: "https://c/a.m4a", contentType: "audio/mp4", contentRange: "bytes 0-99/900000" }).size, 900000)
})

test("断片・小さいファイル・ページは拾わない", () => {
  assert.equal(classifyResponse({ url: "https://c/seg-12.ts", contentType: "video/mp2t" }), null)
  assert.equal(classifyResponse({ url: "https://c/chunk.m4s", contentType: "video/mp4" }), null)
  assert.equal(classifyResponse({ url: "https://c/beep.mp3", contentType: "audio/mpeg", contentLength: "2000" }), null)
  assert.equal(classifyResponse({ url: "https://c/page", contentType: "text/html" }), null)
  assert.equal(classifyResponse({ url: "https://c/v.mp4", contentType: "video/mp4", statusCode: 404 }), null)
})

test("同じメディアは 1 つにまとめる", () => {
  assert.equal(mediaKey("https://c/v.mp4?range=0-100&id=1"), mediaKey("https://c/v.mp4?id=1&range=200-300"))
})

test("除外するサイト", () => {
  assert.equal(isBlocked("https://ads.example.com/v.mp4", "example.com"), true)
  assert.equal(isBlocked("https://notexample.com/v.mp4", "example.com"), false)
  assert.equal(isBlocked("https://x.com/", ""), false)
})

test("cookie を Netscape 形式にする", () => {
  const text = toNetscapeCookies([{ domain: ".example.com", path: "/", secure: true, httpOnly: true, expirationDate: 1999999999.5, name: "sid", value: "v" }])
  assert.match(text, /#HttpOnly_\.example\.com\tTRUE\t\/\tTRUE\t2000000000\tsid\tv/)
})

test("アドレス欄の入力", () => {
  assert.equal(normalizeUrl("example.com/a"), "https://example.com/a")
  assert.equal(normalizeUrl("猫 動画"), "https://www.google.com/search?q=%E7%8C%AB%20%E5%8B%95%E7%94%BB")
})
