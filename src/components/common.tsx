import { Film, Music } from "lucide-react"
import { type ComponentProps, type ReactNode, createContext, useCallback, useContext, useState } from "react"
import { HelpButton, splitHelp } from "@/components/HelpButton"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/** アイコンだけのボタン。名前はツールチップと読み上げで補う */
export function IconButton({ label, children, className, variant = "ghost", size = "icon-sm", ...props }: { label: string } & ComponentProps<typeof Button>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant={variant} size={size} aria-label={label} className={cn("text-muted-foreground hover:text-foreground", className)} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

/** 見た目をそろえた選択欄（OS の選択欄を使う） */
export function NativeSelect({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-9 min-w-0 rounded-md border border-input bg-card px-2.5 pr-8 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  )
}

/** 進捗バー。percent が null のときは流れる帯で「処理中」を示す */
export function ProgressBar({ percent, tone = "primary", className }: { percent: number | null; tone?: "primary" | "muted" | "danger" | "done"; className?: string }) {
  const fill = tone === "danger" ? "bg-destructive" : tone === "muted" ? "bg-muted-foreground/40" : tone === "done" ? "bg-[var(--semantic-success-fg)]" : "brand-gradient"
  return (
    <div className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-muted", className)} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}>
      {percent === null ? (
        <div className={cn("progress-indeterminate absolute inset-y-0 w-1/3 rounded-full", fill)} />
      ) : (
        <div className={cn("relative h-full overflow-hidden rounded-full transition-[width] duration-300 ease-out", fill)} style={{ width: `${Math.max(2, Math.min(100, percent))}%` }}>
          {tone === "primary" && percent < 100 && <div className="progress-sheen absolute inset-y-0 w-1/4 bg-white/35" />}
        </div>
      )}
    </div>
  )
}

/** サムネイル。読めないときは種類のアイコンを出す */
export function Thumb({ src, audio, className }: { src?: string | null; audio?: boolean; className?: string }) {
  const [broken, setBroken] = useState(false)
  return (
    <div className={cn("relative flex aspect-video shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground", className)}>
      {src && !broken ? (
        <img src={src} alt="" className="size-full object-cover" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
      ) : audio ? (
        <Music className="size-5" />
      ) : (
        <Film className="size-5" />
      )}
    </div>
  )
}

/** 設定の 1 行：左に名前（と説明の ? ボタン）、右に操作 */
export function SettingRow({ label, hint, children, htmlFor, className }: { label: string; hint?: string | string[]; children: ReactNode; htmlFor?: string; className?: string }) {
  return (
    <div className={cn("flex min-h-11 flex-wrap items-center justify-between gap-x-6 gap-y-2 py-2", className)}>
      <div className="flex min-w-0 items-center gap-1">
        <label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </label>
        {hint && <HelpButton title={label} items={Array.isArray(hint) ? hint : splitHelp(hint)} />}
      </div>
      <div className="flex min-w-0 items-center gap-2">{children}</div>
    </div>
  )
}

/* ---- 通知（右下のトースト） ---- */

export type NoticeKind = "info" | "success" | "error"
interface Notice {
  id: number
  text: string
  kind: NoticeKind
  action?: { label: string; run: () => void }
}

const NoticeContext = createContext<(text: string, kind?: NoticeKind, action?: Notice["action"]) => void>(() => undefined)

export function useNotice() {
  return useContext(NoticeContext)
}

export function NoticeProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Notice[]>([])
  const notify = useCallback((text: string, kind: NoticeKind = "info", action?: Notice["action"]) => {
    const id = Date.now() + Math.random()
    setItems((list) => [...list.slice(-3), { id, text, kind, action }])
    window.setTimeout(() => setItems((list) => list.filter((n) => n.id !== id)), kind === "error" ? 8000 : 4000)
  }, [])
  return (
    <NoticeContext.Provider value={notify}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
        {items.map((n) => (
          <div
            key={n.id}
            className={cn(
              "pointer-events-auto flex items-center gap-3 rounded-lg border bg-popover px-4 py-3 text-sm shadow-raised animate-in fade-in slide-in-from-bottom-2",
              n.kind === "error" && "border-[var(--semantic-danger-border)] bg-[var(--semantic-danger-bg)] text-[var(--semantic-danger-fg)]",
            )}
          >
            <span className="min-w-0 flex-1">{n.text}</span>
            {n.action && (
              <Button size="xs" variant="outline" onClick={n.action.run}>
                {n.action.label}
              </Button>
            )}
          </div>
        ))}
      </div>
    </NoticeContext.Provider>
  )
}

/** 空の状態（次の一手を短く出す） */
export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-primary-subtle text-primary">{icon}</div>
      <div className="text-sm font-medium text-muted-foreground">{title}</div>
      {children}
    </div>
  )
}

/**
 * 一覧の枠。項目がまだないときも同じ大きさの枠を先に出し、空の案内を枠の中に置く（項目だけが浮かないようにする）。
 */
export function ListFrame({ empty, icon, emptyTitle, children, className }: { empty: boolean; icon: ReactNode; emptyTitle: string; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-h-72 flex-col rounded-2xl border border-border/60 bg-card p-1.5 shadow-card", className)}>
      {empty ? <EmptyState icon={icon} title={emptyTitle} /> : children}
    </div>
  )
}
