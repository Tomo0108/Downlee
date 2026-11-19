import { FolderOpen, Loader2, Monitor, Moon, Plus, Puzzle, RefreshCw, Settings as SettingsIcon, Sun, Wrench, X } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { HelpButton } from "@/components/HelpButton"
import { NativeSelect, ProgressBar, SettingRow, useNotice } from "@/components/common"
import { PresetMenu } from "@/components/PresetMenu"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { bridge } from "@/lib/bridge"
import { formatBytes } from "@/lib/format"
import { CODECS, HEIGHTS, heightLabel } from "@/lib/presets"
import type { Codec, ExtensionInfo, Settings, ThemePreference, ToolsProgress, ToolsStatus } from "@/lib/types"
import { cn } from "@/lib/utils"

const SELECTED = "border-primary bg-primary-subtle text-foreground dark:border-primary dark:bg-primary-subtle dark:hover:bg-primary-subtle"

function Section({ title, hint, children, badge }: { title: string; hint?: string[]; children: ReactNode; badge?: ReactNode }) {
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="flex flex-row items-center gap-1 px-5 pt-4 pb-1">
        <CardTitle className="text-sm">{title}</CardTitle>
        {hint && <HelpButton title={title} items={hint} />}
        {badge && <div className="ml-auto">{badge}</div>}
      </CardHeader>
      <CardContent className="divide-y px-5 pb-2">{children}</CardContent>
    </Card>
  )
}

/** 入力し終えた（フォーカスが外れた・Enter）ときに保存する文字欄 */
function CommitInput({ value, onCommit, className, ...props }: { value: string; onCommit: (v: string) => void } & Omit<React.ComponentProps<typeof Input>, "value" | "onChange">) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <Input
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur()
      }}
      className={cn("h-9", className)}
      spellCheck={false}
      {...props}
    />
  )
}

/** 設定：保存先・既定の形式・字幕・仕上げ・速さ・ログイン・ツール・表示 */
export function SettingsPage({ settings, onChange, theme, setTheme }: { settings: Settings; onChange: (patch: Partial<Settings>) => void; theme: ThemePreference; setTheme: (t: ThemePreference) => void }) {
  const notify = useNotice()
  const [tools, setTools] = useState<ToolsStatus | null>(null)
  const [busy, setBusy] = useState<"install" | "update" | null>(null)
  const [progress, setProgress] = useState<ToolsProgress | null>(null)
  const [version, setVersion] = useState("")
  const s = settings
  const toggle = (key: keyof Settings) => <Switch checked={Boolean(s[key])} onCheckedChange={(v) => onChange({ [key]: v } as Partial<Settings>)} aria-label={key} />

  useEffect(() => {
    void bridge.toolsStatus().then(setTools)
    void bridge.appInfo().then((i) => setVersion(i.version))
    return bridge.onToolsProgress(setProgress)
  }, [])

  const install = async () => {
    setBusy("install")
    try {
      setTools(await bridge.installTools())
      notify("ツールを準備しました", "success")
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error")
    } finally {
      setBusy(null)
      setProgress(null)
    }
  }
  const update = async () => {
    setBusy("update")
    try {
      const v = await bridge.updateYtdlp()
      setTools(await bridge.toolsStatus())
      notify(`yt-dlp は最新です（${v}）`, "success")
    } catch (e) {
      notify(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e), "error")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-4 px-4 py-6 md:px-8 md:py-8">
        <h1 className="flex items-center gap-2 text-lg font-bold">
          <SettingsIcon className="size-5 text-primary" />
          設定
        </h1>

        <Section title="保存">
          <SettingRow label="保存先">
            <span className="max-w-80 truncate text-sm text-muted-foreground" title={s.outputDir}>
              {s.outputDir}
            </span>
            <Button size="sm" variant="outline" onClick={async () => { const n = await bridge.pickOutputFolder(); if (n) onChange({ outputDir: n.outputDir }) }}>
              変更
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="保存先を開く" onClick={() => void bridge.openOutputFolder()}>
              <FolderOpen />
            </Button>
          </SettingRow>
          <SettingRow label="ファイル名" hint={["%(title)s がタイトル、%(id)s が動画の ID、%(uploader)s が投稿者、%(upload_date)s が投稿日、%(ext)s が拡張子に置き換わります。", "「/」で区切るとフォルダを作ります（例：%(uploader)s/%(title)s.%(ext)s）。", ".150B は長すぎる名前を 150 バイトで切る指定です。"]}>
            <CommitInput value={s.filenameTemplate} onCommit={(v) => onChange({ filenameTemplate: v })} className="w-80 font-mono text-xs" aria-label="ファイル名" />
          </SettingRow>
          <SettingRow label="同じ名前があるとき" hint={["「上書きしない」では、同じ名前のファイルがあるとダウンロードしません。", "途中で止めたダウンロードは、どちらでも続きから再開します。"]}>
            <NativeSelect value={s.overwrite ? "1" : "0"} onChange={(e) => onChange({ overwrite: e.target.value === "1" })} className="w-40">
              <option value="0">上書きしない</option>
              <option value="1">上書きする</option>
            </NativeSelect>
          </SettingRow>
        </Section>

        <Section title="ダウンロードの既定" hint={["URL を貼ったときに最初に選ばれている形式・画質です。ダウンロードのたびに変えられます。", "「最高画質」は、その動画で選べる最も高い解像度（8K・4K など）・フレームレート・音質を選びます。"]}>
          <SettingRow label="形式">
            <PresetMenu value={s.defaultPreset} onChange={(id) => onChange({ defaultPreset: id })} size="sm" className="w-28" />
          </SettingRow>
          <SettingRow label="画質の上限">
            <NativeSelect value={s.defaultHeight} onChange={(e) => onChange({ defaultHeight: Number(e.target.value) })} className="w-40">
              {HEIGHTS.map((h) => (
                <option key={h} value={h}>
                  {heightLabel(h)}
                </option>
              ))}
            </NativeSelect>
          </SettingRow>
          <SettingRow label="コーデック" hint={["「おまかせ」は画質が最も高いものを選びます。", "古い機器・編集ソフトで再生できないときは「H.264」にしてください。"]}>
            <NativeSelect value={s.defaultCodec} onChange={(e) => onChange({ defaultCodec: e.target.value as Codec })} className="w-56">
              {CODECS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </NativeSelect>
          </SettingRow>
          <SettingRow label="MP3 の音質">
            <NativeSelect value={s.mp3Bitrate} onChange={(e) => onChange({ mp3Bitrate: e.target.value })} className="w-40">
              {["320K", "256K", "192K", "128K"].map((b) => (
                <option key={b} value={b}>
                  {b.replace("K", " kbps")}
                </option>
              ))}
            </NativeSelect>
          </SettingRow>
          <SettingRow label="貼ったらすぐ保存" hint={["オンにすると、URL を貼って Enter を押したとき、形式の一覧を出さずに既定の形式ですぐ保存します。"]}>
            {toggle("quickMode")}
          </SettingRow>
        </Section>

        <Section title="字幕">
          <SettingRow label="字幕を保存" hint={["動画と同じ名前の .srt ファイルとして保存します。"]}>{toggle("subtitles")}</SettingRow>
          {s.subtitles && (
            <>
              <SettingRow label="言語" hint={["言語コードをカンマで区切って入れます（例：ja,en）。", "all ですべての言語、ja.* で日本語の派生も含めます。"]}>
                <CommitInput value={s.subtitleLangs} onCommit={(v) => onChange({ subtitleLangs: v })} className="w-40" aria-label="字幕の言語" />
              </SettingRow>
              <SettingRow label="自動生成の字幕も使う">{toggle("autoSubtitles")}</SettingRow>
              <SettingRow label="動画に埋め込む" hint={["MP4・MKV・WebM・MOV のときに、字幕を動画ファイルの中にも入れます。"]}>
                {toggle("embedSubtitles")}
              </SettingRow>
            </>
          )}
        </Section>

        <Section title="仕上げ">
          <SettingRow label="サムネイルを埋め込む" hint={["MP4・MKV・MOV・MP3・M4A・FLAC・OGG のときに、ファイルのアイコンになる画像を入れます。"]}>{toggle("embedThumbnail")}</SettingRow>
          <SettingRow label="タイトル・投稿者などを書き込む">{toggle("embedMetadata")}</SettingRow>
          <SettingRow label="チャプターを書き込む">{toggle("embedChapters")}</SettingRow>
          <SettingRow label="サムネイル画像も保存">{toggle("writeThumbnail")}</SettingRow>
          <SettingRow label="スポンサー区間を除く" hint={["YouTube の動画で、SponsorBlock に登録されたスポンサー・宣伝・登録のお願いの区間を切り取ります。", "切り取るために作り直すので、少し時間がかかります。"]}>
            {toggle("sponsorBlockRemove")}
          </SettingRow>
        </Section>

        <Section title="速さ">
          <SettingRow label="同時にダウンロードする数">
            <NativeSelect value={s.maxConcurrent} onChange={(e) => onChange({ maxConcurrent: Number(e.target.value) })} className="w-24">
              {[1, 2, 3, 4, 5, 6, 8].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </NativeSelect>
          </SettingRow>
          <SettingRow label="分割ダウンロード" hint={["HLS・DASH の動画を、いくつに分けて同時に取りに行くかです。増やすと速くなることがありますが、サイトに拒否されることもあります。"]}>
            <NativeSelect value={s.concurrentFragments} onChange={(e) => onChange({ concurrentFragments: Number(e.target.value) })} className="w-24">
              {[1, 2, 4, 8, 16].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </NativeSelect>
          </SettingRow>
          <SettingRow label="速度の上限" hint={["空欄で上限なし。「5M」で毎秒 5 MB、「500K」で毎秒 500 KB です。"]}>
            <CommitInput value={s.rateLimit} onCommit={(v) => onChange({ rateLimit: v.trim() })} placeholder="上限なし" className="w-32" aria-label="速度の上限" />
          </SettingRow>
        </Section>

        <Section title="ログイン・接続">
          <SettingRow
            label="ブラウザのログイン情報"
            hint={[
              "ログインが必要な動画（メンバー限定・年齢確認など）を、選んだブラウザのログイン状態でダウンロードします。",
              "Chrome・Edge は、ブラウザ側の保護で読めないことがあります。そのときは Firefox を使うか、［見つける］の専用ブラウザでログインしてください。",
              "ログイン情報はその動画のサイトにだけ使い、ほかへ保存・送信はしません。",
            ]}
          >
            <NativeSelect value={s.cookiesFromBrowser} onChange={(e) => onChange({ cookiesFromBrowser: e.target.value })} className="w-40">
              <option value="">使わない</option>
              <option value="firefox">Firefox</option>
              <option value="chrome">Chrome</option>
              <option value="edge">Edge</option>
              <option value="brave">Brave</option>
              <option value="opera">Opera</option>
              <option value="vivaldi">Vivaldi</option>
            </NativeSelect>
          </SettingRow>
          <SettingRow label="専用ブラウザのデータ" hint={["［見つける］で使う専用ブラウザのログイン状態・閲覧データを消します。"]}>
            <Button size="sm" variant="outline" onClick={async () => { await bridge.clearBrowserData(); notify("専用ブラウザのデータを消しました") }}>
              消す
            </Button>
          </SettingRow>
          <SettingRow label="プロキシ" hint={["例：http://127.0.0.1:8080 、socks5://127.0.0.1:1080 。空欄で使いません。"]}>
            <CommitInput value={s.proxy} onCommit={(v) => onChange({ proxy: v.trim() })} placeholder="使わない" className="w-64" aria-label="プロキシ" />
          </SettingRow>
          <SettingRow label="除外するサイト" hint={["［見つける］で動画を拾わないドメインを、カンマか空白で区切って入れます（例：ads.example.com）。", "サブドメインも含めて除外します。"]}>
            <CommitInput value={s.blockedDomains} onCommit={(v) => onChange({ blockedDomains: v })} placeholder="なし" className="w-64" aria-label="除外するサイト" />
          </SettingRow>
        </Section>

        <Section title="専用ブラウザ（見つける）">
          <SettingRow label="広告をブロック" hint={["専用ブラウザで広告と追跡をブロックします（EasyList などのリスト。7 日ごとに更新）。", "動画広告などが［見つかったメディア］に並ばなくなります。", "ページが正しく動かないときはオフにしてください。"]}>
            {toggle("adBlock")}
          </SettingRow>
          <ExtensionsRow onSettings={(next) => onChange({ extensions: next.extensions })} />
        </Section>

        <Section title="通知と便利機能">
          <SettingRow label="コピーした URL を知らせる" hint={["動画の URL をコピーすると、［ダウンロード］の入力欄の下に出します。押すとすぐ読み込みます。"]}>
            {toggle("clipboardWatch")}
          </SettingRow>
          <SettingRow label="終わったら通知" hint={["Downlee を見ていないときに、Windows の通知で知らせます。"]}>{toggle("notifyOnDone")}</SettingRow>
        </Section>

        <Section
          title="ツール"
          hint={["Downlee は yt-dlp（動画の取得）と ffmpeg（結合・変換）を使います。どちらも無料のオープンソースです。", "サイトの仕様が変わると取得できなくなることがあります。yt-dlp を最新にすると直ることが多いです。", "ツールは %APPDATA%\\Downlee\\bin に置きます。"]}
          badge={tools && (tools.ready ? <Badge className="bg-[var(--semantic-success-bg)] text-[var(--semantic-success-fg)]">準備済み</Badge> : <Badge className="bg-[var(--semantic-warning-bg)] text-[var(--semantic-warning-fg)]">準備が必要</Badge>)}
        >
          <SettingRow label="yt-dlp">
            <span className="text-sm text-muted-foreground tabular-nums">{tools ? tools.ytdlp.version ?? "見つかりません" : "…"}</span>
            <Button size="sm" variant="outline" disabled={busy !== null || !tools?.ytdlp.version} onClick={() => void update()}>
              {busy === "update" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              最新にする
            </Button>
          </SettingRow>
          <SettingRow label="ffmpeg">
            <span className="max-w-64 truncate text-sm text-muted-foreground tabular-nums">{tools ? tools.ffmpeg.version ?? "見つかりません" : "…"}</span>
          </SettingRow>
          <SettingRow label="起動時に yt-dlp を最新にする">{toggle("autoUpdateYtdlp")}</SettingRow>
          {tools && !tools.ready && (
            <div className="flex flex-col gap-2 py-3">
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => void install()} disabled={busy !== null || !tools.canInstall}>
                  {busy === "install" ? <Loader2 className="animate-spin" /> : <Wrench />}
                  ツールを準備する
                </Button>
                {!tools.canInstall && <span className="text-xs text-muted-foreground">yt-dlp と ffmpeg を PATH に入れてください</span>}
              </div>
              {progress && (
                <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
                  <span className="w-44 shrink-0">
                    {progress.tool} {progress.stage === "extract" ? "展開中" : `${formatBytes(progress.downloaded)}${progress.total ? ` / ${formatBytes(progress.total)}` : ""}`}
                  </span>
                  <ProgressBar percent={progress.total && progress.downloaded ? (progress.downloaded / progress.total) * 100 : null} />
                </div>
              )}
            </div>
          )}
        </Section>

        <Section title="表示">
          <div className="grid gap-2 py-3 sm:grid-cols-3" role="group" aria-label="表示テーマ">
            {([
              { id: "system", label: "システムに合わせる", icon: Monitor },
              { id: "light", label: "ライト", icon: Sun },
              { id: "dark", label: "ダーク", icon: Moon },
            ] as const).map((t) => (
              <Button key={t.id} variant="outline" className={cn("justify-start", theme === t.id && SELECTED)} aria-pressed={theme === t.id} onClick={() => setTheme(t.id)}>
                <t.icon />
                {t.label}
              </Button>
            ))}
          </div>
        </Section>

        <Section title="上級者向け" hint={["yt-dlp にそのまま渡す追加の引数です。わかる方だけ使ってください。", "例：--limit-rate 2M --geo-bypass"]}>
          <SettingRow label="追加の引数">
            <CommitInput value={s.extraArgs} onCommit={(v) => onChange({ extraArgs: v })} placeholder="なし" className="w-80 font-mono text-xs" aria-label="追加の引数" />
          </SettingRow>
        </Section>

        <Separator className="my-2" />
        <p className="text-center text-xs text-muted-foreground">Downlee ver.{version}</p>
      </div>
    </div>
  )
}

/** 専用ブラウザに入れる拡張機能（展開済みのフォルダ） */
function ExtensionsRow({ onSettings }: { onSettings: (s: Settings) => void }) {
  const notify = useNotice()
  const [list, setList] = useState<ExtensionInfo[]>([])
  useEffect(() => {
    void bridge.listExtensions().then(setList)
  }, [])
  const run = async (p: Promise<{ settings: Settings; extensions: ExtensionInfo[] } | null>) => {
    try {
      const r = await p
      if (!r) return
      setList(r.extensions)
      onSettings(r.settings)
      const bad = r.extensions.find((e) => e.error)
      if (bad) notify(`${bad.name} を読み込めませんでした：${bad.error}`, "error")
    } catch (e) {
      notify(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e), "error")
    }
  }
  return (
    <div className="py-2">
      <SettingRow
        label="拡張機能"
        hint={[
          "専用ブラウザに Chrome の拡張機能を入れます。展開済みの拡張機能のフォルダ（manifest.json があるフォルダ）を選んでください。",
          "Chrome ウェブストアから直接は入れられません。Electron で動かない機能がある拡張機能もあります。",
          "広告ブロックは［広告をブロック］だけで足ります。uBlock Origin などを使いたいときに入れてください。",
        ]}
        className="py-0"
      >
        <Button size="sm" variant="outline" onClick={() => void run(bridge.addExtension())}>
          <Plus />
          追加
        </Button>
      </SettingRow>
      {list.length > 0 && (
        <ul className="mt-1 flex flex-col gap-1">
          {list.map((e) => (
            <li key={e.path} className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-1.5 text-sm">
              <Puzzle className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate" title={e.path}>
                {e.name}
                {e.version && <span className="ml-2 text-xs text-muted-foreground">{e.version}</span>}
              </span>
              {e.loaded ? (
                <Badge className="bg-[var(--semantic-success-bg)] text-[var(--semantic-success-fg)]">有効</Badge>
              ) : (
                <Badge className="bg-[var(--semantic-danger-bg)] text-[var(--semantic-danger-fg)]" title={e.error ?? undefined}>
                  読み込めません
                </Badge>
              )}
              <Button size="icon-xs" variant="ghost" aria-label={`${e.name} を外す`} onClick={() => void run(bridge.removeExtension(e.path))}>
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
