import { ChevronDown, Film, Image, Music } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { PRESETS, presetById } from "@/lib/presets"
import { cn } from "@/lib/utils"

const GROUPS = [
  { id: "video", label: "動画", icon: Film },
  { id: "audio", label: "音声のみ", icon: Music },
  { id: "other", label: "その他", icon: Image },
] as const

/** 形式（MP4・MP3 など）を選ぶメニュー */
export function PresetMenu({ value, onChange, className, size = "default" }: { value: string; onChange: (id: string) => void; className?: string; size?: "default" | "sm" }) {
  const current = presetById(value)
  const Icon = current.group === "audio" ? Music : current.group === "other" ? Image : Film
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size={size} className={cn("justify-between gap-2 font-medium", className)} aria-label={`形式：${current.label}`}>
          <span className="flex items-center gap-2">
            <Icon className="size-4 text-primary" />
            {current.short}
          </span>
          <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuRadioGroup value={current.id} onValueChange={onChange}>
          {GROUPS.map((g, gi) => (
            <div key={g.id}>
              {gi > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <g.icon className="size-3.5" />
                {g.label}
              </DropdownMenuLabel>
              {PRESETS.filter((p) => p.group === g.id).map((p) => (
                <DropdownMenuRadioItem key={p.id} value={p.id}>
                  {p.label}
                </DropdownMenuRadioItem>
              ))}
            </div>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
