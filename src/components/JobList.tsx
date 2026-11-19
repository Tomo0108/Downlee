import { CircleAlert, CircleCheck, Flag, FolderOpen, Pause, Play, RotateCcw, Square, X } from "lucide-react"
import { IconButton, ProgressBar, Thumb, useNotice } from "@/components/common"
import { Badge } from "@/components/ui/badge"
import { MarqueeText } from "@/components/ui/marquee-text"
import { bridge } from "@/lib/bridge"
import { formatBytes, formatDuration, formatSpeed, hostOf } from "@/lib/format"
import type { Job } from "@/lib/types"
import { cn } from "@/lib/utils"

const STATUS_TEXT: Record<Job["status"], string> = {
  queued: "待機中",
  running: "ダウンロード中",
  processing: "仕上げ中",
  paused: "一時停止",
  done: "完了",
  error: "失敗",
  canceled: "中止",
}

function statusLine(job: Job): string {
  const p = job.progress
  if (job.status === "error") return job.error?.text ?? "失敗しました。"
  if (job.status === "done") {
    const first = job.files[0]
    return job.partial ? `一部完了（${job.error?.text ?? "失敗した項目があります"}）` : first ? first.split(/[\\/]/).pop() ?? "" : "完了"
  }
  if (job.status === "processing" || p.stage) return p.stage ?? STATUS_TEXT.processing
  if (job.status === "running") {
    if (job.type === "convert") return p.percent !== null ? `変換中 ${Math.floor(p.percent)}%` : "変換中"
    const parts: string[] = []
    if (p.playlistCount && p.playlistIndex) parts.push(`${p.playlistIndex}/${p.playlistCount}`)
    if (p.percent !== null) parts.push(`${p.percent.toFixed(1)}%`)
    if (p.total) parts.push(`${formatBytes(p.downloaded)} / ${formatBytes(p.total)}`)
    if (p.speed) parts.push(formatSpeed(p.speed))
    if (p.eta) parts.push(`残り ${formatDuration(p.eta)}`)
    return parts.length ? parts.join(" · ") : "準備中"
  }
  if (job.status === "paused" && p.percent) return `一時停止 · ${p.percent.toFixed(1)}%`
  return STATUS_TEXT[job.status]
}

/** ダウンロード・変換の 1 件 */
export function JobRow({ job }: { job: Job }) {
  const notify = useNotice()
  const active = job.status === "running" || job.status === "processing"
  const finished = job.status === "done" || job.status === "error" || job.status === "canceled"
  const tone = job.status === "error" ? "danger" : job.status === "done" ? "done" : job.status === "paused" || job.status === "queued" || job.status === "canceled" ? "muted" : "primary"
  const percent = job.status === "processing" ? null : job.status === "queued" ? 0 : job.progress.percent ?? (job.status === "running" ? null : 0)
  const file = job.files[job.files.length - 1]
  const run = (p: Promise<unknown>) => p.catch((e: Error) => notify(e.message, "error"))
  const title = job.currentTitle && job.playlist ? `${job.title} — ${job.currentTitle}` : job.title

  return (
    <li className="group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-accent/60">
      <Thumb src={job.thumbnail} audio={job.mode === "audio" || ["mp3", "m4a", "aac", "flac", "opus", "wav", "ogg"].includes(job.target ?? "")} className="w-24" />
      <div className="marquee-host min-w-0 flex-1" tabIndex={-1}>
        <div className="flex min-w-0 items-center gap-2">
          {job.status === "done" && !job.partial && <CircleCheck className="size-4 shrink-0 text-[var(--semantic-success-fg)]" aria-label="完了" />}
          {(job.status === "error" || job.partial) && <CircleAlert className="size-4 shrink-0 text-destructive" aria-label="失敗" />}
          <MarqueeText text={title || job.url || ""} className="min-w-0 flex-1 text-sm font-medium" />
          {job.presetLabel && (
            <Badge variant="outline" className="shrink-0 text-[11px] font-normal text-muted-foreground">
              {job.presetLabel}
            </Badge>
          )}
        </div>
        <div className={cn("mt-0.5 truncate text-xs text-muted-foreground tabular-nums", job.status === "error" && "text-destructive")} title={job.detail ?? undefined}>
          {statusLine(job)}
          {job.status === "queued" && job.url && <span className="ml-2 opacity-70">{hostOf(job.url)}</span>}
        </div>
        {!finished && <ProgressBar percent={percent} tone={tone} className="mt-1.5" />}
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-80 group-hover:opacity-100">
        {active && (
          <IconButton label="一時停止" onClick={() => run(bridge.pauseJob(job.id))}>
            <Pause />
          </IconButton>
        )}
        {job.status === "paused" && (
          <IconButton label="再開" onClick={() => run(bridge.resumeJob(job.id))}>
            <Play />
          </IconButton>
        )}
        {(job.status === "error" || job.status === "canceled") && (
          <IconButton label="やり直す" onClick={() => run(bridge.resumeJob(job.id))}>
            <RotateCcw />
          </IconButton>
        )}
        {job.via === "record" && job.status === "running" && (
          <IconButton label="ここで終えて保存" onClick={() => run(bridge.finishJobNow(job.id))}>
            <Flag />
          </IconButton>
        )}
        {!finished && (
          <IconButton label="中止" onClick={() => run(bridge.cancelJob(job.id))}>
            <Square />
          </IconButton>
        )}
        {job.status === "done" && file && (
          <>
            <IconButton label="再生する" onClick={() => run(bridge.openFile(file))}>
              <Play />
            </IconButton>
            <IconButton label="フォルダを開く" onClick={() => run(bridge.showInFolder(file))}>
              <FolderOpen />
            </IconButton>
          </>
        )}
        {finished && (
          <IconButton label="一覧から消す" onClick={() => run(bridge.removeJob(job.id))}>
            <X />
          </IconButton>
        )}
      </div>
    </li>
  )
}

export function JobList({ jobs }: { jobs: Job[] }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {jobs.map((j) => (
        <JobRow key={j.id} job={j} />
      ))}
    </ul>
  )
}
