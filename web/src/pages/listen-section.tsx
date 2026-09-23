import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Save, ScanSearch } from 'lucide-react'

import { modeHint, modeLabel } from '@/lib/mirror-hint'
import { FormMessage } from '@/components/form-message'
import { InfoTip } from '@/components/info-tip'
import { ModeCard } from '@/components/mode-card'
import { Sheet } from '@/components/sheet'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { FieldLabel, Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

type TaskMode = 'mirror' | 'incremental'
type DelPolicy = 'keep' | 'delete' | 'archive'
export type ListenParams = {
  createSameNamePlaylist: boolean
  embyTargetPlaylistIds: string[]
  taskMode: TaskMode
  delPolicy: DelPolicy
  archivePlaylist: string
  taskCron: string
}
type Rule = { enabled: boolean; keywords: string[] }
export type ListenData = {
  enabled: boolean
  activeMode: 'all' | 'filtered'
  checkCron: string
  includeExisting: boolean
  baselineCount: number
  existingCount: number
  all: ListenParams
  filtered: { params: ListenParams; rules: { exclude: Rule; match: Rule } }
  ignored: { key: string; name: string }[]
}
type Result = { ok: boolean; message: string }

export function ListenSection({
  listen,
  targetName,
  fileDeleteOK,
  defaultArchive,
  onMsg,
}: {
  listen: ListenData
  targetName: string
  fileDeleteOK: boolean
  defaultArchive: string
  onMsg: (r: Result) => void
}) {
  const qc = useQueryClient()
  const [form, setForm] = useState(listen)
  const [msg, setMsg] = useState<Result | null>(null)
  /** 正在编辑哪个模式的设置（null = 没开） */
  const [settingsFor, setSettingsFor] = useState<'all' | 'filtered' | null>(null)

  // 「同步到已有歌单」候选（两种模式共用一份）
  const playlists = useQuery({
    queryKey: ['playlists', 'shared'],
    queryFn: () => api.get<{ ok: boolean; playlists: { id: string; name: string }[] }>('/options/playlists?playlistScope=shared'),
  })

  const save = useMutation({
    mutationFn: () => api.post<Result>('/listen', form),
    onSuccess: (r) => {
      setMsg(r)
      onMsg(r)
      void qc.invalidateQueries({ queryKey: ['listen'] })
    },
    onError: (e) => setMsg({ ok: false, message: e instanceof Error ? e.message : '保存失败' }),
  })
  const scan = useMutation({
    mutationFn: () => api.post<Result>('/listen/scan-now', {}),
    onSuccess: (r) => {
      setMsg(r)
      onMsg(r)
    },
  })
  const pause = useMutation({
    mutationFn: () => api.post<Result>('/listen/pause', { mode: form.activeMode }),
    onSuccess: (r) => {
      setMsg(r)
      onMsg(r)
      void qc.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
  const resume = useMutation({
    mutationFn: () => api.post<Result>('/listen/resume-now', { mode: form.activeMode }),
    onSuccess: (r) => {
      setMsg(r)
      onMsg(r)
      void qc.invalidateQueries({ queryKey: ['tasks'] })
    },
  })

  const setAll = (p: ListenParams) => setForm({ ...form, all: p })
  const setFilteredParams = (p: ListenParams) =>
    setForm({ ...form, filtered: { ...form.filtered, params: p } })
  const setRule = (g: 'exclude' | 'match', r: Rule) =>
    setForm({ ...form, filtered: { ...form.filtered, rules: { ...form.filtered.rules, [g]: r } } })

  return (
    <div className="space-y-4">
      {/* 启用 + 检测 */}
      <div className="rounded-lg border bg-card p-3">
        <div className="flex flex-wrap items-center gap-3">
          <Label className="min-h-11 cursor-pointer md:min-h-0">
            <Checkbox checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            <span className="text-sm font-semibold">启用监听</span>
          </Label>
          <span className="text-xs text-muted-foreground">检测 cron</span>
          <Input
            value={form.checkCron}
            onChange={(e) => setForm({ ...form, checkCron: e.target.value })}
            className="w-full font-mono md:w-40"
            aria-label="检测 cron"
          />
          <Button type="button" variant="outline" size="sm" onClick={() => scan.mutate()} disabled={scan.isPending}>
            <ScanSearch />
            立即检测
          </Button>
        </div>
      </div>

      {/* 监听模式：两张卡片，各自的详细设置收进弹框 */}
      <div>
        <h3 className="mb-2 text-sm font-bold">监听模式（互斥，二选一）</h3>
        <div className="grid gap-3 md:grid-cols-2">
          <ModeCard
            title="完全监听"
            desc="LX 里出现的新歌单，全部自动建任务"
            active={form.activeMode === 'all'}
            onSelect={() => setForm({ ...form, activeMode: 'all' })}
            onSettings={() => setSettingsFor('all')}
            summary={form.includeExisting ? `纳入现有歌单 · ${form.all.taskMode === 'mirror' ? '镜像' : '增量'}` : form.all.taskMode === 'mirror' ? '镜像' : '增量'}
          />
          <ModeCard
            title="条件监听"
            desc="只对命中规则的新歌单建任务"
            active={form.activeMode === 'filtered'}
            onSelect={() => setForm({ ...form, activeMode: 'filtered' })}
            onSettings={() => setSettingsFor('filtered')}
            summary={
              [
                form.filtered.rules.exclude.enabled ? `排除 ${form.filtered.rules.exclude.keywords.length} 词` : '',
                form.filtered.rules.match.enabled ? `匹配 ${form.filtered.rules.match.keywords.length} 词` : '',
                form.filtered.params.taskMode === 'mirror' ? '镜像' : '增量',
              ]
                .filter(Boolean)
                .join(' · ')
            }
          />
        </div>
      </div>

      {/* 忽略列表 */}
      {form.ignored.length > 0 && (
        <div className="rounded-lg border bg-card p-3">
          <h3 className="mb-2 text-sm font-bold">已忽略的歌单</h3>
          <div className="flex flex-wrap gap-2">
            {form.ignored.map((it) => (
              <span key={it.key} className="inline-flex items-center gap-2 rounded-md border px-2 py-1 text-xs">
                {it.name}
                <button
                  type="button"
                  className="text-destructive hover:underline"
                  onClick={async () => {
                    const r = await api.post<{ ok: boolean; message: string; ignored: typeof form.ignored }>(
                      '/listen/unignore-json',
                      { key: it.key },
                    )
                    setForm({ ...form, ignored: r.ignored })
                    onMsg({ ok: true, message: r.message })
                  }}
                >
                  取消忽略
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {msg && <FormMessage ok={msg.ok}>{msg.message}</FormMessage>}

      {/* ── 完全监听的设置弹框 ── */}
      {settingsFor === 'all' && (
        <Sheet open onClose={() => setSettingsFor(null)} title="完全监听 · 新任务默认设置">
          <div className="space-y-4">
            <Label className="min-h-11 cursor-pointer md:min-h-0">
              <Checkbox
                checked={form.includeExisting}
                disabled={!form.includeExisting && !form.existingCount}
                onChange={(e) => setForm({ ...form, includeExisting: e.target.checked })}
              />
              <span className="flex items-center gap-1.5 text-sm">
                纳入现有歌单
                <InfoTip>
                  已有 {form.existingCount} 个可纳入；当前基线 {form.baselineCount} 个不自动纳入
                </InfoTip>
              </span>
            </Label>
            <TaskDefaults
              value={form.all}
              onChange={setAll}
              targetName={targetName}
              fileDeleteOK={fileDeleteOK}
              defaultArchive={defaultArchive}
              playlists={playlists.data?.playlists ?? []}
            />
            <div className="border-t pt-3">
              <Button type="button" onClick={() => setSettingsFor(null)}>
                完成
              </Button>
            </div>
          </div>
        </Sheet>
      )}

      {/* ── 条件监听的设置弹框 ── */}
      {settingsFor === 'filtered' && (
        <Sheet open onClose={() => setSettingsFor(null)} title="条件监听 · 规则与新任务默认设置">
          <div className="space-y-4">
            <div className="space-y-2">
              {(['exclude', 'match'] as const).map((g) => (
                <div key={g}>
                  <Label className="min-h-11 cursor-pointer md:min-h-0">
                    <Checkbox
                      checked={form.filtered.rules[g].enabled}
                      onChange={(e) => setRule(g, { ...form.filtered.rules[g], enabled: e.target.checked })}
                    />
                    <span className="text-sm font-semibold">{g === 'exclude' ? '排除' : '匹配'}</span>
                    <span className="text-xs text-muted-foreground">
                      （{g === 'exclude' ? '命中不同步' : '命中才同步'}）
                    </span>
                  </Label>
                  <Input
                    value={form.filtered.rules[g].keywords.join(',')}
                    onChange={(e) =>
                      setRule(g, { ...form.filtered.rules[g], keywords: e.target.value.split(/[,，\s]+/).filter(Boolean) })
                    }
                    placeholder="歌单名关键词，逗号分隔"
                    className="mt-1"
                    aria-label={`${g === 'exclude' ? '排除' : '匹配'}关键词`}
                  />
                </div>
              ))}
            </div>
            <div className="border-t pt-4">
              <TaskDefaults
                value={form.filtered.params}
                onChange={setFilteredParams}
                targetName={targetName}
                fileDeleteOK={fileDeleteOK}
                defaultArchive={defaultArchive}
                playlists={playlists.data?.playlists ?? []}
              />
            </div>
            <div className="border-t pt-3">
              <Button type="button" onClick={() => setSettingsFor(null)}>
                完成
              </Button>
            </div>
          </div>
        </Sheet>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t pt-4">
        <Button type="button" onClick={() => save.mutate()} disabled={save.isPending}>
          <Save />
          保存监听设置
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => pause.mutate()} disabled={pause.isPending}>
          暂停当前模式自动任务（可恢复）
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => resume.mutate()} disabled={resume.isPending}>
          恢复自动任务
        </Button>
      </div>
    </div>
  )
}

/** 新任务默认设置 —— 完全模式与条件模式共用同一套字段（只是提交时的前缀不同） */
function TaskDefaults({
  value,
  onChange,
  targetName,
  fileDeleteOK,
  defaultArchive,
  playlists,
}: {
  value: ListenParams
  onChange: (v: ListenParams) => void
  targetName: string
  fileDeleteOK: boolean
  defaultArchive: string
  playlists: { id: string; name: string }[]
}) {
  const [useExisting, setUseExisting] = useState(value.embyTargetPlaylistIds.length > 0)
  const set = (patch: Partial<ListenParams>) => onChange({ ...value, ...patch })

  return (
    <div className="mt-2 space-y-3">
      <Label className="min-h-11 cursor-pointer py-0.5 md:min-h-0">
        <Checkbox
          checked={value.createSameNamePlaylist}
          onChange={(e) => set({ createSameNamePlaylist: e.target.checked })}
        />
        <span className="text-sm">同名播放列表/歌单（自动生成）</span>
      </Label>

      <Label className="min-h-11 cursor-pointer py-0.5 md:min-h-0">
        <Checkbox
          checked={useExisting}
          onChange={(e) => {
            setUseExisting(e.target.checked)
            if (!e.target.checked) set({ embyTargetPlaylistIds: [] })
          }}
        />
        <span className="text-sm">同步到已有播放列表/歌单</span>
      </Label>

      {useExisting && (
        <div className="ml-6 max-h-40 overflow-y-auto rounded-lg border p-2">
          {!playlists.length ? (
            <span className="text-xs text-muted-foreground">（未取到候选歌单）</span>
          ) : (
            playlists.map((p) => (
              <Label key={p.id} className="min-h-11 cursor-pointer py-0.5 md:min-h-0">
                <Checkbox
                  checked={value.embyTargetPlaylistIds.includes(p.id)}
                  onChange={(e) =>
                    set({
                      embyTargetPlaylistIds: e.target.checked
                        ? [...value.embyTargetPlaylistIds, p.id]
                        : value.embyTargetPlaylistIds.filter((x) => x !== p.id),
                    })
                  }
                />
                <span className="text-sm">{p.name}</span>
              </Label>
            ))
          )}
        </div>
      )}

      <div className="space-y-1">
        {(['incremental', 'mirror'] as const).map((m) => (
          <Label key={m} className="min-h-11 cursor-pointer items-start py-0.5 md:min-h-0">
            <input
              type="radio"
              name={`tm-${defaultArchive}-${m}`}
              className="mt-1 accent-primary"
              checked={value.taskMode === m}
              onChange={() => set({ taskMode: m })}
            />
            <span className="flex items-center gap-1.5 text-sm">
              {modeLabel(m)}
              <InfoTip>{modeHint(m, 'playlist')}</InfoTip>
            </span>
          </Label>
        ))}
      </div>

      {value.taskMode === 'mirror' && (
        <div className="ml-4 space-y-1">
          <h5 className="text-xs font-bold text-muted-foreground">LX 端删除时处理方式：</h5>
          {(
            [
              ['keep', '处理1 歌单移除 + 文件不删（默认）'],
              ['delete', '处理2 歌单移除 + 删除文件'],
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
                name={`dp-${defaultArchive}-${k}`}
                className="mt-1 accent-primary"
                checked={value.delPolicy === k}
                disabled={k === 'delete' && !fileDeleteOK}
                onChange={() => set({ delPolicy: k })}
              />
              <span className="text-sm">
                {label}
                {k === 'delete' && !fileDeleteOK && <span className="text-destructive">（当前 {targetName} 不支持）</span>}
              </span>
            </Label>
          ))}
          {value.delPolicy === 'archive' && (
            <Input
              value={value.archivePlaylist}
              onChange={(e) => set({ archivePlaylist: e.target.value })}
              placeholder={defaultArchive}
              className="ml-4 w-full md:w-64"
              aria-label="归档歌单名"
            />
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <FieldLabel className="mb-0">定时 cron</FieldLabel>
        <Input
          value={value.taskCron}
          onChange={(e) => set({ taskCron: e.target.value })}
          placeholder="0 6 * * *"
          className="w-full font-mono md:w-40"
          aria-label="新任务 cron"
        />
      </div>
    </div>
  )
}
