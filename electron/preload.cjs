const { contextBridge, ipcRenderer, webUtils } = require("electron")

// 画面へは用途を限定した関数だけを公開する。ファイルの場所はダイアログ・ドロップ経由に限る。
const on = (channel) => (cb) => {
  const listener = (_e, payload) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld("downlee", {
  appInfo: () => ipcRenderer.invoke("app:info"),
  setTheme: (pref) => ipcRenderer.invoke("theme:set", pref),

  getSettings: () => ipcRenderer.invoke("settings:get"),
  getDefaultSettings: () => ipcRenderer.invoke("settings:defaults"),
  setSettings: (patch) => ipcRenderer.invoke("settings:set", patch),
  pickOutputFolder: () => ipcRenderer.invoke("settings:pick-folder"),

  toolsStatus: () => ipcRenderer.invoke("tools:status"),
  installTools: () => ipcRenderer.invoke("tools:install"),
  updateYtdlp: () => ipcRenderer.invoke("tools:update"),
  onToolsProgress: on("tools:progress"),
  onToolsUpdated: on("tools:updated"),

  analyze: (url, opts) => ipcRenderer.invoke("media:analyze", url, opts),
  cancelAnalyze: () => ipcRenderer.invoke("media:analyze-cancel"),

  listQueue: () => ipcRenderer.invoke("queue:list"),
  addToQueue: (items) => ipcRenderer.invoke("queue:add", items),
  pauseJob: (id) => ipcRenderer.invoke("queue:pause", id),
  resumeJob: (id) => ipcRenderer.invoke("queue:resume", id),
  cancelJob: (id) => ipcRenderer.invoke("queue:cancel", id),
  finishJobNow: (id) => ipcRenderer.invoke("queue:finish-now", id),
  removeJob: (id) => ipcRenderer.invoke("queue:remove", id),
  clearFinished: () => ipcRenderer.invoke("queue:clear-finished"),
  pauseAll: () => ipcRenderer.invoke("queue:pause-all"),
  resumeAll: () => ipcRenderer.invoke("queue:resume-all"),
  onJob: on("queue:job"),
  onJobRemoved: on("queue:removed"),
  onQueueReset: on("queue:reset"),

  listHistory: () => ipcRenderer.invoke("history:list"),
  removeHistory: (ids) => ipcRenderer.invoke("history:remove", ids),
  clearHistory: () => ipcRenderer.invoke("history:clear"),
  onHistoryChanged: on("history:changed"),

  openFile: (p) => ipcRenderer.invoke("shell:open", p),
  showInFolder: (p) => ipcRenderer.invoke("shell:show", p),
  openOutputFolder: () => ipcRenderer.invoke("shell:open-output"),
  openExternal: (url) => ipcRenderer.invoke("shell:external", url),

  pickConvertFiles: () => ipcRenderer.invoke("convert:pick"),
  statFiles: (paths) => ipcRenderer.invoke("convert:stat", paths),
  pathForFile: (file) => webUtils.getPathForFile(file),

  readClipboard: () => ipcRenderer.invoke("clipboard:read"),

  openBrowser: (url) => ipcRenderer.invoke("browser:open", url),
  controlBrowser: (action) => ipcRenderer.invoke("browser:control", action),
  browserState: () => ipcRenderer.invoke("browser:state"),
  listFound: () => ipcRenderer.invoke("browser:list"),
  clearFound: () => ipcRenderer.invoke("browser:clear"),
  clearBrowserData: () => ipcRenderer.invoke("browser:clear-data"),
  listExtensions: () => ipcRenderer.invoke("browser:extensions"),
  addExtension: () => ipcRenderer.invoke("browser:add-extension"),
  removeExtension: (dir) => ipcRenderer.invoke("browser:remove-extension", dir),
  onFound: on("browser:found"),
  onBrowserState: on("browser:state"),
})
