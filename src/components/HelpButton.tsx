import { CircleHelp } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export interface HelpSection {
  title?: string
  items: string[]
}

interface Props {
  /** ヘルプの見出し（何についての説明か） */
  title: string
  /** 箇条書き。1 項目 1〜2 文 */
  items?: string[]
  /** 見出しつきで分けたいとき */
  sections?: HelpSection[]
  /** ボタンの読み上げ名・ツールチップ（既定：「◯◯の説明」） */
  label?: string
  size?: "xs" | "sm"
  className?: string
}

/**
 * 説明文を画面に常時出さず、? ボタンに格納する（RakuManual の SectionHelpButton と同じ作法）。
 * 見出し・ラベルの右に置き、押すと小さなダイアログで箇条書きの説明を出す。
 * 使い方の決まりは docs/ui-guidelines.md を参照。
 */
export function HelpButton({ title, items, sections, label, size = "xs", className }: Props) {
  const [open, setOpen] = useState(false)
  const groups: HelpSection[] = sections ?? [{ items: items ?? [] }]
  const name = label ?? `${title}の説明`
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(size === "xs" ? "size-5 rounded-full" : "size-7", "shrink-0 text-muted-foreground hover:text-primary", className)}
            onClick={(e) => {
              e.stopPropagation()
              e.preventDefault()
              setOpen(true)
            }}
            aria-label={name}
          >
            <CircleHelp className={size === "xs" ? "size-3.5" : "size-4"} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">説明</TooltipContent>
      </Tooltip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <CircleHelp className="size-4 text-primary" />
              {title}
            </DialogTitle>
          </DialogHeader>
          <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
            {groups.map((g, gi) => (
              <section key={gi}>
                {g.title && <h4 className="mb-1.5 text-xs font-semibold">{g.title}</h4>}
                <ul className="space-y-2 text-[13px] leading-relaxed text-muted-foreground">
                  {g.items.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span className="text-primary">•</span>
                      <span className="whitespace-pre-line">{item}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** 長い説明を「。」で区切って箇条書きにする（既存の説明文をヘルプへ移すとき用） */
export function splitHelp(text: string): string[] {
  return text
    .split(/(?<=。)/)
    .map((s) => s.trim())
    .filter(Boolean)
}
