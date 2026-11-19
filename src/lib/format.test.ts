import assert from "node:assert/strict"
import { test } from "node:test"
import { extractUrls, formatBytes, formatDuration, parseTime } from "./format"
import { presetById, requestFor } from "./presets"

test("URL を文章から取り出す", () => {
  assert.deepEqual(extractUrls("見て https://example.com/a?b=1、と https://example.com/a?b=1 と (https://x.example.org/v)."), ["https://example.com/a?b=1", "https://x.example.org/v"])
  assert.deepEqual(extractUrls("URL なし"), [])
})

test("大きさと時間の書式", () => {
  assert.equal(formatBytes(1536), "1.5 KB")
  assert.equal(formatBytes(500), "500 B")
  assert.equal(formatDuration(3725), "1:02:05")
  assert.equal(formatDuration(65), "1:05")
})

test("時刻の入力", () => {
  assert.equal(parseTime("1:30"), 90)
  assert.equal(parseTime("1:00:05"), 3605)
  assert.equal(parseTime("abc"), null)
})

test("形式の組み合わせから依頼を作る", () => {
  const r = requestFor(presetById("audio-mp3"), { maxHeight: 1080 })
  assert.equal(r.mode, "audio")
  assert.equal(r.maxHeight, 0)
  assert.equal(r.presetLabel, "MP3")
  assert.equal(requestFor(presetById("video-mkv"), { maxHeight: 2160 }).presetLabel, "MKV・4K")
  assert.equal(presetById("nope").id, "video-mp4")
})
