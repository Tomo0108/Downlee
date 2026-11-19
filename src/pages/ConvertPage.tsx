import { FileVideo, Plus, Repeat, Trash2, X } from "lucide-react"
import { type DragEvent, useState } from "react"
import { HelpButton } from "@/components/HelpButton"
import { JobList } from "@/components/JobList"
import { IconButton, ListFrame, useNotice } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { bridge, isDesktop } from "@/lib/bridge"
import { formatBytes, parseTime } from "@/lib/format"
import { CONVERT_TARGETS } from "@/lib/presets"
import type { Job, LocalFile } from "@/lib/types"
import { cn } from "@/lib/utils"

/** 変換：手元の動画・音声ファイルを別の形式にする（ffmpeg） */
export function ConvertPage({ jobs }: { jobs: Job[] }) {
  const notify = useNotice()
  const [files, setFiles] = useState<LocalFile[]>([])
  const [target, setTarget] = useState("mp4")
  const [start, setStart] = useState("")
  const [end, setEnd] = useState("")
  const [drag, setDrag] = useState(false)
  const rangeError = (start && parseTime(start) === null) || (end && parseTime(end) === null)

  const add = (list: LocalFile[]) => setFiles((cur) => [...cur, ...list.filter((f) => !cur.some((c) => c.path === f.path))])

  const onDrop = async (e: DragEvent) => {
    e.preventDefault()
    setDrag(false)
    const paths = [...e.dataTransfer.files].map((f) => bridge.pathForFile(f)).filter(Boolean)
    if (!isDesktop) return add([...e.dataTransfer.files].map((f) => ({ path: f.name, name: f.name, size: f.size })))
    add(await bridge.statFiles(paths))
  }

  const convert = async () => {
    try {
      await bridge.addToQueue(files.map((f) => ({ type: "convert", input: f.path, target, start: start || undefined, end: end || undefined })))
      notify(`${files.length} 件の変換を始めました`)
      setFiles([])
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error")
    }
  }

  const converts = [...jobs.filter((j) => j.type === "convert")].reverse()
  const finished = converts.filter((j) => ["done", "error", "canceled"].includes(j.status)).length

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-5 px-4 py-6 md:px-8 md:py-8">
        <div className="flex items-center gap-1">
          <h1 className="text-lg font-bold">変換</h1>
          <HelpButton
            title="変換"
            items={[
              "手元の動画・音声ファイルを、別の形式に変換します。",
              "変換したファイルは元のファイルと同じフォルダに保存します。同じ名前があるときは (2) などを付けます。",
              "MKV は作り直さずに入れ物だけを変えるので速く、画質も落ちません。MP4・MOV は H.264 で作り直します（高画質の設定）。",
              "GIF は横 480 ピクセル・12 コマ毎秒で作ります。長い動画は区間を指定してください。",
              "区間は「1:30」のように時刻で入れます。片方だけでもかまいません。",
            ]}
          />
        </div>

        <Card
          className={cn("gap-0 p-0 transition-colors", drag && "drop-active")}
          onDragOver={(e) => {
            e.preventDefault()
            setDrag(true)
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => void onDrop(e)}
        >
          {files.length === 0 ? (
            <button type="button" className="flex flex-col items-center gap-3 px-6 py-12 text-center" onClick={async () => add(await bridge.pickConvertFiles())}>
              <div className="flex size-12 items-center justify-center rounded-full bg-primary-subtle text-primary">
                <FileVideo className="size-5" />
              </div>
              <div className="text-sm font-medium">ファイルをここに落とすか、押して選ぶ</div>
            </button>
          ) : (
            <ul className="flex flex-col gap-0.5 p-1.5">
              {files.map((f) => (
                <li key={f.path} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-accent/60">
                  <FileVideo className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm">{f.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{formatBytes(f.size)}</span>
                  <IconButton label="外す" size="icon-xs" onClick={() => setFiles((cur) => cur.filter((c) => c.path !== f.path))}>
                    <X />
                  </IconButton>
                </li>
              ))}
              <li>
                <Button variant="ghost" size="sm" className="ml-1 text-muted-foreground" onClick={async () => add(await bridge.pickConvertFiles())}>
                  <Plus />
                  ファイルを足す
                </Button>
              </li>
            </ul>
          )}
          <div className="flex flex-col gap-3 border-t bg-muted/40 px-4 py-3">
            <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="変換先の形式">
              {CONVERT_TARGETS.map((t, i) => (
                <span key={t.id} className="contents">
                  {i > 0 && CONVERT_TARGETS[i - 1].group !== t.group && <span className="mx-1 h-5 w-px bg-border" aria-hidden />}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={target === t.id}
                    onClick={() => setTarget(t.id)}
                    className={cn(
                      "h-8 rounded-md border px-3 text-xs font-medium transition-colors",
                      target === t.id ? "border-primary bg-primary-subtle text-foreground" : "border-input bg-card text-muted-foreground hover:bg-accent hover:text-foreground dark:bg-input/30",
                    )}
                  >
                    {t.label}
                  </button>
                </span>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">区間</span>
              <Input value={start} onChange={(e) => setStart(e.target.value)} placeholder="開始" className="h-9 w-24 tabular-nums" aria-label="開始" />
              <span className="text-muted-foreground">–</span>
              <Input value={end} onChange={(e) => setEnd(e.target.value)} placeholder="終了" className="h-9 w-24 tabular-nums" aria-label="終了" />
              {rangeError && <span className="text-xs text-destructive">時刻を確かめてください</span>}
              <div className="ml-auto" />
              <Button onClick={() => void convert()} disabled={!files.length || Boolean(rangeError)} className="min-w-32">
                <Repeat />
                変換
              </Button>
            </div>
          </div>
        </Card>

        <section>
          <div className="mb-1 flex items-center gap-2 px-1">
            <h2 className="text-sm font-semibold">一覧</h2>
            {finished > 0 && (
              <IconButton label="終わったものを消す" className="ml-auto" onClick={() => void bridge.clearFinished()}>
                <Trash2 />
              </IconButton>
            )}
          </div>
          <ListFrame empty={!converts.length} icon={<Repeat className="size-5" />} emptyTitle="変換したファイルがここに並びます">
            <JobList jobs={converts} />
          </ListFrame>
        </section>
      </div>
    </div>
  )
}
