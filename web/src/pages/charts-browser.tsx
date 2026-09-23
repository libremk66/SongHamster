import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Plus } from 'lucide-react'

import { modeHint, modeLabel } from '@/lib/mirror-hint'
import { DelayedLoading } from '@/components/loading'
import { FormMessage } from '@/components/form-message'
import { InfoTip } from '@/components/info-tip'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { FieldLabel, Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

type Result = { ok: boolean; message: string }
type Board = { id: string; name: string }
type Song = { songKey: string; name: string; singer: string; album: string; best: string; downloaded: boolean }

/**
 * 平台清单**从后端拿**（`/tasks` 响应里的 `platforms`，源头是 lxserver 的 chartPlatforms）。
 * ⚠️ 别在前端再硬编码一份：曾经两处各写一遍，lxserver 停用百度后只改了一处，
 *    「百度」白列了很久，点进去必报 `try max num`。
 * 短名用于按钮/标题/**任务名**（`QQ·新歌榜`），别改成「QQ音乐」全名 —— 任务名会跟着变。
 */
export type Platform = { key: string; label: string }
const platLabel = (key: string, platforms: Platform[]) => platforms.find((p) => p.key === key)?.label ?? key

const QUALITY_LABEL: Record<string, string> = {
  master: '臻品母带', atmos_plus: 'Atmos+', atmos: 'Atmos', hires: 'Hi-Res',
  flac24bit: '24bit FLAC', flac: 'FLAC', '320k': '320K', '192k': '192K', '128k': '128K',
}

/* ── 新建订阅 ─────────────────────────────────── */
export function SubscribeForm({
  targetName,
  scopeUI,
  targetKey,
  fileDeleteOK,
  defaultArchive,
  onDone,
  platforms,
  /** 从浏览页带过来的榜单：带了就锁定，不再让人重选一遍 */
  presetBoard,
}: {
  targetName: string
  scopeUI: boolean
  targetKey: string
  fileDeleteOK: boolean
  defaultArchive: string
  onDone: (r: Result) => void
  /** 平台清单（后端给的，见文件头注释） */
  platforms: Platform[]
  presetBoard?: { source: string; id: string; name: string }
}) {
  const qc = useQueryClient()
  const [source, setSource] = useState(presetBoard?.source ?? 'tx')
  const [board, setBoard] = useState<Board | null>(presetBoard ? { id: presetBoard.id, name: presetBoard.name } : null)
  /** 任务名：默认「平台·榜单名」（如 QQ·新歌榜），用户改过就用改的；换平台/换榜单时回到新默认 */
  const [nameEdit, setNameEdit] = useState<string | null>(null)
  const taskName = nameEdit ?? (board ? `${platLabel(source, platforms)}·${board.name}` : '')
  const [maxCount, setMaxCount] = useState(30)
  const [cronExpr, setCronExpr] = useState('')
  const [scope, setScope] = useState('shared')
  const [createSameName, setCreateSameName] = useState(true)
  const [mode, setMode] = useState<'incremental' | 'mirror'>('incremental')
  const [delPolicy, setDelPolicy] = useState<'keep' | 'delete' | 'archive'>('keep')
  const [archivePlaylist, setArchivePlaylist] = useState(defaultArchive)
  const [msg, setMsg] = useState<Result | null>(null)

  const boards = useQuery({
    queryKey: ['boards', source],
    queryFn: () => api.get<{ ok: boolean; boards: Board[]; message?: string }>(`/charts/boards-json?source=${source}`),
  })
  const scopes = useQuery({
    queryKey: ['scopes', targetKey],
    queryFn: () => api.get<{ ok: boolean; users: { id: string; name: string }[] }>(`/options/scopes?type=${targetKey}`),
    enabled: scopeUI,
  })

  const sub = useMutation({
    mutationFn: () =>
      api.post<Result>('/charts/subscribe', {
        chartSource: source,
        chartId: board?.id,
        chartName: board?.name,
        lxPlaylistName: taskName.trim(),
        maxCount,
        cronExpr,
        playlistScope: scopeUI ? scope : undefined,
        createSameNamePlaylist: createSameName,
        mode,
        delPolicy: mode === 'mirror' ? delPolicy : undefined,
        archivePlaylist: mode === 'mirror' && delPolicy === 'archive' ? archivePlaylist : undefined,
      }),
    onSuccess: (r) => {
      setMsg(r)
      onDone(r)
      if (r.ok) {
        setBoard(null)
        void qc.invalidateQueries({ queryKey: ['tasks', 'chart'] })
      }
    },
    onError: (e) => setMsg({ ok: false, message: e instanceof Error ? e.message : '订阅失败' }),
  })

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        sub.mutate()
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor="sub-plat">
            <FieldLabel className="mb-0">平台</FieldLabel>
          </Label>
          <Select
            id="sub-plat"
            value={source}
            onChange={(e) => {
              setSource(e.target.value)
              setBoard(null)
              setNameEdit(null)
            }}
          >
            {platforms.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="sub-board">
            <FieldLabel className="mb-0">榜单</FieldLabel>
          </Label>
          <Select
            id="sub-board"
            value={board?.id ?? ''}
            onChange={(e) => {
              setBoard(boards.data?.boards.find((b) => b.id === e.target.value) ?? null)
              setNameEdit(null)
            }}
          >
            <option value="">{boards.isLoading ? '加载中…' : '选择榜单…'}</option>
            {boards.data?.boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="md:col-span-2">
          <Label htmlFor="sub-name">
            <FieldLabel className="mb-0">任务名</FieldLabel>
          </Label>
          <Input
            id="sub-name"
            value={taskName}
            placeholder="选择榜单后自动填「平台·榜单名」"
            onChange={(e) => setNameEdit(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="sub-max">
            <FieldLabel className="mb-0">范围（每期取前 N 首，0 = 全部）</FieldLabel>
          </Label>
          <Input
            id="sub-max"
            type="number"
            min={0}
            value={maxCount}
            onChange={(e) => setMaxCount(Number(e.target.value))}
            className="w-full md:w-28"
          />
        </div>
        <div>
          <Label htmlFor="sub-cron">
            <FieldLabel className="mb-0">定时 cron（空 = 仅手动）</FieldLabel>
          </Label>
          <Input
            id="sub-cron"
            value={cronExpr}
            onChange={(e) => setCronExpr(e.target.value)}
            placeholder="0 8 * * *"
            className="w-full font-mono md:w-40"
          />
        </div>
      </div>

      {scopeUI && (
        <div>
          <Label htmlFor="sub-scope">
            <FieldLabel className="mb-0">目标歌单归属</FieldLabel>
          </Label>
          <Select id="sub-scope" value={scope} onChange={(e) => setScope(e.target.value)} className="md:w-72">
            <option value="shared">共享（所有人可见）</option>
            {scopes.data?.users.map((u) => (
              <option key={u.id} value={`${u.id}|${u.name}`}>
                {u.name}
              </option>
            ))}
          </Select>
        </div>
      )}

      <Label className="min-h-11 cursor-pointer py-0.5 md:min-h-0">
        <Checkbox checked={createSameName} onChange={(e) => setCreateSameName(e.target.checked)} />
        <span className="text-sm">同名播放列表/歌单（同步时自动生成）</span>
      </Label>

      <div className="space-y-1">
        {(['incremental', 'mirror'] as const).map((m) => (
          <Label key={m} className="min-h-11 cursor-pointer items-start py-0.5 md:min-h-0">
            <input
              type="radio"
              name="sub-mode"
              className="mt-1 accent-primary"
              checked={mode === m}
              onChange={() => setMode(m)}
            />
            <span className="flex items-center gap-1.5 text-sm">
              {modeLabel(m)}
              <InfoTip>{modeHint(m, 'chart')}</InfoTip>
            </span>
          </Label>
        ))}
      </div>

      {mode === 'mirror' && (
        <div className="ml-4 space-y-1">
          <h5 className="text-xs font-bold text-muted-foreground">跌出榜单时处理方式：</h5>
          {(
            [
              ['keep', '处理1 播放列表移除 + 文件不删（默认）'],
              ['delete', '处理2 播放列表移除 + 删除文件'],
              ['archive', '处理3 移入归档歌单'],
            ] as const
          ).map(([k, label]) => (
            <Label
              key={k}
              className={cn(
                'min-h-11 items-start py-0.5 md:min-h-0',
                k === 'delete' && !fileDeleteOK ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
              )}
            >
              <input
                type="radio"
                name="sub-del"
                className="mt-1 accent-primary"
                checked={delPolicy === k}
                disabled={k === 'delete' && !fileDeleteOK}
                onChange={() => setDelPolicy(k)}
              />
              <span className="text-sm">
                {label}
                {k === 'delete' && !fileDeleteOK && <span className="text-destructive">（当前 {targetName} 不支持）</span>}
              </span>
            </Label>
          ))}
          {delPolicy === 'archive' && (
            <Input
              value={archivePlaylist}
              onChange={(e) => setArchivePlaylist(e.target.value)}
              placeholder={defaultArchive}
              className="ml-4 w-full md:w-64"
              aria-label="归档歌单名"
            />
          )}
        </div>
      )}

      {msg && <FormMessage ok={msg.ok}>{msg.message}</FormMessage>}

      <div className="border-t pt-4">
        <Button type="submit" disabled={sub.isPending || !board}>
          <Plus />
          {sub.isPending ? '订阅中…' : '订阅'}
        </Button>
      </div>
    </form>
  )
}

/* ── 榜单浏览 ─────────────────────────────────── */
export function BoardBrowser({
  onMsg,
  platforms,
  subscribeSlot,
}: {
  onMsg: (r: Result) => void
  platforms: Platform[]
  /** 由页面传入「订阅这个榜单」的入口（需要 targetName 等页面级信息） */
  subscribeSlot: (board: { source: string; id: string; name: string }) => React.ReactNode
}) {
  const [source, setSource] = useState('tx')
  const [board, setBoard] = useState<Board | null>(null)
  const [picked, setPicked] = useState<string[]>([])

  const boards = useQuery({
    queryKey: ['boards', source],
    queryFn: () => api.get<{ ok: boolean; boards: Board[]; message?: string }>(`/charts/boards-json?source=${source}`),
  })
  const songs = useQuery({
    queryKey: ['chart-songs', source, board?.id],
    queryFn: () =>
      api.get<{ ok: boolean; songs: Song[]; message?: string }>(
        `/charts/songs-json?source=${source}&bangid=${encodeURIComponent(board?.id ?? '')}`,
      ),
    enabled: !!board,
  })

  const dl = useMutation({
    mutationFn: () => api.post<Result>('/charts/download-json', { source, bangid: board?.id, songKeys: picked }),
    onSuccess: (r) => {
      onMsg(r)
      if (r.ok) setPicked([])
    },
    onError: (e) => onMsg({ ok: false, message: e instanceof Error ? e.message : '提交失败' }),
  })

  return (
    /*
      撑满可用高度 + 内部各自滚动（参考 MoviePilot 的媒体整理页）。
      ⚠️ 高度是 `flex-1` 撑满，**不是** `calc(100svh - Nrem)` 算死 ——
      算死的话页面头部一变（比如手机端藏掉页面名、删掉底栏）就对不上了。
      现在整条链（app-shell → 页面 → 这里）都是 flex，剩余高度自动算准。

      手机走**竖排 flex**，不走单列栅格：栅格下两个块各占固定高度的一半，
      榜单列表面板会把高度吃光，歌曲只剩 230px（实测内容 16100px 要在这个窗口里滚）。
      竖排 + 「榜单收进下拉」之后，歌曲列表能拿满 ≈500px。lg 起恢复左右双栏。
    */
    <div className="flex min-h-[24rem] flex-1 flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
      {/* 左：平台 + 榜单（手机只留平台按钮 + 榜单下拉，列表藏起来） */}
      <div className="flex min-h-0 flex-col gap-3 max-lg:shrink-0">
        <div className="flex flex-wrap gap-1.5">
          {platforms.map((p) => (
            <Button
              key={p.key}
              type="button"
              size="sm"
              variant={source === p.key ? 'default' : 'outline'}
              className="max-md:h-10"
              onClick={() => {
                setSource(p.key)
                setBoard(null)
              }}
            >
              {p.label}
            </Button>
          ))}
        </div>

        {/*
          手机专用：榜单收进下拉（原生 select，手机上就是系统选择器，20+ 个榜单也不怕）。
          和「新建订阅」里选榜单用的是同一个组件、同一套选项来源。
        */}
        <Select
          className="lg:hidden"
          aria-label="选择榜单"
          value={board?.id ?? ''}
          onChange={(e) => {
            setBoard(boards.data?.boards.find((b) => b.id === e.target.value) ?? null)
            setPicked([])
          }}
        >
          <option value="">{boards.isLoading ? '加载中…' : '选择榜单…'}</option>
          {boards.data?.boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-card p-2 max-lg:hidden">
          {boards.isLoading ? (
            <DelayedLoading loading className="py-3 text-center text-xs text-muted-foreground" />
          ) : !boards.data?.boards.length ? (
            <p className="py-3 text-center text-xs text-muted-foreground">
              该平台暂无榜单{boards.data?.message ? `：${boards.data.message}` : ''}
            </p>
          ) : (
            <div className="grid gap-1">
              {boards.data.boards.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className={cn(
                    'rounded-md px-2 py-2 text-left text-sm hover:bg-muted',
                    board?.id === b.id && 'bg-muted font-medium',
                  )}
                  onClick={() => {
                    setBoard(b)
                    setPicked([])
                  }}
                >
                  {b.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 右：歌曲（手机竖排时 flex-1 吃掉下拉之外的整屏高度） */}
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {!board ? (
          <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            选一个榜单，看当下歌曲
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              {/* 手机让标题独占一行：不独占的话「QQ · 流行指数榜 共 100 首」会被两个按钮挤成三行 */}
              <h3 className="w-full text-sm font-bold lg:w-auto lg:flex-1">
                {platLabel(source, platforms)} · {board.name}
                <span className="ml-2 text-xs font-normal text-muted-foreground">共 {songs.data?.songs.length ?? 0} 首</span>
              </h3>
              {subscribeSlot({ source, id: board.id, name: board.name })}
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!picked.length || dl.isPending}
                onClick={() => dl.mutate()}
              >
                <Download />
                下载所选（{picked.length}）
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              下载到 <code className="rounded bg-muted px-1">downloadRoot/手动下载/</code>，仅入库不入歌单
            </p>

            <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="sticky top-0 border-b bg-background text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-2 pl-2 font-medium">选</th>
                    <th className="py-2 pr-2 font-medium">#</th>
                    <th className="py-2 pr-3 font-medium">歌曲</th>
                    <th className="py-2 pr-3 font-medium max-md:hidden">歌手</th>
                    <th className="py-2 pr-3 font-medium max-md:hidden">最高音质</th>
                  </tr>
                </thead>
                <tbody>
                  {songs.isLoading ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-muted-foreground">
                        加载中…
                      </td>
                    </tr>
                  ) : (
                    songs.data?.songs.map((s, i) => (
                      <tr key={s.songKey} className="border-b last:border-b-0">
                        <td className="py-1.5 pl-2">
                          <Checkbox
                            checked={picked.includes(s.songKey)}
                            disabled={s.downloaded}
                            title={s.downloaded ? '已下载' : ''}
                            onChange={(e) =>
                              setPicked(e.target.checked ? [...picked, s.songKey] : picked.filter((x) => x !== s.songKey))
                            }
                          />
                        </td>
                        <td className="py-1.5 pr-2 text-xs text-muted-foreground">{i + 1}</td>
                        <td className="py-1.5 pr-3">
                          {s.name}
                          {s.downloaded && <span className="ml-1 text-xs text-emerald-600">✅ 已下载</span>}
                          <span className="block text-xs text-muted-foreground md:hidden">{s.singer}</span>
                        </td>
                        <td className="py-1.5 pr-3 text-xs max-md:hidden">{s.singer}</td>
                        <td className="py-1.5 pr-3 max-md:hidden">
                          <Badge variant="secondary">{QUALITY_LABEL[s.best] ?? s.best ?? '—'}</Badge>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
