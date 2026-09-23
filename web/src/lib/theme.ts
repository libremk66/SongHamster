/**
 * 主题：light | dark | system
 *
 * ⚠️ 实际的"上色"动作由 <html class="dark"> 驱动（见 index.html 的内联脚本与 index.css 的 .dark 段）。
 * 这里只负责：读写偏好、把 class 同步到 <html>、以及在 system 模式下跟随系统变化。
 */

export type ThemeMode = 'light' | 'dark' | 'system'

const KEY = 'sh-theme'

export const THEME_LABEL: Record<ThemeMode, string> = {
  light: '浅色',
  dark: '深色',
  system: '跟随系统',
}

export function getTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* 隐私模式 */
  }
  return 'dark' // 默认深色（用户选定的主题）；想跟随系统可手动切
}

function isDark(mode: ThemeMode): boolean {
  if (mode === 'dark') return true
  if (mode === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function applyTheme(mode: ThemeMode): void {
  document.documentElement.classList.toggle('dark', isDark(mode))
  // 移动端浏览器地址栏配色跟着变
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', isDark(mode) ? '#161513' : '#F5F1E8')
}

export function setTheme(mode: ThemeMode): void {
  try {
    localStorage.setItem(KEY, mode)
  } catch {
    /* 存不下就算了，本次会话仍然生效 */
  }
  applyTheme(mode)
}
