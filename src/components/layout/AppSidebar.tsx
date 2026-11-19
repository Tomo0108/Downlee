import { Download, History, PanelLeftClose, PanelLeftOpen, Radar, Repeat, Settings } from "lucide-react"
import type { ReactElement } from "react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export type AppView = "download" | "find" | "convert" | "history" | "settings"

export const NAV: { id: AppView; label: string; icon: typeof Download; key: string }[] = [
  { id: "download", label: "ダウンロード", icon: Download, key: "1" },
  { id: "find", label: "見つける", icon: Radar, key: "2" },
  { id: "convert", label: "変換", icon: Repeat, key: "3" },
  { id: "history", label: "履歴", icon: History, key: "4" },
]

function CollapsedTooltip({ collapsed, label, shortcut, children }: { collapsed: boolean; label: string; shortcut?: string; children: ReactElement }) {
  if (!collapsed) return children
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={6}>
        {label}
        {shortcut && <span className="ml-2 opacity-70">{shortcut}</span>}
      </TooltipContent>
    </Tooltip>
  )
}

const navClass = (active: boolean, collapsed: boolean) =>
  cn(
    "flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-semibold transition-colors",
    collapsed && "justify-center px-2",
    active ? "bg-card text-foreground shadow-xs" : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
  )

/** サイドバー（Rakuform・RakuManual と同じ構成）：上にロゴと名前・折りたたみ、中央に画面の切り替え、下に［設定］ */
export function AppSidebar({ collapsed, onToggleCollapsed, view, onNavigate, activeCount }: { collapsed: boolean; onToggleCollapsed: () => void; view: AppView; onNavigate: (v: AppView) => void; activeCount: number }) {
  return (
    <aside className={cn("relative flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar", collapsed ? "w-16" : "w-56")} aria-label="メニュー">
      <div className={cn("flex items-center gap-2.5 px-5 pt-4 pb-6", collapsed && "flex-col gap-1 px-2 pt-3 pb-2")}>
        <div className={cn("flex min-w-0 items-center gap-2.5", collapsed && "justify-center")}>
          <img src={`${import.meta.env.BASE_URL}icon.png`} alt="Downlee ロゴ" className={cn("size-9 rounded-lg", collapsed && "size-7")} />
          {!collapsed && <div className="text-lg font-bold tracking-tight">Downlee</div>}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className={cn("shrink-0", collapsed ? "ml-0" : "ml-auto")} onClick={onToggleCollapsed} aria-expanded={!collapsed} aria-label={collapsed ? "サイドバーを開く" : "サイドバーを閉じる"}>
              {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={6}>
            {collapsed ? "サイドバーを開く" : "サイドバーを閉じる"}
            <span className="ml-2 opacity-70">Ctrl+B</span>
          </TooltipContent>
        </Tooltip>
      </div>
      <nav className={cn("flex flex-1 flex-col gap-1 px-3", collapsed && "px-2")}>
        {NAV.map((n) => (
          <CollapsedTooltip key={n.id} collapsed={collapsed} label={n.label} shortcut={`Ctrl+${n.key}`}>
            <button type="button" className={navClass(view === n.id, collapsed)} onClick={() => onNavigate(n.id)} aria-current={view === n.id ? "page" : undefined}>
              <n.icon className={cn("size-4 shrink-0", view === n.id && "text-primary")} />
              {!collapsed && <span className="min-w-0 flex-1 truncate">{n.label}</span>}
              {n.id === "download" && activeCount > 0 && (
                <span className={cn("rounded-full bg-primary px-1.5 text-[11px] leading-5 font-semibold text-primary-foreground tabular-nums", collapsed && "absolute ml-6 -mt-6")}>{activeCount}</span>
              )}
            </button>
          </CollapsedTooltip>
        ))}
      </nav>
      <div className={cn("px-3 pb-4", collapsed && "px-2")}>
        <CollapsedTooltip collapsed={collapsed} label="設定" shortcut="Ctrl+,">
          <button type="button" className={navClass(view === "settings", collapsed)} onClick={() => onNavigate("settings")} aria-current={view === "settings" ? "page" : undefined}>
            <Settings className={cn("size-4 shrink-0", view === "settings" && "text-primary")} />
            {!collapsed && "設定"}
          </button>
        </CollapsedTooltip>
      </div>
    </aside>
  )
}
