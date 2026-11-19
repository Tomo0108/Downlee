/**
 * 画面の配色（ライト／ダーク）。Rakuform の src/lib/theme.ts と同じ作法。
 * ［設定］の「表示テーマ」で選び、この PC ごとに覚える。「システムに合わせる」では Windows の設定に追従する。
 */
import type { ThemePreference } from "./types"

export type { ThemePreference }
export type ResolvedTheme = "light" | "dark"

export const THEME_STORAGE_KEY = "downlee.theme"

export function parseThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" || value === "system" ? value : "system"
}

export function resolveTheme(pref: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (pref === "system") return systemDark ? "dark" : "light"
  return pref
}

export function readThemePreference(): ThemePreference {
  try {
    return parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    return "system"
  }
}

export function writeThemePreference(pref: ThemePreference) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, pref)
  } catch {
    /* 保存できなくても今回の表示には反映する */
  }
}

export function systemPrefersDark() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches === true
}

export function applyTheme(theme: ResolvedTheme) {
  const root = document.documentElement
  root.classList.toggle("dark", theme === "dark")
  root.style.colorScheme = theme
}

/** デスクトップ版：OS 側にも設定を伝え、タイトルバーの操作ボタンの色を合わせる */
export function syncDesktopTheme(pref: ThemePreference) {
  void window.downlee?.setTheme(pref).catch(() => undefined)
}
