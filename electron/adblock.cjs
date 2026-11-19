/**
 * ［見つける］の専用ブラウザの広告ブロック（Ghostery の adblocker。EasyList などの広告・追跡のリスト）。
 * リストは %APPDATA%\Downlee\adblock-engine.bin に保存し、7 日ごとに取り直す。取得できないときはブロックせずに続ける。
 */
const fs = require("node:fs")
const path = require("node:path")

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

function createAdblock({ userData, fetchImpl }) {
  const cache = path.join(userData, "adblock-engine.bin")
  let blocker = null
  let loading = null
  let lib = null

  function load() {
    if (blocker) return Promise.resolve(blocker)
    if (loading) return loading
    loading = (async () => {
      lib ??= require("@ghostery/adblocker-electron")
      try {
        if (Date.now() - fs.statSync(cache).mtimeMs > MAX_AGE_MS) fs.rmSync(cache, { force: true })
      } catch { /* まだない */ }
      blocker = await lib.ElectronBlocker.fromPrebuiltAdsAndTracking(fetchImpl, {
        path: cache,
        read: (p) => fs.promises.readFile(p),
        write: (p, buf) => fs.promises.writeFile(p, buf),
      })
      return blocker
    })().finally(() => {
      loading = null
    })
    return loading
  }

  /** セッションのブロックを入れる・外す。戻り値は実際にブロックしているか */
  async function apply(ses, on) {
    if (!on) {
      if (blocker?.isBlockingEnabled(ses)) blocker.disableBlockingInSession(ses)
      return false
    }
    try {
      const b = await load()
      if (!b.isBlockingEnabled(ses)) b.enableBlockingInSession(ses)
      return true
    } catch {
      return false
    }
  }

  /** 見つけたメディアが広告のリストに当たるか（ブロックを入れているときだけ） */
  function isAd(url, pageUrl) {
    if (!blocker || !lib) return false
    try {
      return blocker.match(lib.Request.fromRawDetails({ url, sourceUrl: pageUrl, type: "media" })).match === true
    } catch {
      return false
    }
  }

  return { apply, isAd }
}

module.exports = { createAdblock }
