import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ListMusic, Pause, Pencil, Play, Plus, Radio, Trash2 } from 'lucide-react'

import { DelayedLoading } from '@/components/loading'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { TaskCards } from '@/components/task-cards'
import { CreateTaskForm } from '@/pages/create-task-form'
import { ListenSection, type ListenData } from '@/pages/listen-section'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

export type TaskRow = {
  id: number
  taskType: string
  lxPlaylistKey: string
  lxPlaylistName: string
  targetIds: string[]
  targetNames: string[]
  createSameNamePlaylist: boolean
  cronExpr: string | null
  enabled: boolean
  mode: 'mirror' | 'incremental' | null
  delPolicy: 'keep' | 'delete' | 'archive' | null
  lastBatch: {
    id: number
    startedAt: string
    result: string | null
    okCount: number
    failCount: number
    unsatisfiedCount: number
  } | null
}
type TasksData = {
  tasks: TaskRow[]
  targetName: string
  fileDeleteOK: boolean
  targetKey: string
  scopeUI: boolean
  defaultArchive: string
  live: { taskId: number; taskName: string; phase: string; done: number; total: number } | null
}
type Result = { ok: boolean; message: string }


export function SyncSetupPage() {
  const [msg, setMsg] = useState<Result | null>(null)
  /** 同时只展开一个删除确认面板 */
  const [deleting, setDeleting] = useState<number | null>(null)
  const [tab, setTab] = useState<'mine' | 'create' | 'listen'>('mine')

  const listen = useQuery({
    queryKey: ['listen'],
    queryFn: () => api.get<ListenData>('/listen'),
  })
  const { data, isLoading } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => api.get<TasksData>('/tasks?scope=playlist'),
    // 有任务在跑时自动刷新（跑完自动停），替代旧页面的常驻轮询
    refetchInterval: (q) => (q.state.data?.live ? 2000 : false),
  })

  const TABS = [
    ['mine', '我的同步', ListMusic],
    ['create', '新建同步', Plus],
    ['listen', '监听同步', Radio],
  ] as const

  return (
    <div className="space-y-4">
      {/* 手机端不显示页面名：顶栏已经写着（见 app-shell），这块地方留给内容 */}
      <header className="flex flex-wrap items-center gap-3 max-md:hidden">
        <h1 className="flex-1 text-lg font-bold tracking-tight">歌单同步</h1>
      </header>

      {/* 横向标签（参考 MoviePilot）：一个标签一件事，不再把三块内容竖着堆在一页 */}
      <div className="flex gap-1 border-b border-border" role="tablist" aria-label="歌单同步">
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

      {/* ── 我的同步 ── */}
      {tab === 'mine' && (
        <div className="space-y-4">
          {isLoading ? (
            <DelayedLoading loading className="py-8 text-center text-sm text-muted-foreground" />
          ) : !data?.tasks.length ? (
            <div className="py-8 text-center">
              <p className="text-sm text-muted-foreground">还没有同步任务</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => setTab('create')}>
                <Plus />
                去新建一个
              </Button>
            </div>
          ) : (
            <TaskCards
              tasks={data.tasks}
              live={data.live}
              targetKey={data.targetKey}
              scopeUI={data.scopeUI}
              fileDeleteOK={data.fileDeleteOK}
              onMsg={setMsg}
              deleting={deleting}
              setDeleting={setDeleting}
            />
          )}
        </div>
      )}

      {/* ── 新建同步 ── */}
      {tab === 'create' && (
        <div className="space-y-4">
          {data ? (
            <CreateTaskForm
              targetName={data.targetName}
              targetKey={data.targetKey}
              scopeUI={data.scopeUI}
              fileDeleteOK={data.fileDeleteOK}
              defaultArchive={data.defaultArchive}
              onCreated={setMsg}
            />
          ) : (
            <DelayedLoading loading className="py-8 text-center text-sm text-muted-foreground" />
          )}
        </div>
      )}

      {/* ── 监听同步 ── */}
      {tab === 'listen' && (
        <div className="space-y-4">
          {listen.data && data ? (
            <ListenSection
              listen={listen.data}
              targetName={data.targetName}
              fileDeleteOK={data.fileDeleteOK}
              defaultArchive={data.defaultArchive}
              onMsg={setMsg}
            />
          ) : (
            <DelayedLoading loading className="py-8 text-center text-sm text-muted-foreground" />
          )}
        </div>
      )}
    </div>
  )
}

/** 后端给的是 ISO 串，列表里只需「月-日 时:分」 */
export function fmtTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 任务操作（同步/启停）：卡片菜单与表格按钮共用同一套，避免两处各写一份 */
export function useTaskActions(task: TaskRow, onMsg: (r: { ok: boolean; message: string }) => void) {
  const qc = useQueryClient()
  const [error, setError] = useState('')
  const mutate = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => api.post<Result>(path, body ?? {}),
    onSuccess: (r) => {
      onMsg(r)
      if (!r.ok) setError(r.message)
      void qc.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: (e) => onMsg({ ok: false, message: e instanceof Error ? e.message : '操作失败' }),
  })
  return {
    pending: mutate.isPending,
    error,
    run: () => mutate.mutate({ path: `/tasks/${task.id}/run` }),
    toggle: () => mutate.mutate({ path: `/tasks/${task.id}/toggle` }),
  }
}

export function TaskActions({
  task,
  onMsg,
  deleting,
  setDeleting,
  showPanel = true,
}: {
  task: TaskRow
  onMsg: (r: { ok: boolean; message: string }) => void
  deleting: number | null
  setDeleting: (id: number | null) => void
  /** 移动端卡片里就地展开；桌面端表格由行级 <tr> 渲染，传 false 避免重复 */
  showPanel?: boolean
}) {
  const { pending, error, run, toggle } = useTaskActions(task, onMsg)
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5 max-md:justify-start">
      <Button size="sm" className="max-md:h-10" disabled={pending} onClick={run}>
        <Play />
        同步
      </Button>
      <Button size="sm" variant="ghost" className="max-md:h-10" disabled title="行内编辑下一步实现">
        <Pencil />
        编辑
      </Button>
      <Button size="sm" variant="ghost" className="max-md:h-10" disabled={pending} onClick={toggle}>
        {task.enabled ? <Pause /> : <Play />}
        {task.enabled ? '停用' : '启用'}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="max-md:h-10 text-destructive"
        onClick={() => setDeleting(deleting === task.id ? null : task.id)}
      >
        <Trash2 />
        删除
      </Button>
      {showPanel && deleting === task.id && (
        <DeletePanel task={task} onMsg={onMsg} onClose={() => setDeleting(null)} />
      )}
      {error && <span className="w-full text-xs text-destructive">{error}</span>}
    </div>
  )
}

/** 删除确认：三个复选框由用户决定删什么（与旧页面同一套语义） */
export function DeletePanel({ task, onMsg, onClose }: { task: TaskRow; onMsg: (r: Result) => void; onClose: () => void }) {
  const qc = useQueryClient()
  const [file, setFile] = useState(false)
  const [playlist, setPlaylist] = useState(false)
  const [history, setHistory] = useState(false)

  const del = useMutation({
    mutationFn: () => api.post<Result>(`/tasks/${task.id}/delete`, { file, playlist, history }),
    onSuccess: (r) => {
      onMsg(r)
      onClose()
      void qc.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: (e) => onMsg({ ok: false, message: e instanceof Error ? e.message : '删除失败' }),
  })

  return (
    <div className="w-full rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-left">
      <p className="text-sm font-medium">删除任务「{task.lxPlaylistName}」</p>
      <p className="mt-1 text-xs text-muted-foreground">默认只删任务本身，文件与歌单内容保留。</p>
      <div className="mt-2 space-y-1">
        <Label className="min-h-11 cursor-pointer md:min-h-0">
          <Checkbox checked={file} onChange={(e) => setFile(e.target.checked)} />
          <span className="text-sm">
            文件 <span className="text-xs text-muted-foreground">（移入回收站；下次同步会重新下载）</span>
          </span>
        </Label>
        <Label className="min-h-11 cursor-pointer md:min-h-0">
          <Checkbox checked={playlist} onChange={(e) => setPlaylist(e.target.checked)} />
          <span className="text-sm">
            歌单 <span className="text-xs text-muted-foreground">（从歌单移除本任务加过的歌）</span>
          </span>
        </Label>
        <Label className="min-h-11 cursor-pointer md:min-h-0">
          <Checkbox checked={history} onChange={(e) => setHistory(e.target.checked)} />
          <span className="text-sm">
            历史记录 <span className="text-xs text-muted-foreground">（只清账，不影响同步）</span>
          </span>
        </Label>
      </div>
      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="destructive" onClick={() => del.mutate()} disabled={del.isPending}>
          确认删除
        </Button>
        <Button size="sm" variant="outline" onClick={onClose}>
          取消
        </Button>
      </div>
    </div>
  )
}
