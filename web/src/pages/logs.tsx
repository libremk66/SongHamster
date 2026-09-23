import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

type LogRow = { ts: string; level: 'info' | 'warn' | 'error'; msg: string }
type LogsResponse = { rows: LogRow[]; count: number }

const LEVELS = [
  { value: '', label: '全部' },
  { value: 'info', label: 'INFO' },
  { value: 'warn', label: 'WARN' },
  { value: 'error', label: 'ERROR' },
] as const

const LEVEL_BADGE = { info: 'info', warn: 'warn', error: 'error' } as const

export function LogsPage() {
  const [level, setLevel] = useState('')
  const [q, setQ] = useState('') // 已提交的搜索词（回车才生效）
  const [qInput, setQInput] = useState('')
  const [auto, setAuto] = useState(true)
  /** 用户滚离顶部（在读历史）→ 暂停自动刷新，别打断 */
  const [scrolled, setScrolled] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const { data, isFetching, refetch } = useQuery({
    queryKey: ['logs', level, q],
    queryFn: () =>
      api.get<LogsResponse>(
        `/logs?level=${encodeURIComponent(level)}&q=${encodeURIComponent(q)}`,
      ),
    refetchInterval: auto && !scrolled ? 3000 : false,
  })

  const rows = data?.rows ?? []

  return (
    <div className="space-y-4">
      {/* 手机端不显示页面名：顶栏已经写着（见 app-shell），这块地方留给内容 */}
      <header className="flex items-center gap-2 max-md:hidden">
        <h1 className="text-lg font-bold tracking-tight">日志</h1>
      </header>

      <Card className="gap-3 py-4">
        <CardContent className="space-y-3">
          {/* 工具栏：移动端自动折行成多行 */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="日志级别">
              {LEVELS.map((l) => (
                <Button
                  key={l.value}
                  type="button"
                  size="sm"
                  variant={level === l.value ? 'default' : 'outline'}
                  aria-pressed={level === l.value}
                  className="max-md:h-9 max-md:px-3"
                  onClick={() => setLevel(l.value)}
                >
                  {l.label}
                </Button>
              ))}
            </div>

            <form
              /* 移动端整行独占（w-full），桌面端才参与同一行弹性布局。
                 注意别用 flex-1：basis:0 的项不会换行，会被 min-width 顶出屏幕 */
              className="flex w-full items-center gap-2 md:w-auto md:min-w-0 md:flex-1"
              onSubmit={(e) => {
                e.preventDefault()
                setQ(qInput.trim())
              }}
            >
              <Input
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                placeholder="搜索关键字（回车）"
                aria-label="搜索日志关键字"
                className="min-w-[10rem] flex-1"
              />
              <Button type="submit" variant="outline">
                搜索
              </Button>
            </form>

            <Button
              type="button"
              variant="outline"
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={cn(isFetching && 'animate-spin')} />
              刷新
            </Button>

            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={auto}
                onChange={(e) => setAuto(e.target.checked)}
                className="size-4 max-md:size-5"
              />
              自动刷新
            </label>

            <span className="ml-auto text-xs text-muted-foreground">
              {rows.length ? `${rows.length} 条` : ''}
              {auto && scrolled ? ' · 已暂停' : ''}
            </span>
          </div>

          {/* 日志区 */}
          <div
            ref={scrollRef}
            onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 40)}
            className="max-h-[65vh] overflow-auto rounded-lg border bg-card p-1 font-mono text-xs md:max-h-[70vh]"
          >
            {rows.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground">
                {isFetching ? '加载中…' : '没有匹配的日志'}
              </p>
            ) : (
              rows.map((l, i) => (
                <div
                  key={`${l.ts}-${i}`}
                  className="flex gap-2 border-b border-border/50 px-2 py-1.5 leading-relaxed last:border-b-0 hover:bg-muted/40"
                >
                  <span className="shrink-0 tabular-nums text-muted-foreground">{l.ts}</span>
                  <Badge
                    variant={LEVEL_BADGE[l.level]}
                    className="h-5 shrink-0 px-1.5 max-md:h-6"
                  >
                    {l.level.toUpperCase()}
                  </Badge>
                  <span
                    className={cn(
                      'min-w-0 flex-1 whitespace-pre-wrap break-words',
                      l.level === 'warn' && 'text-amber-700 dark:text-amber-400',
                      l.level === 'error' && 'text-red-700 dark:text-red-400',
                    )}
                  >
                    {l.msg}
                  </span>
                </div>
              ))
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            日志写在 <code className="rounded bg-muted px-1">data/logs/songhamster-日期.log</code>
            （重启不丢），保留天数见「设置 → 通用」。你正在读历史或输入搜索词时会自动暂停刷新。
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
