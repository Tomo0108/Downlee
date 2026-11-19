import { Check, ChevronRight, Download, ListVideo, ShieldAlert, X } from "lucide-react"
import { useMemo, useState } from "react"
import { HelpButton } from "@/components/HelpButton"
import { IconButton, NativeSelect, Thumb } from "@/components/common"
import { PresetMenu } from "@/components/PresetMenu"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { formatBytes, formatDuration, hostOf, parseTime } from "@/lib/format"
import { CODECS, HEIGHTS, heightLabel, presetById, requestFor } from "@/lib/presets"
import type { Codec, FormatInfo, JobRequest, MediaInfo, PlaylistInfo, Settings, VideoInfo } from "@/lib/types"
import { cn } from "@/lib/utils"

interface Source {
  url: string
  fromBrowser?: boolean
  referer?: string
}

/** 解析した動画（またはプレイリスト）と、形式・画質の選択 */
export function MediaCard({ info, source, settings, onDownload, onClose }: { info: MediaInfo; source: Source; settings: Settings; onDownload: (items: JobRequest[]) => void; onClose: () => void }) {
  return info.kind === "playlist" ? (
    <PlaylistCard info={info} source={source} settings={settings} onDownload={onDownload} onClose={onClose} />
  ) : (
    <VideoCard info={info} source={source} settings={settings} onDownload={onDownload} onClose={onClose} />
  )
}

function useChoice(settings: Settings) {
  const [presetId, setPresetId] = useState(settings.defaultPreset)
  const [height, setHeight] = useState(settings.defaultHeight)
  const [codec, setCodec] = useState<Codec>(settings.defaultCodec)
  return { presetId, setPresetId, height, setHeight, codec, setCodec, preset: presetById(presetId) }
}

function HeightSelect({ value, onChange, heights, disabled }: { value: number; onChange: (h: number) => void; heights?: number[]; disabled?: boolean }) {
  const list = heights && heights.length ? [0, ...heights] : HEIGHTS
  return (
    <NativeSelect aria-label="画質" value={value} onChange={(e) => onChange(Number(e.target.value))} disabled={disabled} className="w-44">
      {list.map((h) => (
        <option key={h} value={h}>
          {h === 0 ? (heights?.[0] ? `最高画質（${heightLabel(heights[0])}）` : "最高画質") : heightLabel(h)}
        </option>
      ))}
    </NativeSelect>
  )
}

function VideoCard({ info, source, settings, onDownload, onClose }: { info: VideoInfo; source: Source; settings: Settings; onDownload: (items: JobRequest[]) => void; onClose: () => void }) {
  const c = useChoice(settings)
  const [more, setMore] = useState(false)
  const [formatId, setFormatId] = useState<string | null>(null)
  const [start, setStart] = useState("")
  const [end, setEnd] = useState("")
  const isAudio = c.preset.mode === "audio"
  const chosen = info.formats.find((f) => f.id === formatId) ?? null
  const startSec = parseTime(start)
  const endSec = parseTime(end)
  const rangeError = (start && startSec === null) || (end && endSec === null) || (startSec !== null && endSec !== null && endSec <= startSec)
  const best = info.formats.find((f) => f.kind !== "audio" && f.height === info.bestHeight)
  const hdr = info.formats.some((f) => f.dynamicRange && !f.drm)

  const download = () => {
    const req: JobRequest = {
      url: info.webpageUrl || source.url,
      title: info.title,
      thumbnail: info.thumbnail,
      duration: info.duration,
      uploader: info.uploader,
      ...requestFor(c.preset, { maxHeight: c.height, codec: c.codec }),
      fromBrowser: source.fromBrowser,
      referer: source.referer,
    }
    if (chosen) {
      req.formatId = chosen.id
      req.formatHasAudio = chosen.kind === "av" || chosen.kind === "audio"
      req.presetLabel = `${c.preset.short}・${chosen.height ? `${chosen.height}p` : chosen.ext} (#${chosen.id})`
    }
    if (startSec !== null || endSec !== null) req.sections = `${start || "0"}-${end || "inf"}`
    onDownload([req])
  }

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex gap-4 p-4">
        <Thumb src={info.thumbnail} audio={isAudio} className="w-44" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <h2 className="line-clamp-2 min-w-0 flex-1 text-[15px] leading-snug font-semibold">{info.title}</h2>
            <IconButton label="閉じる" onClick={onClose} className="-mt-1 -mr-1">
              <X />
            </IconButton>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {info.uploader && <span>{info.uploader}</span>}
            {info.duration ? <span className="tabular-nums">{formatDuration(info.duration)}</span> : null}
            <span>{info.extractor ?? hostOf(source.url)}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {info.bestHeight && <Badge className="bg-primary-subtle text-primary">最高 {heightLabel(info.bestHeight)}{best?.fps && best.fps > 30 ? ` ${Math.round(best.fps)}fps` : ""}</Badge>}
            {hdr && <Badge variant="outline">HDR</Badge>}
            {info.subtitles.length > 0 && <Badge variant="outline">字幕 {info.subtitles.length}</Badge>}
            {info.chapters > 0 && <Badge variant="outline">チャプター {info.chapters}</Badge>}
            {info.isLive && <Badge variant="destructive">ライブ</Badge>}
          </div>
        </div>
      </div>

      {info.drm ? (
        <div className="flex items-center gap-2 border-t border-[var(--semantic-danger-border)] bg-[var(--semantic-danger-bg)] px-4 py-3 text-sm text-[var(--semantic-danger-fg)]">
          <ShieldAlert className="size-4 shrink-0" />
          DRM（著作権保護）がかかっているため、ダウンロードできません。
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 border-t bg-muted/40 px-4 py-3">
            <PresetMenu value={c.presetId} onChange={(id) => { c.setPresetId(id); setFormatId(null) }} className="w-28" size="sm" />
            {!isAudio && !chosen && <HeightSelect value={c.height} onChange={c.setHeight} heights={info.heights} />}
            {chosen && (
              <Badge variant="outline" className="h-8 gap-1.5 px-2.5 text-xs">
                #{chosen.id} {chosen.height ? `${chosen.height}p` : chosen.acodec}
                <button type="button" aria-label="形式の指定をやめる" onClick={() => setFormatId(null)} className="opacity-60 hover:opacity-100">
                  <X className="size-3" />
                </button>
              </Badge>
            )}
            <Button type="button" variant="ghost" size="sm" onClick={() => setMore((v) => !v)} aria-expanded={more} className="text-muted-foreground">
              <ChevronRight className={cn("transition-transform", more && "rotate-90")} />
              詳細
            </Button>
            <div className="ml-auto" />
            <Button type="button" onClick={download} disabled={Boolean(rangeError)} className="min-w-36">
              <Download />
              ダウンロード
            </Button>
          </div>
          {more && (
            <div className="space-y-4 border-t px-4 py-4">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                {!isAudio && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm">コーデック</span>
                    <HelpButton title="コーデック" items={["「おまかせ」は画質が最も高いものを選びます（AV1・VP9 になることがあります）。", "古いテレビや編集ソフトで再生できないときは「H.264」を選んでください。互換性が高い代わりに、最高画質が下がることがあります。"]} />
                    <NativeSelect value={c.codec} onChange={(e) => c.setCodec(e.target.value as Codec)} className="w-56">
                      {CODECS.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-sm">区間</span>
                  <HelpButton title="区間" items={["一部分だけを保存します。「1:30」「1:02:05」のように時刻で入れます。", "片方だけ入れると、最初から／最後までになります。", "切り出す位置に合わせて作り直すため、少し時間がかかります。"]} />
                  <Input value={start} onChange={(e) => setStart(e.target.value)} placeholder="開始" className="h-9 w-24 tabular-nums" aria-label="開始" />
                  <span className="text-muted-foreground">–</span>
                  <Input value={end} onChange={(e) => setEnd(e.target.value)} placeholder="終了" className="h-9 w-24 tabular-nums" aria-label="終了" />
                  {rangeError && <span className="text-xs text-destructive">時刻を確かめてください</span>}
                </div>
              </div>
              <FormatTable formats={info.formats} value={formatId} onChange={setFormatId} audioOnly={isAudio} />
            </div>
          )}
        </>
      )}
    </Card>
  )
}

/** 形式の一覧から 1 つを直接選ぶ（上級者向け） */
function FormatTable({ formats, value, onChange, audioOnly }: { formats: FormatInfo[]; value: string | null; onChange: (id: string | null) => void; audioOnly: boolean }) {
  const list = formats.filter((f) => !f.drm && (audioOnly ? f.kind === "audio" : f.kind !== "audio" && f.kind !== "unknown"))
  if (!list.length) return null
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1 text-sm">
        形式を指定
        <HelpButton title="形式を指定" items={["ふつうは指定しなくても、最高画質が自動で選ばれます。", "行を選ぶと、その形式でダウンロードします。映像だけの形式には、最も良い音声を自動で組み合わせます。", "もう一度押すと指定をやめます。"]} />
      </div>
      <div className="max-h-64 overflow-y-auto rounded-md border">
        <table className="w-full text-xs tabular-nums">
          <thead className="sticky top-0 bg-muted text-left text-muted-foreground">
            <tr>
              <th className="w-8 px-2 py-1.5" />
              <th className="px-2 py-1.5 font-medium">{audioOnly ? "音声" : "解像度"}</th>
              <th className="px-2 py-1.5 font-medium">形式</th>
              <th className="px-2 py-1.5 font-medium">コーデック</th>
              <th className="px-2 py-1.5 text-right font-medium">大きさ</th>
              <th className="px-2 py-1.5 font-medium">ID</th>
            </tr>
          </thead>
          <tbody>
            {list.map((f) => {
              const selected = value === f.id
              return (
                <tr key={f.id} onClick={() => onChange(selected ? null : f.id)} className={cn("cursor-pointer border-t hover:bg-accent", selected && "bg-primary-subtle")} aria-selected={selected}>
                  <td className="px-2 py-1.5 text-primary">{selected && <Check className="size-3.5" />}</td>
                  <td className="px-2 py-1.5">
                    {audioOnly ? (f.abr ? `${Math.round(f.abr)} kbps` : "—") : f.height ? `${f.height}p${f.fps && f.fps > 30 ? Math.round(f.fps) : ""}` : "—"}
                    {f.dynamicRange && <span className="ml-1 text-primary">{f.dynamicRange}</span>}
                  </td>
                  <td className="px-2 py-1.5 uppercase">{f.ext}</td>
                  <td className="px-2 py-1.5">{[f.vcodec, f.acodec].filter(Boolean).join(" + ") || "—"}{f.kind === "video" && <span className="ml-1 text-muted-foreground">（映像のみ）</span>}</td>
                  <td className="px-2 py-1.5 text-right">{formatBytes(f.size) || "—"}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{f.id}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PlaylistCard({ info, source, settings, onDownload, onClose }: { info: PlaylistInfo; source: Source; settings: Settings; onDownload: (items: JobRequest[]) => void; onClose: () => void }) {
  const c = useChoice(settings)
  const [selected, setSelected] = useState<Set<number>>(() => new Set(info.entries.map((e) => e.index)))
  const allOn = selected.size === info.entries.length
  const total = useMemo(() => info.entries.filter((e) => selected.has(e.index)).reduce((a, e) => a + (e.duration ?? 0), 0), [info.entries, selected])
  const toggle = (i: number) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(i)) n.delete(i)
      else n.add(i)
      return n
    })

  const download = () => {
    const base = requestFor(c.preset, { maxHeight: c.height, codec: c.codec })
    const picked = info.entries.filter((e) => selected.has(e.index))
    const withUrls = picked.every((e) => /^https?:/i.test(e.url))
    if (withUrls) {
      onDownload(picked.map((e) => ({ url: e.url, title: e.title, thumbnail: e.thumbnail, duration: e.duration, uploader: info.uploader, ...base, fromBrowser: source.fromBrowser, referer: source.referer })))
    } else {
      // 項目ごとの URL がないサイトは、プレイリストのまま番号で指定する
      onDownload([{ url: info.webpageUrl || source.url, title: info.title, thumbnail: info.thumbnail, ...base, playlist: true, playlistItems: picked.map((e) => e.index).join(","), fromBrowser: source.fromBrowser, referer: source.referer }])
    }
  }

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex gap-4 p-4">
        <Thumb src={info.thumbnail} className="w-44" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <h2 className="line-clamp-2 min-w-0 flex-1 text-[15px] leading-snug font-semibold">
              <ListVideo className="mr-1.5 inline size-4 align-[-2px] text-primary" />
              {info.title}
            </h2>
            <IconButton label="閉じる" onClick={onClose} className="-mt-1 -mr-1">
              <X />
            </IconButton>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
            {info.uploader && <span>{info.uploader}</span>}
            <span>{info.count} 本</span>
            <span>{info.extractor ?? hostOf(source.url)}</span>
          </div>
        </div>
      </div>
      <div className="max-h-72 overflow-y-auto border-t">
        <label className="sticky top-0 z-10 flex cursor-pointer items-center gap-3 border-b bg-card px-4 py-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={allOn} onChange={() => setSelected(allOn ? new Set() : new Set(info.entries.map((e) => e.index)))} className="size-4 accent-[var(--primary)]" />
          すべて選ぶ
          <span className="ml-auto tabular-nums">
            {selected.size} / {info.entries.length} 本{total ? ` · ${formatDuration(total)}` : ""}
          </span>
        </label>
        <ul>
          {info.entries.map((e) => (
            <li key={e.index}>
              <label className="flex cursor-pointer items-center gap-3 px-4 py-1.5 hover:bg-accent/60">
                <input type="checkbox" checked={selected.has(e.index)} onChange={() => toggle(e.index)} className="size-4 shrink-0 accent-[var(--primary)]" />
                <span className="w-7 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{e.index}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{e.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatDuration(e.duration)}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t bg-muted/40 px-4 py-3">
        <PresetMenu value={c.presetId} onChange={c.setPresetId} className="w-28" size="sm" />
        {c.preset.mode !== "audio" && <HeightSelect value={c.height} onChange={c.setHeight} />}
        <div className="ml-auto" />
        <Button type="button" onClick={download} disabled={selected.size === 0} className="min-w-36">
          <Download />
          {selected.size} 本をダウンロード
        </Button>
      </div>
    </Card>
  )
}
