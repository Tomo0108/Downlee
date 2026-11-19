import { ArrowDownToLine, ClipboardPaste, Download, FolderOpen, Link2, Loader2, Pause, Play, Search, Trash2, X } from "lucide-react"
import { type FormEvent, useEffect, useRef, useState } from "react"
import { HelpButton } from "@/components/HelpButton"
import { JobList } from "@/components/JobList"
import { MediaCard } from "@/components/MediaCard"
import { PresetMenu } from "@/components/PresetMenu"
import { IconButton, ListFrame, useNotice } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { bridge } from "@/lib/bridge"
import { extractUrls, hostOf } from "@/lib/format"
import { presetById, requestFor } from "@/lib/presets"
import type { Job, JobRequest, MediaInfo, Settings } from "@/lib/types"

export interface AnalyzeRequest {
  url: string
  fromBrowser?: boolean
  referer?: string
  nonce: number
}

type AnalyzeState = { status: "idle" } | { status: "loading"; url: string } | { status: "ready"; info: MediaInfo; source: Omit<AnalyzeRequest, "nonce"> } | { status: "error"; url: string; message: string }

/** ダウンロード：URL を貼って、形式を選んで保存する。下に待ち行列 */
export function DownloadPage({ settings, jobs, request, onSettings }: { settings: Settings; jobs: Job[]; request: AnalyzeRequest | null; onSettings: (patch: Partial<Settings>) => void }) {
  const notify = useNotice()
  const [text, setText] = useState("")
  const [presetId, setPresetId] = useState(settings.defaultPreset)
  const [state, setState] = useState<AnalyzeState>({ status: "idle" })
  const [clip, setClip] = useState<string | null>(null)
  const seenClip = useRef<Set<string>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)
  const urls = extractUrls(text)

  useEffect(() => setPresetId(settings.defaultPreset), [settings.defaultPreset])

  // ［見つける］などから届いた解析の依頼
  useEffect(() => {
    if (!request) return
    setText(request.url)
    void analyze(request.url, { fromBrowser: request.fromBrowser, referer: request.referer })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.nonce])

  // クリップボードの URL を見張る（設定でオン・オフ）
  useEffect(() => {
    if (!settings.clipboardWatch) {
      setClip(null)
      return
    }
    let stop = false
    const check = async () => {
      if (stop || !document.hasFocus()) return
      try {
        const found = extractUrls(await bridge.readClipboard())[0]
        if (found && !seenClip.current.has(found)) setClip(found)
      } catch {
        /* 読めないときは何もしない */
      }
    }
    void check()
    const t = window.setInterval(check, 1500)
    window.addEventListener("focus", check)
    return () => {
      stop = true
      window.clearInterval(t)
      window.removeEventListener("focus", check)
    }
  }, [settings.clipboardWatch])

  async function analyze(url: string, opts: { fromBrowser?: boolean; referer?: string } = {}) {
    seenClip.current.add(url)
    setClip((c) => (c === url ? null : c))
    setState({ status: "loading", url })
    try {
      const info = await bridge.analyze(url, opts)
      setState({ status: "ready", info, source: { url, ...opts } })
    } catch (e) {
      setState({ status: "error", url, message: e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e) })
    }
  }

  async function enqueue(items: JobRequest[]) {
    try {
      const added = await bridge.addToQueue(items)
      notify(added.length > 1 ? `${added.length} 件を追加しました` : "ダウンロードを始めました", "info")
      setState({ status: "idle" })
      setText("")
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error")
    }
  }

  /** すぐにダウンロード（解析せずに既定の形式で入れる） */
  function quick(list: string[]) {
    const base = requestFor(presetById(presetId), { maxHeight: settings.defaultHeight, codec: settings.defaultCodec })
    for (const u of list) seenClip.current.add(u)
    void enqueue(list.map((url) => ({ url, ...base })))
  }

  function submit(e?: FormEvent) {
    e?.preventDefault()
    if (!urls.length) {
      notify("動画のページの URL を入れてください", "error")
      return
    }
    if (urls.length > 1 || settings.quickMode) quick(urls)
    else void analyze(urls[0])
  }

  const downloads = jobs.filter((j) => j.type === "download")
  const active = downloads.filter((j) => ["running", "processing", "queued"].includes(j.status)).length
  const paused = downloads.filter((j) => j.status === "paused").length
  const finished = downloads.filter((j) => ["done", "error", "canceled"].includes(j.status)).length
  const ordered = [...downloads].reverse()

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-5 px-4 py-6 md:px-8 md:py-8">
        <div className="flex items-center gap-1">
          <h1 className="text-lg font-bold">ダウンロード</h1>
          <HelpButton
            title="ダウンロード"
            sections={[
              { title: "使い方", items: ["動画のページの URL を貼り付けて Enter を押すと、画質と形式の一覧を読み込みます。", "［ダウンロード］で、選んだ形式・画質で保存します。既定は最高画質です。", "URL を複数まとめて貼ると、既定の形式でまとめてダウンロードします。"] },
              { title: "対応しているサイト", items: ["YouTube・X（Twitter）・ニコニコ動画・TVer・Vimeo など 1,800 以上のサイトに対応しています（yt-dlp を使っています）。", "対応していないページは［見つける］で開くと、ページが再生する動画を拾えます。"] },
              { title: "できないこと", items: ["DRM（著作権保護）がかかった動画（Netflix・Amazon Prime Video・Disney+ など）はダウンロードできません。保護を外す機能はありません。", "保存した動画は、著作権法とサイトの利用規約の範囲で使ってください。"] },
            ]}
          />
          <div className="ml-auto flex items-center gap-1">
            <IconButton label="保存先を開く" onClick={() => void bridge.openOutputFolder()}>
              <FolderOpen />
            </IconButton>
          </div>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-2">
          <div className="flex items-center gap-2 rounded-xl border bg-card p-1.5 shadow-card focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30">
            <Link2 className="ml-2 size-4 shrink-0 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={(e) => {
                const pasted = e.clipboardData.getData("text")
                const found = extractUrls(pasted)
                if (!text.trim() && found.length === 1 && !settings.quickMode) {
                  e.preventDefault()
                  setText(found[0])
                  void analyze(found[0])
                }
              }}
              placeholder="動画の URL を貼り付け"
              aria-label="動画の URL"
              className="h-10 border-0 bg-transparent px-1 text-[15px] shadow-none focus-visible:ring-0 dark:bg-transparent"
              autoFocus
              spellCheck={false}
            />
            {text && (
              <IconButton label="消す" onClick={() => { setText(""); setState({ status: "idle" }); inputRef.current?.focus() }}>
                <X />
              </IconButton>
            )}
            <PresetMenu value={presetId} onChange={(id) => { setPresetId(id); onSettings({ defaultPreset: id }) }} className="w-28" />
            <Button type="submit" className="min-w-32" disabled={state.status === "loading"}>
              {state.status === "loading" ? <Loader2 className="animate-spin" /> : urls.length > 1 || settings.quickMode ? <Download /> : <Search />}
              {urls.length > 1 ? `${urls.length} 件を保存` : settings.quickMode ? "ダウンロード" : "読み込む"}
            </Button>
          </div>
          {clip && state.status !== "loading" && (
            <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-1.5 text-sm">
              <ClipboardPaste className="size-4 shrink-0 text-primary" />
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                コピーした URL：<span className="text-foreground">{hostOf(clip)}</span> {clip.replace(/^https?:\/\/(www\.)?[^/]+/, "")}
              </span>
              <Button size="xs" variant="secondary" onClick={() => { setText(clip); void analyze(clip) }}>
                読み込む
              </Button>
              <Button size="xs" variant="ghost" onClick={() => quick([clip])}>
                すぐ保存
              </Button>
              <IconButton label="無視する" size="icon-xs" onClick={() => { seenClip.current.add(clip); setClip(null) }}>
                <X />
              </IconButton>
            </div>
          )}
        </form>

        {state.status === "loading" && (
          <Card className="flex-row items-center gap-3 px-4 py-5 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin text-primary" />
            <span className="min-w-0 flex-1 truncate">読み込み中… {hostOf(state.url)}</span>
            <Button size="sm" variant="ghost" onClick={() => { void bridge.cancelAnalyze(); setState({ status: "idle" }) }}>
              やめる
            </Button>
          </Card>
        )}
        {state.status === "error" && (
          <Card className="flex-row items-center gap-3 border-[var(--semantic-danger-border)] bg-[var(--semantic-danger-bg)] px-4 py-4 text-sm text-[var(--semantic-danger-fg)]">
            <span className="min-w-0 flex-1">{state.message}</span>
            <Button size="sm" variant="outline" onClick={() => quick([state.url])}>
              そのまま試す
            </Button>
            <IconButton label="閉じる" onClick={() => setState({ status: "idle" })}>
              <X />
            </IconButton>
          </Card>
        )}
        {state.status === "ready" && <MediaCard info={state.info} source={state.source} settings={{ ...settings, defaultPreset: presetId }} onDownload={enqueue} onClose={() => setState({ status: "idle" })} />}

        <section>
          <div className="mb-1 flex items-center gap-2 px-1">
            <h2 className="text-sm font-semibold">
              一覧
              {active > 0 && <span className="ml-2 font-normal text-muted-foreground tabular-nums">{active} 件 進行中</span>}
            </h2>
            <div className="ml-auto flex items-center gap-0.5">
              {active > 0 && (
                <IconButton label="すべて一時停止" onClick={() => void bridge.pauseAll()}>
                  <Pause />
                </IconButton>
              )}
              {paused > 0 && (
                <IconButton label="すべて再開" onClick={() => void bridge.resumeAll()}>
                  <Play />
                </IconButton>
              )}
              {finished > 0 && (
                <IconButton label="終わったものを消す" onClick={() => void bridge.clearFinished()}>
                  <Trash2 />
                </IconButton>
              )}
            </div>
          </div>
          <ListFrame empty={!ordered.length} icon={<ArrowDownToLine className="size-5" />} emptyTitle="URL を貼り付けると、ここに表示されます">
            <JobList jobs={ordered} />
          </ListFrame>
        </section>
      </div>
    </div>
  )
}
