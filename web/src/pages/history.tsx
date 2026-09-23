import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, CalendarDays, ChevronDown, ChevronRight, History, RotateCcw, Trash2 } from 'lucide-react'

import { DelayedLoading } from '@/components/loading'
import { FormMessage } from '@/components/form-message'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Cover } from '@/components/cover'
import { Sheet } from '@/components/sheet'
import { api } from '@/lib/api'
import { HistoryBatches } from '@/pages/history-batches'
import { detailSteps, refsText, taskAttrs } from '@/lib/history-meta'
import { cn } from '@/lib/utils'

type HistoryRow = {
  id: number
  batchId: number
  taskId: number
  songKey: string
  songName: string | null
  singer: string | null
  status: string
  quality: string | null
  filePath: string | null
  fileSize: number | null
  errorReason: string | null
  /** 这首歌的处理轨迹（JSON 数组字符串） */
  detail: string | null
  action: string | null
  process: string | null
  refBefore: string | null
  refAfter: string | null
  startedAt: string
  taskName: string | null
  taskType: string | null
  attemptNo: number
  // 批次快照：拼「任务属性」列用（任务后来改了配置也仍是"当时"的样子）
  trigger: string | null
  mode: string | null
  delPolicy: string | null
  archivePlaylist: string | null
  targetPlaylists: string | null
  playlistScopeName: string | null
  maxCount: number | null
}
/** 逐栏筛选的条件（与后端 repo.HistoryQuery 同名） */
type Filters = {
  song: string
  singer: string
  attr: string
  path: string
  taskName: string
  quality: string
  action: string
  process: string
  status: string
  from: string
  to: string
  ref: string
}
const EMPTY_FILTERS: Filters = {
  song: '', singer: '', attr: '', path: '', taskName: '',
  quality: '', action: '', process: '', status: '', from: '', to: '', ref: '',
}
type HistoryLabels = {
  processes: Record<string, string>
  statuses: Record<string, { label: string; cls: string }>
  groups: { label: string; codes: string[] }[]
  triggers: Record<string, string>
  modes: Record<string, string>
  delPolicies: Record<string, string>
}
type HistoryData = {
  rows: HistoryRow[]
  page: number
  pages: number
  total: number
  pageSize: number
  facets: { taskNames: string[]; qualities: string[] }
  labels: HistoryLabels
}
type Live = {
  running: boolean
  taskName?: string
  phase?: string
  index?: number
  total?: number
  done?: number
  pct?: number
  ok?: number
  fail?: number
  unsat?: number
  current?: string | null
}

const ACTION_LABEL: Record<string, string> = { in: '入库', out: '移出' }

/**
 * 日期筛选：一个日历按钮，点开才出现起止日期输入框。
 *
 * 原来是两个 `input[type=date]` 常驻在表头格里（那格才 112px 宽），竖着摞两行
 * 把整个筛选行撑高一截，而绝大多数时候根本不筛日期。
 *
 * 面板用 **fixed 定位 + 夹进视口**，和 InfoTip 同一套做法：表格外层是
 * `overflow-auto`，`absolute` 会被它裁掉。
 */
function DateRangeFilter({
  from,
  to,
  onChange,
  onClear,
}: {
  from: string
  to: string
  onChange: (patch: { from?: string; to?: string }) => void
  onClear: () => void
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const wrap = useRef<HTMLSpanElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  const place = useCallback(() => {
    const b = btn.current
    const p = panel.current
    if (!b || !p) return
    const r = b.getBoundingClientRect()
    const w = p.offsetWidth
    const vw = window.innerWidth
    // 左对齐到按钮，但夹进视口（筛选行靠表格顶部，往下弹一定放得下）
    setPos({ left: Math.min(Math.max(r.left, 8), Math.max(8, vw - w - 8)), top: r.bottom + 6 })
  }, [])

  useLayoutEffect(() => {
    if (open) place()
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const onMove = () => place()
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // 捕获阶段拦下：免得把上层的 Esc（弹框/抽屉）一起触发
        e.stopPropagation()
        setOpen(false)
        btn.current?.focus()
      }
    }
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open, place])

  const active = Boolean(from || to)
  const label = active ? `${from ? from.slice(5) : '…'} ~ ${to ? to.slice(5) : '…'}` : '日期'

  return (
    <span ref={wrap} className="relative inline-flex w-full">
      <button
        ref={btn}
        type="button"
        aria-expanded={open}
        title="点开选择起始 / 结束日期"
        onClick={() => setOpen((o) => !o)}
        className={cn(FCTL, 'flex items-center justify-center gap-1', active && 'border-primary text-foreground')}
      >
        <CalendarDays className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{label}</span>
      </button>

      {open && (
        <div
          ref={panel}
          style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999, visibility: 'hidden' }}
          className="fixed z-40 w-60 space-y-2 rounded-md border border-border bg-popover p-2.5 text-xs shadow-md"
        >
          <label className="block space-y-1">
            <span className="text-muted-foreground">起始日期</span>
            <input
              type="date"
              aria-label="起始日期"
              value={from}
              onChange={(e) => onChange({ from: e.target.value })}
              className={cn(FCTL, 'text-xs')}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-muted-foreground">结束日期</span>
            <input
              type="date"
              aria-label="结束日期"
              value={to}
              onChange={(e) => onChange({ to: e.target.value })}
              className={cn(FCTL, 'text-xs')}
            />
          </label>
          {active && (
            <button
              type="button"
              onClick={onClear}
              className="w-full rounded border border-input px-2 py-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              清除日期
            </button>
          )}
        </div>
      )}
    </span>
  )
}

/** 逐栏筛选控件的小号样式（表头那一行要塞 9 个控件，用标准 Input 太占地） */
const FCTL =
  'h-7 w-full min-w-0 rounded border border-input bg-transparent px-1.5 text-xs outline-none transition-colors focus-visible:border-ring'

export function HistoryPage() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [page, setPage] = useState(1)
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS)
  const [rowMsg, setRowMsg] = useState<{ ok: boolean; message: string } | null>(null)
  const [tab, setTab] = useState<'progress' | 'records' | 'trash'>('progress')
  /** 「历史记录」标签下再分两个子标签 */
  const [sub, setSub] = useState<'rows' | 'batches'>('rows')
  /** 批量删除选中的行（存 history_item.id） */
  const [picked, setPicked] = useState<number[]>([])
  /** 删除确认弹框开着没 */
  const [delOpen, setDelOpen] = useState(false)
  /** 歌曲来历卡：点歌名打开。`records` = 打开时「看这首歌的全部记录」已经展开着 */
  const [songCard, setSongCard] = useState<{ name: string; key: string; records?: boolean } | null>(null)
  /** 手机卡片列表里展开详情的那一条（同时只开一条，省得越展开越长） */
  const [openRow, setOpenRow] = useState<number | null>(null)

  const live = useQuery({
    queryKey: ['progress'],
    queryFn: () => api.get<Live>('/progress/json'),
    // 跑着的时候每秒刷，跑完自动停（替代旧页面写死的 setInterval）
    refetchInterval: (q) => (q.state.data?.running ? 1000 : 3000),
  })

  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(applied)) if (v) params.set(k, v)
  params.set('page', String(page))

  const { data, isLoading } = useQuery({
    queryKey: ['history', applied, page],
    queryFn: () => api.get<HistoryData>(`/history/rows-json?${params}`),
    /*
      ⚠️ 换筛选条件会让 queryKey 变 → 新查询没数据 → 不保留旧数据的话 `data` 会瞬间变 undefined，
      整个表格被加载态顶掉。两个后果：① 表格闪一下；② 日期筛选面板（状态在子组件里）被卸载，
      选完起始日期就关了，第二个日期根本没法选。
    */
    placeholderData: keepPreviousData,
  })

  /** 改一项并**立刻生效** —— 下拉、日期用这个（对应旧版的 hx-trigger="change"） */
  const applyF = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch }
    setFilters(next)
    setApplied(next)
    setPage(1)
  }
  /** 文本框只改本地值；等回车或失焦再查（不然每敲一个字发一次请求） */
  const setF = (patch: Partial<Filters>) => setFilters({ ...filters, ...patch })
  const applyNow = () => {
    setApplied(filters)
    setPage(1)
  }
  const clearF = () => {
    setFilters(EMPTY_FILTERS)
    setApplied(EMPTY_FILTERS)
    setPage(1)
    setPicked([])
  }

  return (
    /* flex-1 + min-h-0：这一页要把内容区撑满（下面的面板用 flex 吃掉剩余高度，见 Card 处注释） */
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* 手机端不显示页面名：顶栏已经写着（见 app-shell），这块地方留给内容 */}
      <header className="flex flex-wrap items-center gap-2 max-md:hidden">
        <h1 className="flex-1 text-lg font-bold tracking-tight">进度历史</h1>
      </header>

      {/* 三个标签：任务进度 / 历史记录 / 回收站（与全站其它页同一个下划线样式） */}
      <div className="flex gap-1 border-b border-border" role="tablist" aria-label="进度历史">
        {(
          [
            ['progress', '任务进度', Activity],
            ['records', '历史记录', History],
            ['trash', '回收站', Trash2],
          ] as const
        ).map(([k, label, Icon]) => (
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

      {rowMsg && <FormMessage ok={rowMsg.ok}>{rowMsg.message}</FormMessage>}

      {/* ── 任务进度 ── */}
      {tab === 'progress' && (
      <Card className="py-4">
        <CardContent>
          {live.data?.running ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                <span className="font-medium">{live.data.taskName}</span>
                <span className="text-muted-foreground">
                  第 {live.data.done}/{live.data.total} 首 · {live.data.phase}
                </span>
                <span className="ml-auto text-xs text-muted-foreground">
                  ✅ {live.data.ok} · ❌ {live.data.fail} · ⚠️ {live.data.unsat}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${live.data.pct ?? 0}%` }}
                />
              </div>
              {live.data.current && (
                <p className="text-xs text-muted-foreground">正在处理：{live.data.current}</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">当前没有任务在运行</p>
          )}
        </CardContent>
      </Card>
      )}

      {/* ── 历史记录（下分 全部历史记录 / 任务批次）── */}
      {tab === 'records' && (
      /* 子标签行固定高，剩下的全给下面那张面板卡 */
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="flex gap-1" role="tablist" aria-label="历史记录视图">
          {([['rows', '全部历史记录'], ['batches', '任务批次']] as const).map(([k, lbl]) => (
            <Button
              key={k}
              type="button"
              role="tab"
              aria-selected={sub === k}
              size="sm"
              variant={sub === k ? 'default' : 'outline'}
              className="max-md:h-10"
              onClick={() => setSub(k)}
            >
              {lbl}
            </Button>
          ))}
        </div>

      {sub === 'batches' ? (
        <HistoryBatches
          labels={data?.labels ?? { processes: {}, statuses: {} }}
          /*
            歌名可点：打开「歌曲来历」卡。
            旁边「看它的全部记录」开的是**同一张卡**，只是进去时记录已经展开着 ——
            批次页原本是另开一张记录弹卡，现在记录折在来历卡里，没必要再套一层。
          */
          onShowSong={(name, key) => setSongCard({ name, key })}
          onShowRecords={(name, key) => setSongCard({ name, key, records: true })}
        />
      ) : (
      /*
        参考 MoviePilot 的媒体整理页：**表头（含筛选行）与分页条固定，只有中间的列表滚动**。
        文档流那套（整页滚）在长列表上会把筛选条件滚没了。

        ⚠️ 高度是 `flex-1` **撑满**，不是 `calc(100svh - Nrem)` 算死。
        算死的那版（原 PANEL_H）在手机上得减 336px，可各标签页头部高度根本不一样 ——
        「回收站」没有子标签行、起点高 56px，于是底部空出 156px（实测）。
        弹性撑满后不管头部多高、视口多大都严丝合缝。
        `min-h-[18rem]` 是兜底：视口特别矮时不至于压成一条。
      */
      <Card className="flex min-h-[18rem] flex-1 flex-col py-4">
        <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="flex-1 text-sm font-bold text-emerald-700 dark:text-emerald-400">
              全部历史记录
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                共 {data?.total ?? 0} 条 · 第 {data?.page ?? 1}/{data?.pages ?? 1} 页
              </span>
            </h2>
            {/*
              批量删除入口放这儿（列表右上角），不放列表底下 ——
              底下那条要滚到列表末尾才看得见，勾完还得去找。
              没勾选时按钮是灰的，顺便当"这里能勾选删除"的提示。
            */}
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={!picked.length}
              onClick={() => setDelOpen(true)}
            >
              <Trash2 />
              删除所选{picked.length > 0 ? `（${picked.length}）` : ''}
            </Button>
          </div>

          {/*
            ⚠️ 空结果时**必须保留表头那一行筛选控件**，否则筛出 0 条就再也改不了条件了
            （实测：选「操作=移出」得到 0 条后整张表连筛选行一起消失）。
            所以空状态放进 <tbody> 里，表头和筛选行始终在。
          */}
          {isLoading || !data ? (
            <DelayedLoading loading className="py-8 text-center text-sm text-muted-foreground" />
          ) : (
            <>
              {/* 桌面：滚动发生在这里（横竖都在这一层），表头 sticky 在容器顶部 */}
              {/* 表格是「一个整体」—— 用细边线框住（深色下纯色差不够明显） */}
              <div className="hidden min-h-0 flex-1 overflow-auto rounded-lg border border-border md:block">
                <table className="w-full min-w-[1780px] text-sm">
                  {/* 列宽固定，否则逐栏筛选框会把表格撑得忽宽忽窄 */}
                  <colgroup>
                    <col className="w-8" />
                    <col className="w-28" />
                    <col className="w-40" />
                    <col className="w-44" />
                    <col className="w-44" />
                    <col className="w-32" />
                    <col className="w-20" />
                    <col className="w-16" />
                    <col className="w-56" />
                    <col className="w-28" />
                    <col className="w-20" />
                    <col className="w-64" />
                    <col className="w-36" />
                    <col className="w-20" />
                  </colgroup>
                  {/* sticky：表头（列名 + 筛选行）钉在滚动容器顶部；底色必须不透明，否则会透出行 */}
                  <thead className="sticky top-0 z-10 bg-card text-left text-xs text-muted-foreground shadow-[inset_0_-1px_0] shadow-border">
                    <tr>
                      <th className="py-2 pr-2 font-medium">
                        <Checkbox
                          aria-label="全选本页"
                          checked={data.rows.length > 0 && data.rows.every((r) => picked.includes(r.id))}
                          onChange={(e) => setPicked(e.target.checked ? data.rows.map((r) => r.id) : [])}
                        />
                      </th>
                      <th className="py-2 pr-3 font-medium whitespace-nowrap">日期时间</th>
                      <th className="py-2 pr-3 font-medium whitespace-nowrap">所属任务</th>
                      <th className="py-2 pr-3 font-medium whitespace-nowrap">任务属性</th>
                      <th className="py-2 pr-3 font-medium whitespace-nowrap">歌曲名</th>
                      <th className="py-2 pr-3 font-medium whitespace-nowrap">歌手</th>
                      <th className="py-2 pr-3 font-medium whitespace-nowrap">音质</th>
                      <th className="py-2 pr-3 font-medium whitespace-nowrap">操作</th>
                      <th className="py-2 pr-3 font-medium whitespace-nowrap">处理过程</th>
                      <th className="py-2 pr-3 font-medium whitespace-nowrap">结果</th>
                      <th className="py-2 pr-3 font-medium whitespace-nowrap">文件大小</th>
                      <th className="py-2 pr-3 font-medium whitespace-nowrap">文件路径</th>
                      <th className="py-2 pr-3 font-medium whitespace-nowrap">引用情况</th>
                      <th className="py-2 text-right font-medium whitespace-nowrap">行操作</th>
                    </tr>

                    {/*
                      第二行表头 = 逐栏筛选（参考旧版）。
                      下拉和日期改完即查；文本框等回车/失焦 —— 每敲一个字发一次请求太吵。
                    */}
                    <tr className="align-top">
                      <th />
                      <th className="pb-2 pr-3">
                        <DateRangeFilter
                          from={filters.from}
                          to={filters.to}
                          onChange={(patch) => applyF(patch)}
                          onClear={() => applyF({ from: '', to: '' })}
                        />
                      </th>
                      <th className="pb-2 pr-3">
                        <select
                          aria-label="按所属任务筛选"
                          value={filters.taskName}
                          onChange={(e) => applyF({ taskName: e.target.value })}
                          className={FCTL}
                        >
                          <option value="">全部任务</option>
                          {data.facets.taskNames.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </th>
                      <th className="pb-2 pr-3">
                        <input
                          aria-label="按任务属性筛选"
                          title="按任务设置项过滤：镜像、处理3、歌单名、前 15 首…"
                          value={filters.attr}
                          onChange={(e) => setF({ attr: e.target.value })}
                          onKeyDown={(e) => e.key === 'Enter' && applyNow()}
                          onBlur={applyNow}
                          placeholder="如 镜像/处理3"
                          className={FCTL}
                        />
                      </th>
                      <th className="pb-2 pr-3">
                        <input
                          aria-label="按歌名筛选"
                          value={filters.song}
                          onChange={(e) => setF({ song: e.target.value })}
                          onKeyDown={(e) => e.key === 'Enter' && applyNow()}
                          onBlur={applyNow}
                          placeholder="歌名关键词"
                          className={FCTL}
                        />
                      </th>
                      <th className="pb-2 pr-3">
                        <input
                          aria-label="按歌手筛选"
                          value={filters.singer}
                          onChange={(e) => setF({ singer: e.target.value })}
                          onKeyDown={(e) => e.key === 'Enter' && applyNow()}
                          onBlur={applyNow}
                          placeholder="歌手关键词"
                          className={FCTL}
                        />
                      </th>
                      <th className="pb-2 pr-3">
                        <select aria-label="按音质筛选" value={filters.quality} onChange={(e) => applyF({ quality: e.target.value })} className={FCTL}>
                          <option value="">全部</option>
                          {data.facets.qualities.map((q) => (
                            <option key={q} value={q}>
                              {q}
                            </option>
                          ))}
                        </select>
                      </th>
                      <th className="pb-2 pr-3">
                        <select aria-label="按操作筛选" value={filters.action} onChange={(e) => applyF({ action: e.target.value })} className={FCTL}>
                          <option value="">全部</option>
                          <option value="in">入库</option>
                          <option value="out">移出</option>
                        </select>
                      </th>
                      <th className="pb-2 pr-3">
                        <select aria-label="按处理过程筛选" value={filters.process} onChange={(e) => applyF({ process: e.target.value })} className={FCTL}>
                          <option value="">全部</option>
                          {data.labels.groups.map((g) => (
                            <optgroup key={g.label} label={g.label}>
                              {g.codes.map((c) => (
                                <option key={c} value={c}>
                                  {data.labels.processes[c] ?? c}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </th>
                      <th className="pb-2 pr-3">
                        <select aria-label="按结果筛选" value={filters.status} onChange={(e) => applyF({ status: e.target.value })} className={FCTL}>
                          <option value="">全部</option>
                          {['success', 'skipped_dup', 'dedup', 'removed', 'unsatisfied', 'failed'].map((s) => (
                            <option key={s} value={s}>
                              {data.labels.statuses[s]?.label ?? s}
                            </option>
                          ))}
                        </select>
                      </th>
                      <th className="pb-2 pr-3" />
                      <th className="pb-2 pr-3">
                        <input
                          aria-label="按文件路径筛选"
                          value={filters.path}
                          onChange={(e) => setF({ path: e.target.value })}
                          onKeyDown={(e) => e.key === 'Enter' && applyNow()}
                          onBlur={applyNow}
                          placeholder="路径关键词"
                          className={FCTL}
                        />
                      </th>
                      <th className="pb-2 pr-3">
                        <input
                          aria-label="按引用情况筛选"
                          title="按引用这首歌的任务名过滤，如 华语 / 热歌榜"
                          value={filters.ref}
                          onChange={(e) => setF({ ref: e.target.value })}
                          onKeyDown={(e) => e.key === 'Enter' && applyNow()}
                          onBlur={applyNow}
                          placeholder="引用任务名"
                          className={FCTL}
                        />
                      </th>
                      <th className="pb-2 text-right">
                        <button
                          type="button"
                          onClick={clearF}
                          title="清空所有筛选条件"
                          className="rounded border border-input px-1.5 py-1 text-xs whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground"
                        >
                          清除筛选
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {!data.rows.length && (
                      <tr>
                        <td colSpan={14} className="py-8 text-center">
                          <p className="text-sm text-muted-foreground">没有匹配的记录</p>
                          {/* UX 规则：空状态要给「消息 + 行动」，不能只有前半句 */}
                          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={clearF}>
                            清除筛选
                          </Button>
                        </td>
                      </tr>
                    )}
                    {data.rows.map((r) => (
                      <tr key={r.id} className="border-b last:border-b-0">
                        <td className="py-2 pr-2">
                          <Checkbox
                            aria-label={`选中 ${r.songName ?? r.songKey}`}
                            checked={picked.includes(r.id)}
                            onChange={(e) => setPicked(e.target.checked ? [...picked, r.id] : picked.filter((x) => x !== r.id))}
                          />
                        </td>
                        <td className="py-2 pr-3 text-xs whitespace-nowrap text-muted-foreground">
                          {fmt(r.startedAt)}
                        </td>
                        <td className="py-2 pr-3 text-xs">{r.taskName ?? '—'}</td>
                        <td className="py-2 pr-3 text-xs text-muted-foreground">
                          {taskAttrs(r, data.labels).join(' · ')}
                        </td>
                        <td className="py-2 pr-3">
                          <span className="flex items-center gap-2.5">
                            <Cover songKey={r.songKey} size={36} />
                            <button
                              type="button"
                              className="text-left hover:underline"
                              title="看这首歌的完整来历"
                              onClick={() => setSongCard({ name: r.songName ?? r.songKey, key: r.songKey })}
                            >
                              {r.songName ?? r.songKey}
                            </button>
                            {r.attemptNo > 1 && (
                              <span className="ml-1 text-xs text-muted-foreground">第{r.attemptNo}次</span>
                            )}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-xs">{r.singer ?? '—'}</td>
                        <td className="py-2 pr-3">
                          <Badge variant="secondary">{r.quality ?? '—'}</Badge>
                        </td>
                        <td className="py-2 pr-3 text-xs">{r.action ? (ACTION_LABEL[r.action] ?? r.action) : '—'}</td>
                        <td className="py-2 pr-3 text-xs">
                          <Badge variant="outline">{r.process ? (data.labels.processes[r.process] ?? r.process) : '—'}</Badge>
                          {/* 轨迹：这首歌一步步做了什么（查库/试档位/下载/校验/入库…） */}
                          <Trajectory detail={r.detail} className="mt-0.5" />
                        </td>
                        <td className="py-2 pr-3 text-xs">
                          <StatusLabel status={r.status} labels={data.labels.statuses} />
                          {r.errorReason && (
                            <span className="block text-xs text-muted-foreground">{r.errorReason}</span>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-xs whitespace-nowrap text-muted-foreground">{fmtSize(r.fileSize)}</td>
                        <td className="py-2 pr-3 text-xs break-all text-muted-foreground">{r.filePath ?? '—'}</td>
                        <td className="py-2 pr-3 text-xs text-muted-foreground">{refsText(r.refBefore, r.refAfter)}</td>
                        <td className="py-2 text-right">
                          <RetryButton id={r.id} onMsg={setRowMsg} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 移动：卡片列表，滚动同样只发生在这一层 */}
              <div className="min-h-0 flex-1 space-y-3 overflow-auto md:hidden">
                {!data.rows.length && (
                  <div className="py-8 text-center">
                    <p className="text-sm text-muted-foreground">没有匹配的记录</p>
                    <Button type="button" variant="outline" size="sm" className="mt-3" onClick={clearF}>
                      清除筛选
                    </Button>
                  </div>
                )}
                {/*
                  手机：**紧凑行 + 点开展开**，一行约 74px —— 一屏能扫 4 条。
                  原来把 8 个字段 + 轨迹 + 重试全铺开，一张卡 391px，而列表可视区才 316px，
                  连一条都放不下，看历史变成一直往下拨（实测）。
                  行里只留"扫一眼要用的"三条（歌名/状态、任务·音质·操作、时间·大小），
                  其余字段收进行尾 ▸ 展开的那块。
                */}
                {data.rows.map((r) => {
                  const open = openRow === r.id
                  return (
                    <div key={r.id} className="rounded-lg border">
                      <div className="flex items-center gap-2.5 p-2.5">
                        <Checkbox
                          checked={picked.includes(r.id)}
                          onChange={(e) => setPicked(e.target.checked ? [...picked, r.id] : picked.filter((x) => x !== r.id))}
                        />
                        <Cover songKey={r.songKey} size={40} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            {/* 点歌名还是去「歌曲来历」卡，和桌面表格同一个动作 */}
                            <button
                              type="button"
                              className="min-w-0 flex-1 truncate text-left font-medium hover:underline"
                              title="看这首歌的完整来历"
                              onClick={() => setSongCard({ name: r.songName ?? r.songKey, key: r.songKey })}
                            >
                              {r.songName ?? r.songKey}
                            </button>
                            <StatusLabel status={r.status} labels={data.labels.statuses} />
                            {r.attemptNo > 1 && (
                              <span className="shrink-0 text-xs text-muted-foreground">第{r.attemptNo}次</span>
                            )}
                          </div>
                          <p className="truncate text-xs text-muted-foreground">
                            {[r.taskName, r.quality, r.action ? (ACTION_LABEL[r.action] ?? r.action) : '']
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {fmt(r.startedAt)} · {fmtSize(r.fileSize)}
                          </p>
                        </div>
                        {/*
                          ⚠️ 展开开关必须是**独立按钮**，不能让整行可点：
                          行里已经有勾选框和歌名两个可点元素，按钮套按钮是非法 HTML。
                        */}
                        <button
                          type="button"
                          aria-expanded={open}
                          aria-label={open ? '收起详情' : '展开详情'}
                          className="grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
                          onClick={() => setOpenRow(open ? null : r.id)}
                        >
                          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                        </button>
                      </div>

                      {open && (
                        <div className="border-t p-2.5">
                          {/* 只列行里没显示的那些字段，不重复上面三条 */}
                          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                            <dt className="text-muted-foreground">歌手</dt>
                            <dd>{r.singer ?? '—'}</dd>
                            <dt className="text-muted-foreground">处理过程</dt>
                            <dd>
                              {r.process ? (data.labels.processes[r.process] ?? r.process) : '—'}
                              {/* 轨迹贴在「处理过程」值下面 —— 它就是这一步做了什么 */}
                              <Trajectory detail={r.detail} className="mt-1" />
                            </dd>
                            <dt className="text-muted-foreground">任务属性</dt>
                            <dd>{taskAttrs(r, data.labels).join(' · ')}</dd>
                            <dt className="text-muted-foreground">文件路径</dt>
                            <dd className="break-all">{r.filePath ?? '—'}</dd>
                            <dt className="text-muted-foreground">引用情况</dt>
                            <dd>{refsText(r.refBefore, r.refAfter)}</dd>
                          </dl>
                          {r.errorReason && <p className="mt-1 text-xs text-muted-foreground">{r.errorReason}</p>}
                          <div className="mt-2 border-t pt-2">
                            <RetryButton id={r.id} onMsg={setRowMsg} />
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/*
                分页：在滚动区**外面**，所以列表怎么滚它都钉在面板底部（没有结果时不显示）。
                手机上藏掉首/末页 —— 五个按钮 358px 放不下会折成两行、白吃 50px 高度。
              */}
              <div className={cn('flex shrink-0 flex-wrap items-center justify-center gap-2 border-t pt-3', !data.rows.length && 'hidden')}>
                <Button variant="outline" size="sm" className="max-md:hidden" disabled={data.page <= 1} onClick={() => setPage(1)}>
                  首页
                </Button>
                <Button variant="outline" size="sm" disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}>
                  上一页
                </Button>
                <span className="px-2 text-sm text-muted-foreground">
                  {data.page} / {data.pages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={data.page >= data.pages}
                  onClick={() => setPage(data.page + 1)}
                >
                  下一页
                </Button>
                <Button variant="outline" size="sm" className="max-md:hidden" disabled={data.page >= data.pages} onClick={() => setPage(data.pages)}>
                  末页
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      )}

      {/* 批量删除条（有勾选时才出现） */}
      {/* 删除确认弹框：选项 + 提示 + 确认都在里面 */}
      {delOpen && (
        <Sheet open onClose={() => setDelOpen(false)} title={`删除 ${picked.length} 条记录`}>
          <DeletePanel
            ids={picked}
            onDone={(r) => {
              setRowMsg(r)
              setPicked([])
              setDelOpen(false)
            }}
            onCancel={() => setDelOpen(false)}
          />
        </Sheet>
      )}

      {/* 歌曲来历卡（「看这首歌的全部记录」是**卡内折叠**，不跳标签、也不再套一层弹卡） */}
      {songCard && (
        <SongCard
          name={songCard.name}
          songKey={songCard.key}
          records={songCard.records}
          onClose={() => setSongCard(null)}
        />
      )}
      </div>
      )}

      {/* ── 回收站 ── */}
      {tab === 'trash' && <TrashCard onMsg={setRowMsg} />}
    </div>
  )
}

function StatusLabel({ status, labels }: { status: string; labels: Record<string, { label: string }> }) {
  const text = labels[status]?.label ?? status
  return (
    <span className={cn('whitespace-nowrap', status !== 'success' && 'text-muted-foreground')}>{text}</span>
  )
}

/**
 * 处理轨迹：「这首歌一步步做了什么」（查库/试档位/下载/校验/入库…），默认收起。
 *
 * 收的是**原始 detail 串**，解析和"空轨迹整个不渲染"都在里面 ——
 * 三处（桌面表格 / 手机卡片 / 记录列表）共用这一份，不用每处各写一遍
 * `detailSteps(x).length > 0`（原来同一个值还被解析了两遍）。
 *
 * 位置一律紧贴「处理过程」那一格的值下面：它就是这一步做了什么，甩到卡片最底下就对不上了。
 */
function Trajectory({ detail, className }: { detail: string | null; className?: string }) {
  const steps = detailSteps(detail)
  if (!steps.length) return null
  return (
    <details className={className}>
      <summary className="cursor-pointer text-xs text-muted-foreground select-none">轨迹</summary>
      <ol className="mt-1 list-inside list-decimal space-y-0.5 text-xs text-muted-foreground">
        {steps.map((s, i) => (
          <li key={i} className="break-words">
            {s}
          </li>
        ))}
      </ol>
    </details>
  )
}

function fmt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function fmtSize(n: number | null): string {
  if (!n) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** 行内「重试」：只对未成功的记录有意义 */
function RetryButton({ id, onMsg }: { id: number; onMsg: (r: { ok: boolean; message: string }) => void }) {
  const qc = useQueryClient()
  const retry = useMutation({
    mutationFn: () => api.post<{ ok: boolean; message: string }>(`/history/item/${id}/retry-json`, {}),
    onSuccess: (r) => {
      onMsg(r)
      if (r.ok) void qc.invalidateQueries({ queryKey: ['history'] })
    },
    onError: (e) => onMsg({ ok: false, message: e instanceof Error ? e.message : '重试失败' }),
  })
  return (
    <Button type="button" variant="ghost" size="sm" className="max-md:h-10" disabled={retry.isPending} onClick={() => retry.mutate()}>
      <RotateCcw />
      重试
    </Button>
  )
}

/** 回收站：按批次分组列出，可恢复或彻底删除 */
function TrashCard({ onMsg }: { onMsg: (r: { ok: boolean; message: string }) => void }) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['trash'],
    queryFn: () => api.get<{ batches: string[]; files: { rel: string; size: number; batch: string }[] }>('/trash'),
  })

  const act = (path: string, body: Record<string, unknown>, confirmText?: string) => async () => {
    if (confirmText && !window.confirm(confirmText)) return
    try {
      const r = await api.post<{ ok: boolean; message: string }>(path, body)
      onMsg(r)
      void qc.invalidateQueries({ queryKey: ['trash'] })
    } catch (e) {
      onMsg({ ok: false, message: e instanceof Error ? e.message : '操作失败' })
    }
  }

  const files = data?.files ?? []

  return (
    /* 同样：标题和说明固定，只有中间的文件列表滚动；高度撑满（见「全部历史记录」那张卡的注释） */
    <Card className="flex min-h-[18rem] flex-1 flex-col py-4">
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
        <h2 className="text-sm font-bold text-emerald-700 dark:text-emerald-400">回收站</h2>
        <p className="text-xs text-muted-foreground">
          共 {files.length} 个文件（{data?.batches.length ?? 0} 个批次）——移入后媒体库中暂时不可见，可恢复；
          <b>彻底删除</b>才真正删磁盘文件。
        </p>

        {isLoading ? (
          <DelayedLoading loading className="py-6 text-center text-sm text-muted-foreground" />
        ) : !files.length ? (
          <p className="py-6 text-center text-sm text-muted-foreground">回收站是空的</p>
        ) : (
          <div className="min-h-0 flex-1 space-y-2 overflow-auto">
            {(data?.batches ?? []).map((b) => {
              const bfiles = files.filter((f) => f.batch === b)
              return (
                <details key={b} className="rounded-lg border p-2">
                  <summary className="cursor-pointer select-none text-xs">
                    批次 {b.replace(/(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, '$1:$2:$3.$4Z')}（{bfiles.length} 个文件）
                  </summary>
                  <div className="mt-2 space-y-1.5">
                    {bfiles.map((f) => (
                      <div key={f.rel} className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="min-w-0 flex-1 break-all">{f.rel}</span>
                        <span className="text-muted-foreground">{fmtSize(f.size)}</span>
                        <Button type="button" variant="outline" size="sm" className="max-md:h-9" onClick={act('/trash/restore-json', { rel: f.rel })}>
                          恢复
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive max-md:h-9"
                          onClick={act('/trash/purge-json', { full: f.batch ? `${f.batch}/${f.rel.replace(/^[^/]*\//, '')}` : f.rel }, `彻底删除「${f.rel}」？此操作不可恢复。`)}
                        >
                          <Trash2 />
                          彻底删除
                        </Button>
                      </div>
                    ))}
                  </div>
                </details>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** 批量删除：三个复选框由用户决定删什么（与旧页面同一套语义）。装在 Sheet 弹框里用。 */
function DeletePanel({
  ids,
  onDone,
  onCancel,
}: {
  ids: number[]
  onDone: (r: { ok: boolean; message: string }) => void
  onCancel: () => void
}) {
  const qc = useQueryClient()
  const [file, setFile] = useState(false)
  const [playlist, setPlaylist] = useState(false)
  const [history, setHistory] = useState(false)

  const del = useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; message: string }>('/history/delete-json', {
        sel: ids.map((id) => String(id)).join(','),
        file,
        playlist,
        history,
      }),
    onSuccess: (r) => {
      onDone(r)
      void qc.invalidateQueries({ queryKey: ['history'] })
    },
    onError: (e) => onDone({ ok: false, message: e instanceof Error ? e.message : '删除失败' }),
  })

  return (
    <div className="space-y-4">
      {/*
        排版说明（第一版有点乱，改过）：
        - 三个勾选项**不要排成三列**：弹框才 512px 宽，一列只剩 ~140px，
          括号里的说明全被折成两三行，高低不齐像一团乱麻。
          改成一列一行，每行「复选框 + 固定宽度的名称 + 说明」三栏对齐，扫一眼就清楚。
        - 名称保持 text-sm、说明降到 text-xs/muted —— 主次分开。
        - 按钮靠右：主要操作放最右（和系统对话框一致），破坏性按钮在右、取消在左。
      */}
      <p className="text-xs leading-relaxed text-muted-foreground">
        决定「以后会不会重新下载」的是<b className="text-foreground">文件</b>，不是历史记录 ——
        删历史只是清账；删掉文件，下次同步才会重新下载。
      </p>

      <div className="overflow-hidden rounded-lg border">
        <p className="border-b bg-muted/50 px-3 py-1.5 text-xs font-medium text-muted-foreground">一并清理</p>
        <Label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50">
          <Checkbox checked={file} onChange={(e) => setFile(e.target.checked)} />
          <span className="w-16 shrink-0 text-sm">文件</span>
          <span className="min-w-0 text-xs text-muted-foreground">移入回收站，下次同步会重新下载</span>
        </Label>
        <Label className="flex cursor-pointer items-center gap-3 border-t px-3 py-2.5 transition-colors hover:bg-muted/50">
          <Checkbox checked={playlist} onChange={(e) => setPlaylist(e.target.checked)} />
          <span className="w-16 shrink-0 text-sm">歌单</span>
          <span className="min-w-0 text-xs text-muted-foreground">从歌单移除本任务加过的歌</span>
        </Label>
        <Label className="flex cursor-pointer items-center gap-3 border-t px-3 py-2.5 transition-colors hover:bg-muted/50">
          <Checkbox checked={history} onChange={(e) => setHistory(e.target.checked)} />
          <span className="w-16 shrink-0 text-sm">历史记录</span>
          <span className="min-w-0 text-xs text-muted-foreground">只清账，不影响同步</span>
        </Label>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
        {!file && !playlist && !history && (
          <span className="mr-auto text-xs text-muted-foreground">至少勾一项</span>
        )}
        <Button type="button" variant="outline" onClick={onCancel}>
          取消
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={del.isPending || (!file && !playlist && !history)}
          onClick={() => del.mutate()}
        >
          {del.isPending ? '删除中…' : `确认删除 ${ids.length} 条`}
        </Button>
      </div>
    </div>
  )
}

/**
 * 歌曲来历卡：点歌名弹出，复用 /history/search-json。
 *
 * 「看这首歌的全部记录」是**本卡里的折叠内容**，不再另开弹卡：
 * 旧版 Eta 是弹层套弹层（看完记录关掉能回到来历卡），React 版当初做成"弹卡顶掉弹卡"，
 * 关掉记录就回不到来历卡了。折进同一张卡里两个问题一起没了。
 *
 * 宽度固定 xl(576px)：这张卡现在要装记录列表，512px 下「文件路径」那种长值折得太碎。
 */
function SongCard({
  name,
  songKey,
  records = false,
  onClose,
}: {
  name: string
  songKey: string
  /** 打开时记录就展开着（批次页点「看它的全部记录」走这条） */
  records?: boolean
  onClose: () => void
}) {
  const [showRecords, setShowRecords] = useState(records)
  const { data, isLoading } = useQuery({
    queryKey: ['song-card', name],
    queryFn: () =>
      api.get<{
        songs: { songKey: string; name: string; singer: string; records: number; firstId: number; firstAt: string }[]
      }>(`/history/search-json?q=${encodeURIComponent(name)}`),
  })
  const hit = data?.songs?.[0]

  return (
    <Sheet open onClose={onClose} size="xl" title={`歌曲来历：${name}`}>
      <div className="space-y-3">
        <div className="flex gap-4">
          <Cover songKey={songKey} size={120} />
          <div className="min-w-0 flex-1">
            {isLoading ? (
              <DelayedLoading loading className="py-6 text-center text-sm text-muted-foreground" />
            ) : !hit ? (
              <p className="py-6 text-center text-sm text-muted-foreground">没有找到这首歌的记录</p>
            ) : (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">歌手</dt>
                <dd>{hit.singer || '—'}</dd>
                <dt className="text-muted-foreground">记录数</dt>
                <dd>{hit.records} 条</dd>
                <dt className="text-muted-foreground">首次出现</dt>
                <dd>{hit.firstAt ? fmt(hit.firstAt) : '—'}</dd>
                <dt className="text-muted-foreground">歌曲 key</dt>
                <dd className="break-all text-xs">{hit.songKey}</dd>
              </dl>
            )}
          </div>
        </div>

        <div className="border-t pt-3">
          {/* 折叠记号跟按钮同行：▸ 收起 / ▾ 展开，和任务批次那条时间线同一套图标 */}
          <Button
            type="button"
            size="sm"
            aria-expanded={showRecords}
            onClick={() => setShowRecords((v) => !v)}
          >
            {showRecords ? <ChevronDown /> : <ChevronRight />}
            看这首歌的全部记录
          </Button>

          {showRecords && (
            <div className="mt-3">
              <SongRecords name={name} />
            </div>
          )}
        </div>
      </div>
    </Sheet>
  )
}

/**
 * 一首歌的全部记录（按歌名筛过的明细），折在「歌曲来历」卡里用。
 *
 * 不做成"跳到明细标签 + 按歌名筛"：那样会把当前这张卡顶掉（旧版 Eta 能回去是因为弹层套弹层）。
 *
 * 栏目**和「全部历史记录」那张表一致**（任务属性/操作/处理过程/文件大小/文件路径/引用情况…），
 * 只是弹框摆不下 1780px 的宽表，所以每条记录竖排成「字段：值」。
 * 字段值都走 history-meta 里那几个 helper，和表格用同一套，不会两边说法不一样。
 */
function SongRecords({ name }: { name: string }) {
  const [page, setPage] = useState(1)
  const { data, isLoading } = useQuery({
    queryKey: ['song-records', name, page],
    queryFn: () => api.get<HistoryData>(`/history/rows-json?song=${encodeURIComponent(name)}&page=${page}`),
    placeholderData: keepPreviousData,
  })

  if (isLoading || !data) {
    return <DelayedLoading loading className="py-8 text-center text-sm text-muted-foreground" />
  }
  if (!data.rows.length) {
    return <p className="py-8 text-center text-sm text-muted-foreground">没有记录</p>
  }

  return (
    <>
      <p className="mb-2 text-xs text-muted-foreground">共 {data.total} 条</p>
      {/* 列表跟着 Sheet 的 body 一起滚 —— 弹框已限高可滚，这里别再套一层，双滚动条会打架 */}
      <div className="space-y-3">
        {data.rows.map((r) => {
          const attrs = taskAttrs(r, data.labels).join(' · ')
          const refs = refsText(r.refBefore, r.refAfter)
          const process = r.process ? (data.labels.processes[r.process] ?? r.process) : '—'
          const L: [string, React.ReactNode][] = [
            ['任务', r.taskName ?? '—'],
            ['任务属性', attrs || '—'],
            ['歌手', r.singer ?? '—'],
            ['音质', r.quality ?? '—'],
            ['操作', r.action ? (ACTION_LABEL[r.action] ?? r.action) : '—'],
            [
              '处理过程',
              <>
                {process}
                {/* 轨迹紧跟在「处理过程」的值下面：它就是这一步一步步做了什么，隔开就对不上了 */}
                <Trajectory detail={r.detail} className="mt-0.5" />
              </>,
            ],
            ['文件大小', fmtSize(r.fileSize)],
            ['文件路径', <span className="break-all">{r.filePath ?? '—'}</span>],
            ['引用情况', refs],
          ]
          return (
            <div key={r.id} className="overflow-hidden rounded-lg border">
              {/* 头部：时间 + 结果徽章（对应表里的「日期时间」「结果」两列） */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-muted/40 px-3 py-1.5">
                <span className="font-mono text-xs tabular-nums text-muted-foreground">{fmt(r.startedAt)}</span>
                <StatusLabel status={r.status} labels={data.labels.statuses} />
                {r.attemptNo > 1 && <span className="text-xs text-muted-foreground">第 {r.attemptNo} 次</span>}
              </div>

              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 px-3 py-2 text-xs">
                {L.map(([k, v]) => (
                  <Fragment key={k}>
                    <dt className="whitespace-nowrap text-muted-foreground">{k}</dt>
                    <dd className="min-w-0">{v}</dd>
                  </Fragment>
                ))}
              </dl>

              {r.errorReason && (
                <p className="border-t px-3 py-1.5 text-xs text-destructive">{r.errorReason}</p>
              )}
            </div>
          )
        })}
      </div>

      {/*
        翻页条钉在滚动区底部（负边距抵消 Sheet body 的 p-4，做成通栏贴底）——
        和桌面表格版"分页在滚动区外、列表怎么滚它都钉着"是同一个意图。
      */}
      {data.pages > 1 && (
        <div className="sticky bottom-0 -mx-4 mt-3 flex flex-wrap items-center justify-center gap-2 border-t bg-popover px-4 py-3">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            上一页
          </Button>
          <span className="px-2 text-sm text-muted-foreground">
            {page} / {data.pages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>
            下一页
          </Button>
        </div>
      )}
    </>
  )
}
