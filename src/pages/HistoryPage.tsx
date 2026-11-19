import { Copy, Download, FolderOpen, History, Play, Search, Trash2, X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { HelpButton } from "@/components/HelpButton"
import { IconButton, ListFrame, Thumb, useNotice } from "@/components/common"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { bridge } from "@/lib/bridge"
import { formatBytes, formatDate, formatDuration, hostOf } from "@/lib/format"
import type { HistoryEntry } from "@/lib/types"

/** 履歴：これまでに保存したもの。開く・フォルダを表示・もう一度ダウンロード */
export function HistoryPage() {
  const notify = useNotice()
  const [items, setItems] = useState<HistoryEntry[]>([])
  const [query, setQuery] = useState("")
  const [confirm, setConfirm] = useState(false)

  useEffect(() => {
    const load = () => void bridge.listHistory().then(setItems)
    load()
    return bridge.onHistoryChanged(load)
  }, [])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((h) => [h.title, h.uploader, h.url, h.presetLabel, ...h.files].some((v) => v?.toLowerCase().includes(q)))
  }, [items, query])

  const run = (p: Promise<unknown>) => p.catch((e: Error) => notify(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), "error"))
  const remove = async (id: string) => {
    await bridge.removeHistory([id])
    setItems((l) => l.filter((h) => h.id !== id))
  }
  const again = async (h: HistoryEntry) => {
    if (!h.url) return
    await run(bridge.addToQueue([{ ...(h.request ?? {}), url: h.url, title: h.title, thumbnail: h.thumbnail, presetLabel: h.presetLabel ?? undefined }]).then(() => notify("もう一度ダウンロードします")))
  }
  const total = items.reduce((a, h) => a + (h.size || 0), 0)

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-5 px-4 py-6 md:px-8 md:py-8">
        <div className="flex items-center gap-1">
          <h1 className="text-lg font-bold">履歴</h1>
          <HelpButton title="履歴" items={["保存が終わったダウンロードと変換が並びます（新しい順、最大 3,000 件）。", "履歴から消しても、保存したファイルは消えません。", "［もう一度ダウンロード］は、前と同じ形式・画質で保存し直します。"]} />
          {items.length > 0 && <span className="ml-2 text-xs text-muted-foreground tabular-nums">{items.length} 件 · {formatBytes(total)}</span>}
          <div className="ml-auto">
            {items.length > 0 && (
              <IconButton label="履歴をすべて消す" onClick={() => setConfirm(true)}>
                <Trash2 />
              </IconButton>
            )}
          </div>
        </div>

        {items.length > 0 && (
          <div className="relative">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="名前・サイトで探す" className="h-10 pl-9" aria-label="履歴を探す" />
            {query && (
              <IconButton label="消す" size="icon-xs" className="absolute top-1/2 right-2 -translate-y-1/2" onClick={() => setQuery("")}>
                <X />
              </IconButton>
            )}
          </div>
        )}

        <ListFrame empty={!shown.length} icon={<History className="size-5" />} emptyTitle={items.length ? "見つかりません" : "保存したものがここに並びます"}>
            <ul className="flex flex-col gap-0.5">
              {shown.map((h) => {
                const file = h.files[h.files.length - 1]
                return (
                  <li key={h.id} className="group flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-accent/60">
                    <Thumb src={h.thumbnail} audio={/^(MP3|M4A|AAC|FLAC|WAV|Opus|OGG|音声)/i.test(h.presetLabel ?? "")} className="w-24" />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-medium">{h.title}</span>
                        {h.presetLabel && (
                          <Badge variant="outline" className="shrink-0 text-[11px] font-normal text-muted-foreground">
                            {h.presetLabel}
                          </Badge>
                        )}
                        {h.partial && <Badge className="shrink-0 bg-[var(--semantic-warning-bg)] text-[11px] text-[var(--semantic-warning-fg)]">一部</Badge>}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground tabular-nums">
                        {[formatDate(h.finishedAt), h.type === "convert" ? "変換" : hostOf(h.url), formatDuration(h.duration), formatBytes(h.size)].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5 opacity-80 group-hover:opacity-100">
                      {file && (
                        <>
                          <IconButton label="再生する" onClick={() => void run(bridge.openFile(file))}>
                            <Play />
                          </IconButton>
                          <IconButton label="フォルダを開く" onClick={() => void run(bridge.showInFolder(file))}>
                            <FolderOpen />
                          </IconButton>
                        </>
                      )}
                      {h.url && (
                        <>
                          <IconButton label="もう一度ダウンロード" onClick={() => void again(h)}>
                            <Download />
                          </IconButton>
                          <IconButton label="URL をコピー" onClick={() => void navigator.clipboard.writeText(h.url!).then(() => notify("URL をコピーしました"))}>
                            <Copy />
                          </IconButton>
                        </>
                      )}
                      <IconButton label="履歴から消す" onClick={() => void remove(h.id)}>
                        <X />
                      </IconButton>
                    </div>
                  </li>
                )
              })}
            </ul>
        </ListFrame>
      </div>

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>履歴をすべて消しますか？</DialogTitle>
            <DialogDescription>{items.length} 件の履歴を消します。保存したファイルは消えません。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              やめる
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                await bridge.clearHistory()
                setItems([])
                setConfirm(false)
                notify("履歴を消しました")
              }}
            >
              消す
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
