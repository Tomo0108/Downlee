import { useLayoutEffect, useRef } from "react"
import { cn } from "@/lib/utils"

/** 1秒あたりに流す距離（px）。読みながら追える速さにする */
const MARQUEE_SPEED = 40

/**
 * 1行に収まらない文字を「…」で省略し、親要素（marquee-host）にマウスを重ねるかキーボードで選ぶと、
 * 文字を左へ流して末尾まで読めるようにする。動きを減らす設定のときは流さず、全文は title で補う。
 */
export function MarqueeText({ text, className }: { text: string; className?: string }) {
  const outerRef = useRef<HTMLSpanElement>(null)
  const innerRef = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const outer = outerRef.current
    const inner = innerRef.current
    if (!outer || !inner) return
    const measure = () => {
      // 「…」で省略中は scrollWidth が全文の幅を返さないため、一時的に全文の幅で測る（描画前に戻す）
      const previous = inner.style.width
      inner.style.width = "max-content"
      const full = inner.offsetWidth
      inner.style.width = previous
      const overflow = Math.max(0, full - outer.clientWidth)
      outer.style.setProperty("--marquee-shift", `${-overflow}px`)
      outer.style.setProperty("--marquee-duration", `${Math.max(1, overflow / MARQUEE_SPEED)}s`)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(outer)
    return () => observer.disconnect()
  }, [text])

  return (
    <span ref={outerRef} className={cn("marquee-text", className)}>
      <span ref={innerRef}>{text}</span>
    </span>
  )
}
