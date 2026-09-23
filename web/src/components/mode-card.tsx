import { Check, Settings2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** 监听模式卡片：整张卡是"选中"，卡上单独的「设置」开弹框 */
export function ModeCard({
  title,
  desc,
  active,
  summary,
  onSelect,
  onSettings,
}: {
  title: string
  desc: string
  active: boolean
  /** 卡面上的一行摘要（详细设置收进弹框了，这里只给个概览） */
  summary: string
  onSelect: () => void
  onSettings: () => void
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-lg border bg-card p-3 transition-colors',
        active ? 'border-primary ring-1 ring-primary/40' : 'border-border',
      )}
    >
      <button type="button" onClick={onSelect} className="flex items-start gap-2 text-left" aria-pressed={active}>
        <span
          className={cn(
            'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
            active ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50',
          )}
          aria-hidden
        >
          {active && <Check className="size-3" />}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium">{title}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{desc}</span>
        </span>
      </button>

      <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2">
        <span className="min-w-0 truncate text-xs text-muted-foreground">{summary}</span>
        <Button type="button" variant="outline" size="sm" className="shrink-0 max-md:h-10" onClick={onSettings}>
          <Settings2 />
          设置
        </Button>
      </div>
    </div>
  )
}
