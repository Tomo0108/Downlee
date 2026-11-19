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

function setup(settings = { maxConcurrent: 1 }) {
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
