import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight } from 'lucide-react'

import { Cover } from '@/components/cover'
import { DelayedLoading } from '@/components/loading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

type Batch = {
  id: number
  taskId: number
  taskName: string | null
  taskType: string | null
  trigger: string
  startedAt: string
  finishedAt: string | null
  result: string | null
  okCount: number
  failCount: number
  unsatisfiedCount: number
  removedCount: number
  dupCount: number
  mode: string | null
  delPolicy: string | null
}
type Item = {
  id: number
  songKey: string
  songName: string | null
  singer: string | null
  quality: string | null
  status: string
  process: string | null
  errorReason: string | null
  action: string | null
}
/** ⚠️ 字段名必须和后端 repo.SkippedDetail 一致：是 `name` 不是 `songName`，也没有 `reason` */
type Skipped = {
  songKey: string
  name: string
  singer: string
  status: string | null
  quality: string | null
  updatedAt: string | null
  records: number
  refs: number
  refNames: string[]
}
type Groups = { new: Item[]; reuse: Item[]; legacy: Item[]; other: Item[]; skipped: Skipped[] }
type Labels = { processes: Record<string, string>; statuses: Record<string, { label: string }> }

const TRIGGER_LABEL: Record<string, string> = { cron: '定时', manual: '手动', listen: '监听', retry: '重试' }

/** 筛选控件的小号样式 */
const FCTL =
  'h-7 w-full min-w-0 rounded border border-input bg-transparent px-1.5 text-xs outline-none transition-colors focus-visible:border-ring'

type BatchFilters = { taskName: string; trigger: string; mode: string; from: string; to: string }
const EMPTY_BF: BatchFilters = { taskName: '', trigger: '', mode: '', from: '', to: '' }

export function HistoryBatches({
  labels,
  onShowSong,
  onShowRecords,
}: {
  labels: Labels
  /** 点歌名 → 打开「歌曲来历」卡（和明细表里点歌名是同一个卡） */
  onShowSong: (name: string, songKey: string) => void
  /** 「看它的全部记录 →」：切到明细标签并按歌名筛 */
  onShowRecords: (name: string, songKey: string) => void
}) {
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState<number | null>(null)
  const [filters, setFilters] = useState<BatchFilters>(EMPTY_BF)
  const [applied, setApplied] = useState<BatchFilters>(EMPTY_BF)

  const params = new URLSearchParams({ page: String(page) })
  for (const [k, v] of Object.entries(applied)) if (v) params.set(k, v)

  const { data, isLoading } = useQuery({
    queryKey: ['batches', applied, page],
    queryFn: () =>
      api.get<{ batches: Batch[]; page: number; pages: number; total: number; taskNames: string[] }>(
        `/history/batches-json?${params}`,
      ),
    // 同「全部历史记录」：改筛选/翻页时保留旧数据，别让表格闪一下
    placeholderData: keepPreviousData,
  })

  /** 下拉和日期改完即查 */
  const applyF = (patch: Partial<BatchFilters>) => {
    const next = { ...filters, ...patch }
    setFilters(next)
    setApplied(next)
    setPage(1)
  }
  const clearF = () => {
    setFilters(EMPTY_BF)
    setApplied(EMPTY_BF)
    setPage(1)
  }
  const filtering = Object.values(applied).some(Boolean)

  return (
    /* 同「全部历史记录」：筛选行与分页条固定，只有中间时间线滚动；高度 flex 撑满 */
    <Card className="flex min-h-[18rem] flex-1 flex-col py-4">
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
        {/* ⚠️ 别加 flex-1：这个容器现在是**纵向** flex，flex-1 会变成"占满剩余高度"，
            把标题撑成一大块空白（实测顶出 250px） */}
        <h2 className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
          批次
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            共 {data?.total ?? 0} 个批次 · 第 {data?.page ?? 1}/{data?.pages ?? 1} 页
          </span>
        </h2>

        {/* 筛选：批次是「一次任务运行」，按运行属性筛最顺手 */}
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">任务</span>
            <select aria-label="按任务筛选" value={filters.taskName} onChange={(e) => applyF({ taskName: e.target.value })} className={FCTL}>
              <option value="">全部任务</option>
              {data?.taskNames.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">触发方式</span>
            <select aria-label="按触发方式筛选" value={filters.trigger} onChange={(e) => applyF({ trigger: e.target.value })} className={FCTL}>
              <option value="">全部</option>
              {Object.entries(TRIGGER_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">同步方式</span>
            <select aria-label="按同步方式筛选" value={filters.mode} onChange={(e) => applyF({ mode: e.target.value })} className={FCTL}>
              <option value="">全部</option>
              <option value="incremental">增量</option>
              <option value="mirror">镜像</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">起始日期</span>
            <input type="date" aria-label="起始日期" value={filters.from} onChange={(e) => applyF({ from: e.target.value })} className={FCTL} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">结束日期</span>
            <input type="date" aria-label="结束日期" value={filters.to} onChange={(e) => applyF({ to: e.target.value })} className={FCTL} />
          </label>
          {filtering && (
            <button
              type="button"
              onClick={clearF}
              title="清空所有筛选条件"
              className="rounded border border-input px-2 py-1 text-xs whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground"
            >
              清除筛选
            </button>
          )}
        </div>

        {isLoading || !data ? (
          <DelayedLoading loading className="py-8 text-center text-sm text-muted-foreground" />
        ) : !data.batches.length ? (
          <p className="py-8 text-center text-sm text-muted-foreground">还没有批次记录</p>
        ) : (
          <>
            {/* 竖直时间线：同步是「随时间发生的事」，表格是错的形式 */}
            <ol className="relative min-h-0 flex-1 space-y-0 overflow-auto border-l border-border pl-0">
              {data.batches.map((b, i) => (
                <li key={b.id} className="relative pb-4 pl-5 last:pb-0">
                  {/* 节点圆点：最新的实心、往下的空心 —— 一眼看出时间方向 */}
                  <span
                    className={cn(
                      'absolute -left-[5px] top-1.5 size-2.5 rounded-full border-2 border-background',
                      i === 0 ? 'bg-primary' : 'bg-muted-foreground/40',
                    )}
                    aria-hidden
                  />
                  <button
                    type="button"
                    className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left text-sm"
                    onClick={() => setOpenId(openId === b.id ? null : b.id)}
                    aria-expanded={openId === b.id}
                  >
                    {openId === b.id ? (
                      <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {fmt(b.startedAt)}
                    </span>
                    <span className="font-medium">
                      {b.taskType === 'chart' && '🏆 '}
                      {b.taskName ?? `任务#${b.taskId}`}
                    </span>
                    <Badge variant="outline">{TRIGGER_LABEL[b.trigger] ?? b.trigger}</Badge>
                    <ResultBadge result={b.result} />
                    {/*
                      ⚠️ 不要 ml-auto。这行是 w-full 的，ml-auto 会把这几个数字推到面板最右端 ——
                      1360px 宽的面板上离前面的徽章一千多像素，看着像掉队了。
                      紧跟在结果徽章后面读起来才是一句话。
                    */}
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {[
                        // 和任务卡片同一套说法：成/败 这种缩写没人看得懂
                        b.okCount ? `成功 ${b.okCount}` : '',
                        b.dupCount ? `复用 ${b.dupCount}` : '',
                        b.failCount ? `失败 ${b.failCount}` : '',
                        b.unsatisfiedCount ? `未满足 ${b.unsatisfiedCount}` : '',
                        b.removedCount ? `移出 ${b.removedCount}` : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </button>
                  {openId === b.id && <BatchDetail id={b.id} labels={labels} onShowSong={onShowSong} onShowRecords={onShowRecords} />}
                </li>
              ))}
            </ol>

            <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 border-t pt-3">
              <Button variant="outline" size="sm" disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}>
                上一页
              </Button>
              <span className="px-2 text-sm text-muted-foreground">
                {data.page} / {data.pages}
              </span>
              <Button variant="outline" size="sm" disabled={data.page >= data.pages} onClick={() => setPage(data.page + 1)}>
                下一页
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function BatchDetail({
  id,
  labels,
  onShowSong,
  onShowRecords,
}: {
  id: number
  labels: Labels
  onShowSong: (name: string, songKey: string) => void
  onShowRecords: (name: string, songKey: string) => void
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['batch-detail', id],
    queryFn: () => api.get<{ ok: boolean; groups: Groups }>(`/history/batch/${id}/rows-json`),
  })

  if (isLoading || !data?.ok) {
    return <p className="border-t p-3 text-xs text-muted-foreground">加载中…</p>
  }
  const g = data.groups
  return (
    <div className="space-y-3 border-t p-3">
      <Group title="新入库" items={g.new} labels={labels} onShowSong={onShowSong} onShowRecords={onShowRecords} />
      <Group title="复用已有" items={g.reuse} labels={labels} onShowSong={onShowSong} onShowRecords={onShowRecords} />
      {g.other.length > 0 && <Group title="其他" items={g.other} labels={labels} onShowSong={onShowSong} onShowRecords={onShowRecords} />}

      {/* 跳过：没进处理流程，用"来历摘要"还原 */}
      {g.skipped.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-bold text-muted-foreground">跳过（{g.skipped.length}）</h4>
          <div className="space-y-1">
            {/*
              ⚠️ 字段是 `name`，不是 `songName`。
              后端 SkippedDetail 返回的就是 `name`，旧 Eta 页面读的也是 `s.name`；
              React 版当初写成了 `s.songName` → 永远取不到 → 回落成 songKey，
              于是这里长期显示的是一串 tx_xxxx 而不是歌名。
              顺手把旧页面有、React 版漏掉的几项也补回来（状态/音质、最后处理、记录数）——
              数据后端本来就返回了，白丢可惜。
            */}
            {g.skipped.map((s) => {
              const sm = s.status ? labels.statuses[s.status] : null
              return (
                <div key={s.songKey} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 p-1.5 text-xs">
                  <Cover songKey={s.songKey} size={28} />
                  <SongName name={s.name} songKey={s.songKey} onShowSong={onShowSong} onShowRecords={onShowRecords} />
                  {s.singer && <span className="text-muted-foreground">{s.singer}</span>}
                  {sm ? (
                    <span>
                      {sm.label}
                      {s.quality ? `（${s.quality}）` : ''}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">无状态记录</span>
                  )}
                  <span className="text-muted-foreground">最后处理 {s.updatedAt ? fmt(s.updatedAt) : '—'}</span>
                  <span className="text-muted-foreground">共 {s.records} 条记录</span>
                  <span className="text-muted-foreground">
                    当前引用：{s.refNames?.length ? s.refNames.join('、') : '无'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {g.legacy.length > 0 && <Group title="早期记录（那时还没记录处理过程）" items={g.legacy} labels={labels} onShowSong={onShowSong} onShowRecords={onShowRecords} />}
    </div>
  )
}

/**
 * 可点的歌名 —— 点开「歌曲来历」卡，右边跟一个「看它的全部记录 →」。
 * 这两个动作旧版批次页都有（`histShowSong` / `histSongToRecords`），React 版当初没迁过来，
 * 于是批次里的歌名是死文字，看不出还可以点。
 */
function SongName({
  name,
  songKey,
  onShowSong,
  onShowRecords,
}: {
  name: string
  songKey: string
  onShowSong: (name: string, songKey: string) => void
  onShowRecords: (name: string, songKey: string) => void
}) {
  return (
    <>
      <button
        type="button"
        title="看这首歌的完整来历"
        className="font-medium underline-offset-2 hover:underline"
        onClick={() => onShowSong(name, songKey)}
      >
        {name}
      </button>
      <button
        type="button"
        title="开「歌曲来历」卡，记录直接展开着"
        className="text-muted-foreground hover:text-foreground hover:underline"
        onClick={() => onShowRecords(name, songKey)}
      >
        看它的全部记录 →
      </button>
    </>
  )
}

function Group({
  title,
  items,
  labels,
  onShowSong,
  onShowRecords,
}: {
  title: string
  items: Item[]
  labels: Labels
  onShowSong: (name: string, songKey: string) => void
  onShowRecords: (name: string, songKey: string) => void
}) {
  if (!items.length) return null
  return (
    <div>
      <h4 className="mb-1 text-xs font-bold text-muted-foreground">
        {title}（{items.length}）
      </h4>
      <div className="space-y-1">
        {items.map((i) => {
          const name = i.songName ?? i.songKey
          return (
            <div key={i.id} className="flex flex-wrap items-center gap-x-2 p-1.5 text-xs">
              <Cover songKey={i.songKey} size={28} />
              <SongName name={name} songKey={i.songKey} onShowSong={onShowSong} onShowRecords={onShowRecords} />
              {i.singer && <span className="text-muted-foreground">{i.singer}</span>}
              {i.quality && <Badge variant="secondary">{i.quality}</Badge>}
              <span className="text-muted-foreground">{labels.statuses[i.status]?.label ?? i.status}</span>
              {i.process && <span className="text-muted-foreground">{labels.processes[i.process] ?? i.process}</span>}
              {i.errorReason && <span className="text-destructive">{i.errorReason}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ResultBadge({ result }: { result: string | null }) {
  if (!result) return <Badge variant="outline">进行中</Badge>
  const map: Record<string, { label: string; cls: string }> = {
    success: { label: '成功', cls: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200' },
    partial: { label: '部分成功', cls: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200' },
    failed: { label: '失败', cls: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200' },
    interrupted: { label: '被中断', cls: 'bg-muted text-muted-foreground' },
  }
  const m = map[result] ?? { label: result, cls: '' }
  return <Badge variant="outline" className={cn('border-transparent', m.cls)}>{m.label}</Badge>
}

function fmt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
