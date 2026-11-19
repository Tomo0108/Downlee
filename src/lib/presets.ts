import type { AudioFormat, Codec, JobRequest, Mode, VideoContainer } from "./types"

/** よく使う形式の組み合わせ。［形式］のメニューと設定の「既定の形式」で使う */
export interface Preset {
  id: string
  label: string
  short: string
  group: "video" | "audio" | "other"
  mode: Mode
  container?: VideoContainer
  audioFormat?: AudioFormat
}

export const PRESETS: Preset[] = [
  { id: "video-mp4", label: "動画 MP4", short: "MP4", group: "video", mode: "video", container: "mp4" },
  { id: "video-mkv", label: "動画 MKV", short: "MKV", group: "video", mode: "video", container: "mkv" },
  { id: "video-webm", label: "動画 WebM", short: "WebM", group: "video", mode: "video", container: "webm" },
  { id: "video-mov", label: "動画 MOV", short: "MOV", group: "video", mode: "video", container: "mov" },
  { id: "video-avi", label: "動画 AVI", short: "AVI", group: "video", mode: "video", container: "avi" },
  { id: "audio-mp3", label: "音声 MP3", short: "MP3", group: "audio", mode: "audio", audioFormat: "mp3" },
  { id: "audio-m4a", label: "音声 M4A", short: "M4A", group: "audio", mode: "audio", audioFormat: "m4a" },
  { id: "audio-aac", label: "音声 AAC", short: "AAC", group: "audio", mode: "audio", audioFormat: "aac" },
  { id: "audio-flac", label: "音声 FLAC", short: "FLAC", group: "audio", mode: "audio", audioFormat: "flac" },
  { id: "audio-wav", label: "音声 WAV", short: "WAV", group: "audio", mode: "audio", audioFormat: "wav" },
  { id: "audio-opus", label: "音声 Opus", short: "Opus", group: "audio", mode: "audio", audioFormat: "opus" },
  { id: "audio-ogg", label: "音声 OGG", short: "OGG", group: "audio", mode: "audio", audioFormat: "ogg" },
  { id: "audio-best", label: "音声（元の形式のまま）", short: "音声", group: "audio", mode: "audio", audioFormat: "best" },
  { id: "gif", label: "GIF アニメ", short: "GIF", group: "other", mode: "gif" },
]

export function presetById(id: string | undefined): Preset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0]
}

/** 画質の上限の選択肢（0 は最高画質） */
export const HEIGHTS = [0, 4320, 2160, 1440, 1080, 720, 480, 360, 240, 144]

export function heightLabel(h: number | null | undefined): string {
  if (!h) return "最高画質"
  if (h >= 4320) return "8K"
  if (h >= 2160) return "4K"
  if (h >= 1440) return "1440p"
  return `${h}p`
}

export const CODECS: { id: Codec; label: string }[] = [
  { id: "any", label: "おまかせ（画質優先）" },
  { id: "h264", label: "H.264（互換性優先）" },
  { id: "h265", label: "H.265 / HEVC" },
  { id: "av1", label: "AV1" },
  { id: "vp9", label: "VP9" },
]

/** 形式・画質の指定から、待ち行列に入れる内容を作る */
export function requestFor(preset: Preset, opts: { maxHeight?: number; codec?: Codec } = {}): Pick<JobRequest, "mode" | "container" | "audioFormat" | "maxHeight" | "codec" | "presetLabel"> {
  const label = preset.mode === "audio" ? preset.short : `${preset.short}・${heightLabel(opts.maxHeight)}`
  return {
    mode: preset.mode,
    container: preset.container,
    audioFormat: preset.audioFormat,
    maxHeight: preset.mode === "audio" ? 0 : opts.maxHeight ?? 0,
    codec: opts.codec ?? "any",
    presetLabel: label,
  }
}

/** 変換の行き先 */
export const CONVERT_TARGETS: { id: string; label: string; group: "video" | "audio" }[] = [
  { id: "mp4", label: "MP4", group: "video" },
  { id: "mkv", label: "MKV", group: "video" },
  { id: "webm", label: "WebM", group: "video" },
  { id: "mov", label: "MOV", group: "video" },
  { id: "avi", label: "AVI", group: "video" },
  { id: "gif", label: "GIF", group: "video" },
  { id: "mp3", label: "MP3", group: "audio" },
  { id: "m4a", label: "M4A", group: "audio" },
  { id: "aac", label: "AAC", group: "audio" },
  { id: "flac", label: "FLAC", group: "audio" },
  { id: "opus", label: "Opus", group: "audio" },
  { id: "wav", label: "WAV", group: "audio" },
  { id: "ogg", label: "OGG", group: "audio" },
]
