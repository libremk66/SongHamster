import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, RefreshCw } from 'lucide-react'

import { modeHint, modeLabel } from '@/lib/mirror-hint'
import { DelayedLoading } from '@/components/loading'
import { FormMessage } from '@/components/form-message'
import { InfoTip } from '@/components/info-tip'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { FieldLabel, Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

type Result = { ok: boolean; message: string }
type LxPlaylist = { key: string; name: string; songCount: number }
type Playlist = { id: string; name: string }
type Scope = { id: string; name: string }

export function CreateTaskForm({
  targetName,
  targetKey,
  scopeUI,
  fileDeleteOK,
  defaultArchive,
  onCreated,
}: {
  targetName: string
  targetKey: string
  scopeUI: boolean
  fileDeleteOK: boolean
  defaultArchive: string
  onCreated: (r: Result) => void
}) {
  const qc = useQueryClient()
  // 选中的 LX 歌单（可多选，一次建多个同配置任务）
  const [keys, setKeys] = useState<string[]>([])
  const [scope, setScope] = useState('shared')
  const [createSameName, setCreateSameName] = useState(true)
  const [useExisting, setUseExisting] = useState(false)
  const [targets, setTargets] = useState<string[]>([])
  const [mode, setMode] = useState<'incremental' | 'mirror'>('incremental')
  const [delPolicy, setDelPolicy] = useState<'keep' | 'delete' | 'archive'>('keep')
  const [archivePlaylist, setArchivePlaylist] = useState(defaultArchive)
  const [cronExpr, setCronExpr] = useState('')
  const [msg, setMsg] = useState<Result | null>(null)

  const lx = useQuery({
    queryKey: ['lx-playlists'],
    queryFn: () => api.get<{ ok: boolean; playlists: LxPlaylist[]; message?: string }>('/options/lx-playlists'),
  })
  // 作用域变化 → 重新拉已有歌单（级联）
  const scopes = useQuery({
    queryKey: ['scopes', targetKey],
    queryFn: () => api.get<{ ok: boolean; users: Scope[] }>(`/options/scopes?type=${targetKey}`),
    enabled: scopeUI,
  })
  const playlists = useQuery({
    queryKey: ['playlists', scope],
    queryFn: () =>
      api.get<{ ok: boolean; playlists: Playlist[]; message?: string }>(
        `/options/playlists?playlistScope=${encodeURIComponent(scope)}`,
      ),
    enabled: useExisting,
  })

  const create = useMutation({
    mutationFn: () =>
      api.post<Result>('/tasks/create', {
        lxPlaylistKey: keys,
        playlistScope: scopeUI ? scope : undefined,
        createSameNamePlaylist: createSameName,
        embyTarget: useExisting ? targets : [],
        mode,
        delPolicy: mode === 'mirror' ? delPolicy : undefined,
        archivePlaylist: mode === 'mirror' && delPolicy === 'archive' ? archivePlaylist : undefined,
        cronExpr,
      }),
    onSuccess: (r) => {
      setMsg(r)
      onCreated(r)
      if (r.ok) {
        setKeys([])
        setTargets([])
        void qc.invalidateQueries({ queryKey: ['tasks'] })
      }
    },
    onError: (e) => setMsg({ ok: false, message: e instanceof Error ? e.message : '创建失败' }),
  })

  const toggle = (arr: string[], set: (v: string[]) => void, v: string, on: boolean) =>
    set(on ? [...arr, v] : arr.filter((x) => x !== v))

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        create.mutate()
      }}
    >
      {/* 选择 LX 歌单 */}
      <div className="rounded-lg border bg-card p-3">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <h3 className="flex flex-1 items-center gap-1.5 text-sm font-bold">
            选择 LX 歌单
            <InfoTip>逐项勾选可一次为多个歌单创建任务（默认设置相同）。</InfoTip>
          </h3>
          <span className="text-xs text-muted-foreground">已选 {keys.length} 个</span>
          {/*
            原地重拉歌单列表。
            ⚠️ 原来是个指向旧页 /sync-setup 的整页跳转 —— 那不但会 404（旧页已删），
            就算还在也是把填了一半的表单冲掉。这里只让查询失效重取。
          */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            title="重新拉取 LX 歌单列表"
            onClick={() => void qc.invalidateQueries({ queryKey: ['lx-playlists'] })}
          >
            <RefreshCw />
            刷新
          </Button>
        </div>
        <div className="max-h-60 overflow-y-auto rounded-lg border p-2">
          {lx.isLoading ? (
            <DelayedLoading loading className="py-3 text-center text-xs text-muted-foreground" />
          ) : !lx.data?.playlists.length ? (
            <p className="py-3 text-center text-xs text-muted-foreground">
              未获取到 LX 歌单（连接 LX 后刷新）{lx.data?.message ? `：${lx.data.message}` : ''}
            </p>
          ) : (
            lx.data.playlists.map((p) => (
              <Label key={p.key} className="min-h-11 cursor-pointer py-0.5 md:min-h-0">
                <Checkbox checked={keys.includes(p.key)} onChange={(e) => toggle(keys, setKeys, p.key, e.target.checked)} />
                <span className="text-sm">
                  {p.name}
                  <span className="text-muted-foreground">（{p.songCount} 首）</span>
                </span>
              </Label>
            ))
          )}
        </div>
      </div>

      {/* 目标歌单 */}
      <div className="rounded-lg border bg-card p-3">
        <h3 className="mb-2 text-sm font-bold">同步到 {targetName} 的目标播放列表/歌单</h3>

        {scopeUI && (
          <div className="mb-3">
            <Label htmlFor="scope">
              <FieldLabel className="mb-0 flex items-center gap-1.5">
                目标歌单归属
                <InfoTip>
                  歌单在 {targetName} 里<b>按用户</b>存：选「共享」= 只找/建所有人可见的歌单；选某个账号 =
                  在该账号的歌单里找（能对上你自己的老歌单）
                </InfoTip>
              </FieldLabel>
            </Label>
            <Select id="scope" value={scope} onChange={(e) => setScope(e.target.value)}>
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
          <span className="text-sm">
            同名播放列表/歌单(<b>同步时自动生成</b>)
          </span>
        </Label>
        <Label className="min-h-11 cursor-pointer py-0.5 md:min-h-0">
          <Checkbox checked={useExisting} onChange={(e) => setUseExisting(e.target.checked)} />
          <span className="flex items-center gap-1.5 text-sm">
            同步到<b>已有</b>播放列表/歌单
            {mode === 'mirror' && (
              <InfoTip>
                🔒 镜像 + 已有歌单：只移除/加入<b>本任务产生的歌曲</b>；你手动加的与接管前已存在的歌曲不动（所有权追踪）。
              </InfoTip>
            )}
          </span>
        </Label>

        {useExisting && (
          <div className="mt-2 ml-6 max-h-44 overflow-y-auto rounded-lg border p-2">
            {playlists.isLoading ? (
              <span className="text-xs text-muted-foreground">加载中…</span>
            ) : !playlists.data?.playlists.length ? (
              <span className="text-xs text-muted-foreground">
                该作用域下没有可选播放列表
                {playlists.data?.message ? `：${playlists.data.message}` : ''}
              </span>
            ) : (
              playlists.data.playlists.map((p) => (
                <Label key={p.id} className="min-h-11 cursor-pointer py-0.5 md:min-h-0">
                  <Checkbox
                    checked={targets.includes(p.id)}
                    onChange={(e) => toggle(targets, setTargets, p.id, e.target.checked)}
                  />
                  <span className="text-sm">{p.name}</span>
                </Label>
              ))
            )}
          </div>
        )}

      </div>

      {/* 同步方式 */}
      <div className="rounded-lg border bg-card p-3">
        <h3 className="mb-2 text-sm font-bold">同步方式</h3>
        <div className="space-y-1">
          <Label className="min-h-11 cursor-pointer items-start py-0.5 md:min-h-0">
            <input
              type="radio"
              name="mode"
              className="mt-1 accent-primary"
              checked={mode === 'incremental'}
              onChange={() => setMode('incremental')}
            />
            <span className="flex items-center gap-1.5">
              <span className="text-sm font-medium">1 · {modeLabel('incremental')}</span>
              <InfoTip>{modeHint('incremental', 'playlist')}</InfoTip>
            </span>
          </Label>
          <Label className="min-h-11 cursor-pointer items-start py-0.5 md:min-h-0">
            <input
              type="radio"
              name="mode"
              className="mt-1 accent-primary"
              checked={mode === 'mirror'}
              onChange={() => setMode('mirror')}
            />
            <span className="flex items-center gap-1.5">
              <span className="text-sm font-medium">2 · {modeLabel('mirror')}</span>
              <InfoTip>{modeHint('mirror', 'playlist')}</InfoTip>
            </span>
          </Label>
        </div>

        {mode === 'mirror' && (
          <div className="mt-3 space-y-1 border-t pt-3">
            <h4 className="mb-1 text-xs font-bold text-muted-foreground">
              LX 端删除时，歌单/歌曲的处理方式：
            </h4>
            <Label className="min-h-11 cursor-pointer items-start py-0.5 md:min-h-0">
              <input type="radio" name="del" className="mt-1 accent-primary" checked={delPolicy === 'keep'} onChange={() => setDelPolicy('keep')} />
              <span className="text-sm">
                <b>处理1</b> 歌单移除 + 媒体库文件不删（默认）
              </span>
            </Label>
            <Label
              className={cn('min-h-11 items-start py-0.5 md:min-h-0', fileDeleteOK ? 'cursor-pointer' : 'cursor-not-allowed opacity-60')}
            >
              <input
                type="radio"
                name="del"
                className="mt-1 accent-primary"
                checked={delPolicy === 'delete'}
                disabled={!fileDeleteOK}
                onChange={() => setDelPolicy('delete')}
              />
              <span className="text-sm">
                <b>处理2</b> 歌单移除 + 删除文件
                {!fileDeleteOK && <span className="text-destructive">（当前 {targetName} 不支持）</span>}
              </span>
            </Label>
            <Label className="min-h-11 cursor-pointer items-start py-0.5 md:min-h-0">
              <input type="radio" name="del" className="mt-1 accent-primary" checked={delPolicy === 'archive'} onChange={() => setDelPolicy('archive')} />
              <span className="text-sm">
                <b>处理3</b> 歌单移除 + 移入归档歌单
              </span>
            </Label>

            {delPolicy === 'archive' && (
              <div className="ml-6 space-y-2 pt-1">
                <div className="flex items-center gap-1.5">
                  <Input
                    value={archivePlaylist}
                    onChange={(e) => setArchivePlaylist(e.target.value)}
                    placeholder={defaultArchive}
                    aria-label="归档歌单名"
                    className="flex-1"
                  />
                  <InfoTip>
                    输入框写目标歌单名（新的也行）；下拉挑预设或已有歌单。保存时不存在会自动创建，运行中被删则降级为「保留文件」
                  </InfoTip>
                </div>
                <Select
                  value=""
                  aria-label="选择归档目标预设"
                  onChange={(e) => {
                    const v = e.target.value
                    if (!v) return
                    setArchivePlaylist(v === 'source' ? '[歌单名]归档' : v)
                  }}
                >
                  <option value="">选择归档目标…</option>
                  <option value={defaultArchive}>统一：{defaultArchive}</option>
                  <option value="source">按来源：[歌单名]归档</option>
                  <optgroup label={`${targetName} 已有播放列表`}>
                    {playlists.data?.playlists.map((p) => (
                      <option key={p.id} value={p.name}>
                        {p.name}
                      </option>
                    ))}
                  </optgroup>
                </Select>
                <p className="text-xs text-muted-foreground">删除均先移入回收站，可在「进度历史 → 回收站」恢复或彻底删除。</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* cron */}
      <div className="rounded-lg border bg-card p-3">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="flex items-center gap-1.5 text-sm font-bold">
            定时 cron
            <InfoTip>空 = 仅手动（创建后立即同步一次）</InfoTip>
          </h3>
          <Input
            value={cronExpr}
            onChange={(e) => setCronExpr(e.target.value)}
            placeholder="0 6 * * *"
            className="w-full font-mono md:w-48"
            aria-label="cron 表达式"
          />
        </div>
      </div>

      {msg && <FormMessage ok={msg.ok}>{msg.message}</FormMessage>}

      <div className="border-t pt-4">
        <Button type="submit" disabled={create.isPending || !keys.length}>
          <Plus />
          {create.isPending ? '创建中…' : '添加任务'}
        </Button>
      </div>
    </form>
  )
}
