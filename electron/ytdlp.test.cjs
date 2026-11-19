const assert = require("node:assert/strict")
const { test } = require("node:test")
const y = require("./ytdlp.cjs")

const S = { outputDir: "C:\\DL", filenameTemplate: "%(title)s.%(ext)s", playlistTemplate: "%(playlist_index)s - %(title)s.%(ext)s", concurrentFragments: 4, embedThumbnail: true, embedMetadata: true, embedChapters: true }
const val = (args, flag) => args[args.indexOf(flag) + 1]

test("最高画質の MP4：映像と音声を結合して MP4 にする", () => {
  const a = y.buildDownloadArgs({ url: "https://example.com/v", mode: "video", container: "mp4" }, S, { ffmpegDir: "C:\\bin" })
  assert.equal(val(a, "-f"), "bv*+ba/b/bv*+ba/b")
  assert.equal(val(a, "--merge-output-format"), "mp4")
  assert.equal(val(a, "--ffmpeg-location"), "C:\\bin")
  assert.ok(a.includes("--no-playlist"))
  assert.deepEqual(a.slice(-2), ["--", "https://example.com/v"])
})

test("画質の上限とコーデック", () => {
  const a = y.buildDownloadArgs({ url: "https://e/v", mode: "video", container: "mkv", maxHeight: 1080, codec: "h264" }, S)
  assert.equal(val(a, "-f"), "bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b")
  assert.equal(val(a, "-S"), "vcodec:h264,acodec:aac")
})

test("音声 MP3 は 320 kbps、元の形式なら変換しない", () => {
  const a = y.buildDownloadArgs({ url: "https://e/v", mode: "audio", audioFormat: "mp3" }, S)
  assert.ok(a.includes("-x"))
  assert.equal(val(a, "--audio-format"), "mp3")
  assert.equal(val(a, "--audio-quality"), "320K")
  const b = y.buildDownloadArgs({ url: "https://e/v", mode: "audio", audioFormat: "best" }, S)
  assert.ok(!b.includes("--audio-format"))
})

test("形式の指定：映像だけなら音声を足す", () => {
  assert.equal(val(y.buildDownloadArgs({ url: "https://e/v", formatId: "137", formatHasAudio: false }, S), "-f"), "137+ba/137")
  assert.equal(val(y.buildDownloadArgs({ url: "https://e/v", formatId: "22", formatHasAudio: true }, S), "-f"), "22")
})

test("区間・プレイリスト・ログイン・速度", () => {
  const a = y.buildDownloadArgs({ url: "https://e/p", sections: "1:00-2:30", playlist: true, playlistItems: "1,3-5", cookieFile: "c.txt", referer: "https://e/" }, { ...S, rateLimit: "5M", proxy: "http://p:1" })
  assert.equal(val(a, "--download-sections"), "*1:00-2:30")
  assert.equal(val(a, "-I"), "1,3-5")
  assert.equal(val(a, "--cookies"), "c.txt")
  assert.equal(val(a, "--referer"), "https://e/")
  assert.equal(val(a, "-r"), "5M")
  assert.equal(val(a, "--proxy"), "http://p:1")
  assert.ok(a.includes("--yes-playlist"))
  assert.equal(a[a.indexOf("-o") + 1], "%(playlist_index)s - %(title)s.%(ext)s")
})

test("ファイル名のひな形：上の階層へ出さない・拡張子を補う", () => {
  assert.equal(y.sanitizeTemplate("../../x/%(title)s"), "x/%(title)s.%(ext)s")
  assert.equal(y.sanitizeTemplate(""), "%(title).150B [%(id)s].%(ext)s")
})

test("追加の引数の分割", () => {
  assert.deepEqual(y.splitArgs(`--a "b c" 'd e' f`), ["--a", "b c", "d e", "f"])
})

test("進み具合・ファイル・情報・段階の行を読む", () => {
  const p = y.parseLine("DLPROG downloading|500|1000|NA|250.5|2|1|3")
  assert.equal(p.type, "progress")
  assert.equal(p.percent, 50)
  assert.equal(p.speed, 250.5)
  assert.equal(p.playlistCount, 3)
  const est = y.parseLine("DLPROG downloading|500|NA|2000|NA|NA|NA|NA")
  assert.equal(est.percent, 25)
  assert.deepEqual(y.parseLine("DLFILE C:\\DL\\a b.mp4"), { type: "file", path: "C:\\DL\\a b.mp4" })
  const info = y.parseLine("DLINFO abc|題名|に|縦棒|https://i/t.jpg|61|NA|NA")
  assert.equal(info.title, "題名|に|縦棒")
  assert.equal(info.duration, 61)
  assert.deepEqual(y.parseLine("[Merger] Merging formats into x.mp4"), { type: "stage", stage: "Merger" })
  assert.equal(y.parseLine("ERROR: [x] boom").message, "[x] boom")
  assert.equal(y.parseLine("[youtube] abc: Downloading webpage"), null)
})

test("エラーを日本語にする（DRM は扱わない）", () => {
  assert.equal(y.friendlyError("This video is DRM protected").code, "drm")
  assert.equal(y.friendlyError("Unsupported URL: https://x").code, "unsupported")
  assert.equal(y.friendlyError("Sign in to confirm your age").code, "login")
  assert.equal(y.friendlyError("Requested format is not available").code, "format")
  assert.equal(y.friendlyError("[generic] missing: Unable to download webpage: HTTP Error 404: File not found").code, "notfound")
  assert.equal(y.friendlyError("Use --cookies-from-browser or --cookies for the authentication").code, "login")
})

test("解析結果のまとめ：動画", () => {
  const info = y.summarizeInfo({
    id: "a", title: "T", duration: 10, webpage_url: "https://e/v", extractor_key: "Ex",
    formats: [
      { format_id: "sb0", ext: "mhtml", vcodec: "none", acodec: "none", format_note: "storyboard" },
      { format_id: "140", ext: "m4a", vcodec: "none", acodec: "mp4a.40.2", abr: 128 },
      { format_id: "137", ext: "mp4", vcodec: "avc1.640028", acodec: "none", height: 1080, width: 1920, fps: 30 },
      { format_id: "313", ext: "webm", vcodec: "vp9", acodec: "none", height: 2160, width: 3840, fps: 60, dynamic_range: "HDR10" },
    ],
    subtitles: { ja: [], live_chat: [] },
  })
  assert.equal(info.kind, "video")
  assert.equal(info.bestHeight, 2160)
  assert.deepEqual(info.heights, [2160, 1080])
  assert.equal(info.formats[0].id, "313")
  assert.equal(info.formats[0].dynamicRange, "HDR10")
  assert.equal(info.formats.find((f) => f.id === "137").vcodec, "H.264")
  assert.deepEqual(info.subtitles, ["ja"])
  assert.equal(info.drm, false)
})

test("解析結果のまとめ：DRM・プレイリスト", () => {
  assert.equal(y.summarizeInfo({ id: "d", formats: [{ format_id: "1", vcodec: "avc1", acodec: "none", has_drm: true }] }).drm, true)
  const pl = y.summarizeInfo({ _type: "playlist", title: "P", entries: [{ id: "1", title: "a", url: "https://e/1", duration: 5 }, null, { id: "2", url: "https://e/2" }] })
  assert.equal(pl.kind, "playlist")
  assert.equal(pl.count, 2)
  assert.equal(pl.entries[1].title, "2")
})

test("変換の引数と ffmpeg の進み具合", () => {
  const a = y.buildConvertArgs("in.mov", "out.mp4", "mp4", { start: "1:00" })
  assert.equal(val(a, "-ss"), "1:00")
  assert.equal(val(a, "-i"), "in.mov")
  assert.equal(a[a.length - 1], "out.mp4")
  assert.throws(() => y.buildConvertArgs("a", "b", "exe"))
  assert.equal(y.parseFfmpegProgress("out_time_us=2500000").seconds, 2.5)
  assert.equal(y.parseFfmpegDuration("  Duration: 00:01:02.50, start"), 62.5)
})
