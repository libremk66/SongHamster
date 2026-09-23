import { useEffect, useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { applyTheme, getTheme, setTheme, THEME_LABEL, type ThemeMode } from '@/lib/theme'
import { cn } from '@/lib/utils'

const MODES: { key: ThemeMode; icon: typeof Sun }[] = [
  { key: 'light', icon: Sun },
  { key: 'dark', icon: Moon },
  { key: 'system', icon: Monitor },
]

/**
 * 三态主题切换。首次挂载时把偏好同步到 <html>（index.html 里的内联脚本已做过一次，
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
      className={cn('flex items-center gap-1 rounded-md border p-0.5', className)}
      role="group"
      aria-label="主题"
    >
      {MODES.map((m) => (
        <Button
          key={m.key}
          type="button"
          variant={mode === m.key ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 flex-1 gap-1 px-1.5 text-xs max-md:h-10"
          aria-pressed={mode === m.key}
          title={THEME_LABEL[m.key]}
          onClick={() => {
            setMode(m.key)
            setTheme(m.key)
          }}
        >
          <m.icon className="size-3.5" />
          <span className="max-md:inline md:hidden lg:inline">{THEME_LABEL[m.key]}</span>
        </Button>
      ))}
    </div>
  )
}
