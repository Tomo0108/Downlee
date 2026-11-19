import { isDesktop } from "@/lib/bridge"

/** デスクトップ版のタイトルバー（Rakuform・RakuManual と同じ高さ 32px のドラッグ領域）。右端に OS の操作ボタンが重なる */
export function DesktopTitleBar() {
  if (!isDesktop) return null
  return (
    <div aria-hidden className="desktop-titlebar fixed inset-x-0 top-0 z-40 h-8 bg-sidebar">
      <div className="absolute inset-x-0 bottom-0 h-px bg-sidebar-border" />
    </div>
  )
}
