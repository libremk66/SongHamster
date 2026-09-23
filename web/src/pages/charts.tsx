import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Compass, Plus, Trophy } from 'lucide-react'

import { FormMessage } from '@/components/form-message'
import { DelayedLoading } from '@/components/loading'
import { Sheet } from '@/components/sheet'
import { TaskCards } from '@/components/task-cards'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { BoardBrowser, SubscribeForm } from '@/pages/charts-browser'
import type { TaskRow } from '@/pages/sync-setup'

/** 榜单任务比歌单任务多一个「范围」字段 */
type ChartRow = TaskRow & { maxCount: number | null }
type TasksData = {
  tasks: ChartRow[]
  targetName: string
  fileDeleteOK: boolean
  targetKey: string
  scopeUI: boolean
  defaultArchive: string
  platforms: { key: string; label: string }[]
  live: { taskId: number; taskName: string; phase: string; done: number; total: number } | null
}
type Result = { ok: boolean; message: string }

export function ChartsPage() {
  const [msg, setMsg] = useState<Result | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)
  const [tab, setTab] = useState<'mine' | 'browse'>('mine')
  /** 浏览页点「订阅」时带着榜单开弹框 */
  const [subBoard, setSubBoard] = useState<{ source: string; id: string; name: string } | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['tasks', 'chart'],
    queryFn: () => api.get<TasksData>('/tasks?scope=all'),
    // 同步在跑时自动刷新，跑完自动停
    refetchInterval: (q) => (q.state.data?.live ? 2000 : false),
  })

  const charts = (data?.tasks ?? []).filter((t) => t.taskType === 'chart')

  const TABS = [
    ['mine', '我的订阅', Trophy],
    ['browse', '榜单浏览', Compass],
  ] as const

  return (
    /* flex-1 + min-h-0：榜单浏览那栏要吃掉标签行之外的整块高度（见 charts-browser 的注释） */
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* 手机端不显示页面名：顶栏已经写着（见 app-shell），这块地方留给内容 */}
      <header className="max-md:hidden">
        <h1 className="text-lg font-bold tracking-tight">榜单订阅</h1>
      </header>

      {/*
        两个标签。**没有「新建订阅」** —— 订阅的对象是榜单，而榜单是在浏览页选的；
        单开一个标签就等于让人在两个页面各选一遍同一个榜。
        MoviePilot 也是这个逻辑：在内容页直接订阅。
      */}
      <div className="flex gap-1 border-b border-border" role="tablist" aria-label="榜单订阅">
        {TABS.map(([k, label, Icon]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn(
              'relative flex items-center gap-1.5 px-4 py-2.5 text-sm transition-colors max-md:min-h-11',
              tab === k ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
            {tab === k && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-primary" aria-hidden />}
          </button>
        ))}
      </div>

      {msg && <FormMessage ok={msg.ok}>{msg.message}</FormMessage>}

      {/* ── 我的订阅 ── */}
      {tab === 'mine' && (
        <div className="space-y-4">
          {isLoading ? (
            <DelayedLoading loading className="py-8 text-center text-sm text-muted-foreground" />
          ) : !charts.length ? (
            <div className="py-8 text-center">
              <p className="text-sm text-muted-foreground">还没有订阅任何榜单</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => setTab('browse')}>
                <Compass />
                去榜单浏览看看
              </Button>
            </div>
          ) : (
            <TaskCards
              tasks={charts}
              live={data?.live ?? null}
              targetKey={data?.targetKey ?? ''}
              scopeUI={data?.scopeUI ?? false}
              fileDeleteOK={data?.fileDeleteOK ?? false}
              isChart
              onMsg={setMsg}
              deleting={deleting}
              setDeleting={setDeleting}
            />
          )}
        </div>
      )}

      {/* ── 榜单浏览（订阅在这里直接发起）── */}
      {tab === 'browse' && data && (
        <BoardBrowser
          onMsg={setMsg}
          platforms={data.platforms}
          subscribeSlot={(b) => (
            <Button type="button" size="sm" onClick={() => setSubBoard(b)}>
              <Plus />
              订阅这个榜单
            </Button>
          )}
        />
      )}

      {/* 订阅弹框：榜单已在浏览页选好，这里只填设置 */}
      {subBoard && data && (
        <Sheet open onClose={() => setSubBoard(null)} title={`订阅：${subBoard.name}`}>
          <SubscribeForm
            targetName={data.targetName}
            scopeUI={data.scopeUI}
            targetKey={data.targetKey}
            fileDeleteOK={data.fileDeleteOK}
            defaultArchive={data.defaultArchive}
            platforms={data.platforms}
            presetBoard={subBoard}
            onDone={(r) => {
              setMsg(r)
              if (r.ok) {
                setSubBoard(null)
                setTab('mine')
              }
            }}
          />
        </Sheet>
      )}
    </div>
  )
}
