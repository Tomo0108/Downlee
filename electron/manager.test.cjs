const assert = require("node:assert/strict")
const { test } = require("node:test")
const { EventEmitter } = require("node:events")
const { PassThrough } = require("node:stream")
const { DownloadManager } = require("./manager.cjs")

function fakeChild() {
  const c = new EventEmitter()
  c.stdout = new PassThrough()
  c.stderr = new PassThrough()
  c.pid = 1
  c.finish = (code) => {
    c.stdout.end()
    c.stderr.end()
    setImmediate(() => c.emit("close", code))
  }
  return c
}

function setup(settings = { maxConcurrent: 1 }, extra = {}) {
  const children = []
  const finished = []
  const m = new DownloadManager({
    getSettings: () => ({ outputDir: "/tmp", ...settings }),
    spawnYtdlp: () => {
      const c = fakeChild()
      children.push(c)
      return c
    },
    spawnFfmpeg: () => fakeChild(),
    killTree: (c) => c.finish(1),
    onFinished: (j) => finished.push(j),
    retryDelayMs: 1,
    ...extra,
  })
  return { m, children, finished }
}

const tick = () => new Promise((r) => setImmediate(r))

test("同時に動かす数を守り、終わったら次を始める", async () => {
  const { m, children, finished } = setup()
  const [a, b] = m.add([{ url: "https://e/1" }, { url: "https://e/2" }])
  await tick()
  assert.equal(children.length, 1)
  assert.equal(m.get(a.id).status, "running")
  assert.equal(m.get(b.id).status, "queued")
  children[0].stdout.write("DLINFO x|題名|NA|30|NA|NA\nDLPROG downloading|50|100|NA|10|5|NA|NA\n[Merger] Merging\nDLFILE /tmp/題名.mp4\n")
  await tick()
  assert.equal(m.get(a.id).title, "題名")
  assert.equal(m.get(a.id).status, "processing")
  children[0].finish(0)
  await tick()
  await tick()
  assert.equal(m.get(a.id).status, "done")
  assert.deepEqual(m.get(a.id).files, ["/tmp/題名.mp4"])
  assert.equal(finished.length, 1)
  assert.equal(children.length, 2)
  assert.equal(m.get(b.id).status, "running")
})

test("一時停止・再開・中止", async () => {
  const { m, children } = setup()
  const [a] = m.add([{ url: "https://e/1" }])
  await tick()
  m.pause(a.id)
  await tick()
  await tick()
  assert.equal(m.get(a.id).status, "paused")
  m.resume(a.id)
  await tick()
  assert.equal(children.length, 2)
  m.cancel(a.id)
  await tick()
  await tick()
  assert.equal(m.get(a.id).status, "canceled")
})

test("失敗はわかりやすい文にする", async () => {
  const { m, children } = setup()
  const [a] = m.add([{ url: "https://e/1" }])
  await tick()
  children[0].stderr.write("ERROR: [generic] This video is DRM protected\n")
  children[0].finish(1)
  await tick()
  await tick()
  assert.equal(m.get(a.id).status, "error")
  assert.equal(m.get(a.id).error.code, "drm")
})

test("再起動後は途中のものを一時停止で戻す", () => {
  const { m } = setup()
  m.restore([{ id: "x", status: "running", progress: { percent: 40 } }, { id: "y", status: "done" }])
  assert.deepEqual(m.list().map((j) => [j.id, j.status]), [["x", "paused"]])
})

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

test("追加したものは待っている間も一覧に出る", () => {
  const { m } = setup()
  const seen = []
  m.on("job", (j) => seen.push(j.id))
  const added = m.add([{ url: "https://e/1" }, { url: "https://e/2" }, { url: "https://e/3" }])
  for (const a of added) assert.ok(seen.includes(a.id))
})

test("通信が切れたら続きから自動でやり直す", async () => {
  const { m, children } = setup()
  const [a] = m.add([{ url: "https://e/1.m3u8" }])
  await tick()
  children[0].stderr.write("ERROR: Read timed out\n")
  children[0].finish(1)
  await wait(20)
  assert.equal(children.length, 2)
  assert.equal(m.get(a.id).status, "running")
  children[1].finish(0)
  await wait(5)
  assert.equal(m.get(a.id).status, "done")
})

test("データが一度も届かないまま止まったら、理由を出して止める", async () => {
  const { m, children } = setup({ maxConcurrent: 1 }, { stallMs: 30 })
  const [a] = m.add([{ url: "https://e/1.m3u8" }])
  await tick()
  children[0].stdout.write("[hlsnative] Total fragments: 10\n")
  await tick()
  assert.match(m.get(a.id).progress.stage, /全 10 個/)
  children[0].stderr.write("[download] Got error: The read operation timed out. Retrying fragment 1 (1/50)...\n")
  await wait(120)
  assert.equal(children.length, 1)
  assert.equal(m.get(a.id).status, "error")
  assert.equal(m.get(a.id).error.code, "noresponse")
  assert.match(m.get(a.id).detail, /timed out/)
})

test("途中で止まったら続きからやり直す（取り直しの行だけでは進んだとみなさない）", async () => {
  const { m, children } = setup({ maxConcurrent: 1 }, { stallMs: 40 })
  const [a] = m.add([{ url: "https://e/1.m3u8" }])
  await tick()
  children[0].stdout.write("DLPROG downloading|5000|NA|NA|NA|NA|NA|NA|1|10\n")
  const t = setInterval(() => children[0].stderr.write("[download] Got error: timed out. Retrying fragment 2 (1/50)...\n"), 5)
  await wait(150)
  clearInterval(t)
  assert.ok(children.length >= 2)
  assert.ok(m.get(a.id).autoRetries >= 1)
  m.cancel(a.id)
  await wait(5)
})

test("ffmpeg で取得するときも大きさを進み具合に出す", async () => {
  const { m, children } = setup()
  const [a] = m.add([{ url: "https://e/live.m3u8", duration: 100 }])
  await tick()
  children[0].stderr.write("size=    2048KiB time=00:00:50.00 bitrate=1.0kbits/s speed=1x\n")
  await tick()
  assert.equal(m.get(a.id).progress.downloaded, 2048 * 1024)
  assert.equal(m.get(a.id).progress.percent, 50)
  m.cancel(a.id)
  await wait(5)
})

test("yt-dlp が拒まれたら専用ブラウザ経由に切り替える", async () => {
  const browserChildren = []
  const { m, children } = setup({ maxConcurrent: 1 }, {
    startBrowser: () => {
      const c = fakeChild()
      browserChildren.push(c)
      return c
    },
    canBrowser: (j) => j.fromBrowser === true,
  })
  const [a] = m.add([{ url: "https://e/1.m3u8", fromBrowser: true }])
  await tick()
  children[0].stderr.write("ERROR: unable to download video data: HTTP Error 403: Forbidden\n")
  children[0].finish(1)
  await wait(10)
  assert.equal(m.get(a.id).via, "browser")
  assert.equal(browserChildren.length, 1)
  browserChildren[0].stdout.write("DLFILE /tmp/x.mp4\n")
  browserChildren[0].finish(0)
  await wait(5)
  assert.equal(m.get(a.id).status, "done")
  assert.deepEqual(m.get(a.id).files, ["/tmp/x.mp4"])
})
