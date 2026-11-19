/** 表示用の書式（大きさ・時間・速度） */

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return ""
  const units = ["B", "KB", "MB", "GB", "TB"]
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

export function formatDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec) || sec < 0) return ""
  const s = Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`
}

export function formatSpeed(bps: number | null | undefined): string {
  return bps ? `${formatBytes(bps)}/s` : ""
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`
  if (sameDay) return `今日 ${hm}`
  const y = new Date(now)
  y.setDate(now.getDate() - 1)
  if (d.toDateString() === y.toDateString()) return `昨日 ${hm}`
  return d.getFullYear() === now.getFullYear() ? `${d.getMonth() + 1}/${d.getDate()} ${hm}` : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

/** 文章から http(s) の URL を取り出す（重複は 1 つにする） */
export function extractUrls(text: string): string[] {
  const found = String(text).match(/https?:\/\/[^\s"'<>（）「」、。]+/gi) ?? []
  const out: string[] = []
  for (const raw of found) {
    const u = raw.replace(/[),.;:!?]+$/, "")
    try {
      new URL(u)
    } catch {
      continue
    }
    if (!out.includes(u)) out.push(u)
  }
  return out
}

export function hostOf(url: string | null | undefined): string {
  if (!url) return ""
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return ""
  }
}

export function fileName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

/** 「1:23」「83」「1:02:03」を秒にする。空や不正は null */
export function parseTime(text: string): number | null {
  const v = text.trim()
  if (!v) return null
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(v)) return null
  return v.split(":").reduce((a, p) => a * 60 + Number(p), 0)
}
