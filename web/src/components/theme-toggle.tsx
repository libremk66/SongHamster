import { useEffect, useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'

import { applyTheme, getTheme, setTheme, THEME_LABEL, type ThemeMode } from '@/lib/theme'
import { cn } from '@/lib/utils'

const MODES: { key: ThemeMode; icon: typeof Sun }[] = [
  { key: 'light', icon: Sun },
  { key: 'dark', icon: Moon },
  { key: 'system', icon: Monitor },
]

/**
 * 三态主题切换（浅色 / 深色 / 跟随系统）。
 * 样式对齐 DockHamster 侧栏底部的分段控件：外层浅灰底 + 内边距，
 * 选中项白底浮起，未选中项透明、hover 才亮。
 *
 * 首次挂载时把偏好同步到 <html>（index.html 里的内联脚本已做过一次，
 * 这里是为了处理"跟随系统"下系统配色变化、以及从别处改过偏好后的同步）。
 */
export function ThemeToggle({ className }: { className?: string }) {
  const [mode, setMode] = useState<ThemeMode>(() => getTheme())

  useEffect(() => {
    applyTheme(mode)
  }, [mode])

  // 跟随系统时，系统配色变了要跟着变
  useEffect(() => {
    if (mode !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [mode])

  return (
    <div
      className={cn('flex items-center gap-1 rounded-lg bg-sidebar-accent/70 p-1', className)}
      role="group"
      aria-label="主题"
    >
      {MODES.map((m) => (
        <button
          key={m.key}
          type="button"
          className={cn(
            'flex h-8 flex-1 items-center justify-center rounded-md transition-colors max-md:h-10',
            mode === m.key
              ? 'bg-card text-primary shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
          aria-pressed={mode === m.key}
          /*
            只留图标（侧栏位置紧，三个字的标签占了大半宽度）。
            ⚠️ 文字去掉后 `title` 不再是可靠的可访问名称（读屏未必念），
               必须显式给 aria-label —— 否则读屏只会念「按钮」。
          */
          aria-label={THEME_LABEL[m.key]}
          title={THEME_LABEL[m.key]}
          onClick={() => {
            setMode(m.key)
            setTheme(m.key)
          }}
        >
          <m.icon className="size-4" />
        </button>
      ))}
    </div>
  )
}
