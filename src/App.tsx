import { Wrench } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { NoticeProvider, useNotice } from "@/components/common"
import { AppSidebar, type AppView, NAV } from "@/components/layout/AppSidebar"
import { DesktopTitleBar } from "@/components/layout/DesktopTitleBar"
import { Button } from "@/components/ui/button"
import { TooltipProvider } from "@/components/ui/tooltip"
import { bridge, isDesktop } from "@/lib/bridge"
import { applyTheme, readThemePreference, resolveTheme, syncDesktopTheme, systemPrefersDark, writeThemePreference } from "@/lib/theme"
import type { Job, Settings, ThemePreference, ToolsStatus } from "@/lib/types"
import { cn } from "@/lib/utils"
import { ConvertPage } from "@/pages/ConvertPage"
import { type AnalyzeRequest, DownloadPage } from "@/pages/DownloadPage"
import { FindPage } from "@/pages/FindPage"
import { HistoryPage } from "@/pages/HistoryPage"
import { SettingsPage } from "@/pages/SettingsPage"

const COLLAPSE_KEY = "downlee.sidebar-collapsed"

export default function App() {
  return (
    <TooltipProvider delayDuration={300}>
      <NoticeProvider>
        <Shell />
      </NoticeProvider>
    </TooltipProvider>
  )
}

function Shell() {
  const notify = useNotice()
  const [view, setView] = useState<AppView>("find")
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1"
    } catch {
      return false
    }
  })
  const [settings, setSettings] = useState<Settings | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [theme, setThemeState] = useState<ThemePreference>(readThemePreference)
  const [request, setRequest] = useState<AnalyzeRequest | null>(null)
  const [tools, setTools] = useState<ToolsStatus | null>(null)

  useEffect(() => {
    void bridge.getSettings().then(setSettings)
    void bridge.listQueue().then(setJobs)
    void bridge.toolsStatus().then(setTools)
    syncDesktopTheme(readThemePreference())
    const offs = [
      bridge.onJob((job) =>
        setJobs((list) => {
          const i = list.findIndex((j) => j.id === job.id)
          if (i < 0) return [...list, job]
          const next = list.slice()
          next[i] = job
          return next
        }),
      ),
      bridge.onJobRemoved((id) => setJobs((list) => list.filter((j) => j.id !== id))),
      bridge.onQueueReset(setJobs),
      bridge.onToolsUpdated(() => void bridge.toolsStatus().then(setTools)),
    ]
    return () => offs.forEach((off) => off())
  }, [])

  // 「システムに合わせる」ときは Windows の配色の切り替えに追従する
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const apply = () => applyTheme(resolveTheme(theme, systemPrefersDark()))
    mq.addEventListener("change", apply)
    return () => mq.removeEventListener("change", apply)
  }, [theme])

  const setTheme = (t: ThemePreference) => {
    setThemeState(t)
    writeThemePreference(t)
    applyTheme(resolveTheme(t, systemPrefersDark()))
    syncDesktopTheme(t)
  }

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1")
      } catch {
        /* 覚えられなくても切り替える */
      }
      return !c
    })
  }, [])

  // キーボード：Ctrl+1〜4 で画面、Ctrl+, で設定、Ctrl+B でサイドバー
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey) return
      const nav = NAV.find((n) => n.key === e.key)
      if (nav) setView(nav.id)
      else if (e.key === ",") setView("settings")
      else if (e.key.toLowerCase() === "b") toggleCollapsed()
      else return
      e.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [toggleCollapsed])

  const changeSettings = async (patch: Partial<Settings>) => {
    try {
      setSettings(await bridge.setSettings(patch))
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error")
    }
  }

  const analyzeFrom = (url: string, opts: { fromBrowser: boolean; referer?: string }) => {
    setRequest({ url, ...opts, nonce: Date.now() })
    setView("download")
  }

  // ツールの準備ができたかを、画面を切り替えたときに確かめ直す
  useEffect(() => {
    if (tools && !tools.ready) void bridge.toolsStatus().then(setTools)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  const active = jobs.filter((j) => j.type === "download" && ["running", "processing", "queued"].includes(j.status)).length

  return (
    <div className={cn("flex h-screen flex-col bg-background", isDesktop && "pt-8")}>
      <DesktopTitleBar />
      <div className="flex min-h-0 flex-1">
        <AppSidebar collapsed={collapsed} onToggleCollapsed={toggleCollapsed} view={view} onNavigate={setView} activeCount={active} />
        <main className="flex min-w-0 flex-1 flex-col">
          {tools && !tools.ready && view !== "settings" && (
            <div className="flex items-center gap-3 border-b border-[var(--semantic-warning-border)] bg-[var(--semantic-warning-bg)] px-6 py-2.5 text-sm text-[var(--semantic-warning-fg)]">
              <Wrench className="size-4 shrink-0" />
              <span className="flex-1">ダウンロードに使うツール（yt-dlp・ffmpeg）の準備が必要です。</span>
              <Button size="sm" variant="outline" onClick={() => setView("settings")}>
                準備する
              </Button>
            </div>
          )}
          <div className="min-h-0 flex-1">
            {settings && (
              <>
                <Page show={view === "download"}>
                  <DownloadPage settings={settings} jobs={jobs} request={request} onSettings={changeSettings} />
                </Page>
                <Page show={view === "find"}>
                  <FindPage settings={settings} onAnalyze={analyzeFrom} />
                </Page>
                <Page show={view === "convert"}>
                  <ConvertPage jobs={jobs} />
                </Page>
                {view === "history" && <HistoryPage />}
                {view === "settings" && <SettingsPage settings={settings} onChange={(p) => void changeSettings(p)} theme={theme} setTheme={setTheme} />}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}

/** 切り替えても中身（入力中の URL・読み込み結果）を保つため、隠すだけにする */
function Page({ show, children }: { show: boolean; children: React.ReactNode }) {
  return <div className={cn("h-full", !show && "hidden")}>{children}</div>
}
