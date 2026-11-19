import { ArrowLeft, ArrowRight, CircleDot, Download, Globe, Loader2, RotateCw, Radar, Search, Trash2, X } from "lucide-react"
import { type FormEvent, useEffect, useState } from "react"
import { HelpButton } from "@/components/HelpButton"
import { IconButton, ListFrame, Thumb, useNotice, PageShell } from "@/components/common"
import { PresetMenu } from "@/components/PresetMenu"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { bridge } from "@/lib/bridge"
import { formatBytes, formatDuration, hostOf } from "@/lib/format"
import { presetById, requestFor } from "@/lib/presets"
import type { BrowserState, FoundMedia, Settings } from "@/lib/types"

const KIND_LABEL: Record<FoundMedia["kind"], string> = { hls: "HLS", dash: "DASH", mss: "Smooth", video: "動画", audio: "音声" }

/** 見つける：専用ブラウザでページを開き、再生される動画・音声を拾う */
export function FindPage({ settings, onAnalyze }: { settings: Settings; onAnalyze: (url: string, opts: { fromBrowser: boolean; referer?: string }) => void }) {
  const notify = useNotice()
  const [address, setAddress] = useState("")
  const [state, setState] = useState<BrowserState>({ open: false })
  const [found, setFound] = useState<FoundMedia[]>([])
  const [presetId, setPresetId] = useState(settings.defaultPreset)

  useEffect(() => {
    void bridge.browserState().then(setState)
    void bridge.listFound().then(setFound)
    const a = bridge.onBrowserState(setState)
    const b = bridge.onFound(setFound)
    return () => {
      a()
      b()
    }
  }, [])

  const open = async (e?: FormEvent) => {
    e?.preventDefault()
    try {
      setState(await bridge.openBrowser(address.trim() || undefined))
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error")
    }
  }

  const download = async (m: Pick<FoundMedia, "url" | "pageUrl" | "pageTitle" | "kind">, via?: "record") => {
    const preset = presetById(presetId)
    try {
      await bridge.addToQueue([{ url: m.url, title: m.pageTitle || hostOf(m.pageUrl), ...requestFor(preset, { maxHeight: settings.defaultHeight, codec: settings.defaultCodec }), referer: m.pageUrl, fromBrowser: true, sourceKind: m.kind, via }])
      notify(via === "record" ? "再生しながら記録を始めました。保存が終わるまでページを開いたままにしてください" : "ダウンロードを始めました")
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error")
    }
  }

  // ふだんは開いているページで見つかったものだけを出す（ほかのページの分と広告らしいものは［すべて］で見る）
  const [allPages, setAllPages] = useState(false)
  const pageKey = (u?: string) => (u ?? "").split("#")[0]
  const isCurrent = (m: FoundMedia) => !state.open || (state.nav !== undefined && m.nav === state.nav) || (!!state.url && pageKey(m.pageUrl) === pageKey(state.url))
  const visible = found.filter((m) => isCurrent(m) && !m.ad)
  // 見つけた順に下へ足していく
  const list = allPages ? found : visible
  const hidden = found.length - visible.length
  const analyzePage = () => state.url && onAnalyze(state.url, { fromBrowser: true })

  return (
    <PageShell title="見つける" help={
          <HelpButton
            title="見つける"
            sections={[
              { title: "使い方", items: ["ページを Downlee 専用のブラウザで開き、動画を再生してください。ページが読み込んだ動画・音声がここに並びます。", "［保存］で選んだ形式で保存します。［読み込む］では画質を選べます。", "HLS・DASH の容量に付く「約」は、画質と長さからの見積もりです。", "サイトに拒まれて保存できないときは、専用ブラウザのページから直接取り直します（HLS・動画ファイル）。保存が終わるまで、そのページを開いたままにしてください。", "それでも拒まれる HLS は、ページを読み直して最高画質・速めの再生で流し、プレーヤーが受け取ったデータをそのまま保存します（画質は落ちません）。", "［録画］で、最初からこの方法を選べます。上の赤い丸は、開いているページを丸ごと録画します。", "HLS 以外（DASH や独自のプレーヤー）とライブ配信は、プレーヤーが再生用に受け取ったデータをそのまま記録します。ライブ配信は旗のボタン［ここで終えて保存］で終えます。", "［このページを読み込む］は、開いているページそのものを［ダウンロード］で読み込みます。"] },
              { title: "ログインが必要なサイト", items: ["専用ブラウザでログインしておくと、そのログイン状態でダウンロードします。", "ログイン情報は Downlee の中だけに保存され、ふだんのブラウザとは分かれています。［設定］から消せます。"] },
              { title: "広告", items: ["専用ブラウザでは広告と追跡をブロックし、動画広告らしいものは隠します（［設定］で切り替え）。", "ほかのページで見つかったものと広告らしいものは［すべて］で表示します。", "ブラウザの拡張機能（展開済みのフォルダ）も［設定］から入れられます。"] },
              { title: "見つからないとき", items: ["一度再生を始めると見つかることがあります。", "それでも出ないときは［このページを読み込む］で、ページごと読み込めます。", "［すべて］を押すと、広告と判定して隠したものも表示します。", "DRM（著作権保護）がかかった動画は再生もダウンロードもできません。", "除外するサイトは［設定］で指定できます。"] },
              { title: "操作", items: ["専用ブラウザでは Alt+← で戻る、Alt+→ で進む、F5 で読み直しです。"] },
            ]}
          />
        }>

        <form onSubmit={open} className="flex items-center gap-2 rounded-xl border bg-card p-1.5 shadow-card focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30">
          <Globe className="ml-2 size-4 shrink-0 text-muted-foreground" />
          <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="ページの URL か検索する言葉" aria-label="ページの URL" className="h-10 border-0 bg-transparent px-1 text-[15px] shadow-none focus-visible:ring-0 dark:bg-transparent" spellCheck={false} />
          <Button type="submit" className="min-w-32">
            <Globe />
            開く
          </Button>
        </form>

        {state.open && (
          <Card className="flex-row items-center gap-2 px-3 py-2">
            <IconButton label="戻る" disabled={!state.canGoBack} onClick={() => void bridge.controlBrowser("back")}>
              <ArrowLeft />
            </IconButton>
            <IconButton label="進む" disabled={!state.canGoForward} onClick={() => void bridge.controlBrowser("forward")}>
              <ArrowRight />
            </IconButton>
            <IconButton label="読み直す" onClick={() => void bridge.controlBrowser("reload")}>
              {state.loading ? <Loader2 className="animate-spin" /> : <RotateCw />}
            </IconButton>
            <button type="button" className="min-w-0 flex-1 truncate text-left text-sm hover:underline" onClick={() => void bridge.controlBrowser("focus")} title={state.url}>
              {state.title || hostOf(state.url)}
              <span className="ml-2 text-xs text-muted-foreground">{hostOf(state.url)}</span>
            </button>
            <Button size="sm" variant="secondary" onClick={analyzePage}>
              <Search />
              このページを読み込む
            </Button>
            <IconButton label="このページを録画（再生しながら記録）" disabled={!state.url} onClick={() => state.url && void download({ url: state.url, pageUrl: state.url, pageTitle: state.title ?? "", kind: "hls" }, "record")}>
              <CircleDot className="text-destructive" />
            </IconButton>
            <IconButton label="専用ブラウザを閉じる" onClick={() => void bridge.controlBrowser("close")}>
              <X />
            </IconButton>
          </Card>
        )}

        <section>
          <div className="mb-1.5 flex min-h-8 items-center gap-2 px-1">
            <h2 className="text-sm font-semibold">
              見つかったメディア
              {list.length > 0 && <span className="ml-2 font-normal text-muted-foreground tabular-nums">{list.length}</span>}
            </h2>
            <div className="ml-auto flex items-center gap-1">
              {(hidden > 0 || allPages) && (
                <Button size="sm" variant="ghost" className="text-muted-foreground" aria-pressed={allPages} onClick={() => setAllPages((v) => !v)}>
                  {allPages ? "このページだけ" : `すべて（+${hidden}）`}
                </Button>
              )}
              <PresetMenu value={presetId} onChange={setPresetId} size="sm" className="w-28" />
              {found.length > 0 && (
                <IconButton label="一覧を消す" onClick={() => void bridge.clearFound()}>
                  <Trash2 />
                </IconButton>
              )}
            </div>
          </div>
          <ListFrame
            empty={!list.length}
            icon={<Radar className="size-5" />}
            emptyTitle={state.open ? "動画を再生しても出ないときは、ページごと読み込めます" : "ページを開くと、再生される動画がここに並びます"}
            emptyAction={
              state.open && state.url ? (
                <Button size="sm" variant="secondary" onClick={analyzePage}>
                  <Search />
                  このページを読み込む
                </Button>
              ) : undefined
            }
          >
            <ul className="flex flex-col gap-0.5">
              {list.map((m) => (
                <li key={m.id} className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-accent/60">
                  <Thumb src={m.thumbnail} audio={m.kind === "audio"} className="w-24" />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <Badge variant="outline" className="shrink-0 text-[11px]">
                        {KIND_LABEL[m.kind]}
                      </Badge>
                      <span className="truncate text-sm font-medium">{m.pageTitle || hostOf(m.pageUrl)}</span>
                      {m.ad && (
                        <Badge variant="outline" className="shrink-0 text-[11px] font-normal text-muted-foreground">
                          広告かも
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground tabular-nums" title={m.url}>
                      {[m.size ? `${m.sizeApprox ? "約 " : ""}${formatBytes(m.size)}` : "", m.height ? `${m.height}p` : "", formatDuration(m.duration), hostOf(m.url)].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => onAnalyze(m.url, { fromBrowser: true, referer: m.pageUrl })}>
                    <Search />
                    読み込む
                  </Button>
                  {m.kind === "hls" && (
                    <Button size="sm" variant="ghost" onClick={() => void download(m, "record")} title="再生しながら記録（最高画質）">
                      <CircleDot className="text-destructive" />
                      録画
                    </Button>
                  )}
                  <Button size="sm" onClick={() => void download(m)}>
                    <Download />
                    保存
                  </Button>
                </li>
              ))}
            </ul>
          </ListFrame>
        </section>
    </PageShell>
  )
}
