import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Save } from 'lucide-react'

import { modeHint, modeLabel } from '@/lib/mirror-hint'
import { FormMessage } from '@/components/form-message'
import { InfoTip } from '@/components/info-tip'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { FieldLabel, Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Sheet } from '@/components/sheet'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { TaskCardRow } from '@/components/task-cards'

/**
 * 任务编辑弹框（参考 MoviePilot：点「编辑」弹出独立对话框，改完保存关闭）。
 *
 * 为什么不做"行内编辑"：
 *  - 卡片视图里根本没有"行"可编辑
 *  - 编辑是有始有终的动作，弹框天然框住「改完 / 取消」
 *  - 与创建表单的交互语言一致（都是"填表 → 保存"）
 */
export function TaskEditDialog({
  task,
  targetKey,
  scopeUI,
  fileDeleteOK,
  onClose,
  onSaved,
}: {
  task: TaskCardRow
  targetKey: string
  scopeUI: boolean
  fileDeleteOK: boolean
  onClose: () => void
  onSaved: (r: { ok: boolean; message: string }) => void
}) {
  const qc = useQueryClient()
  const isChart = task.taskType === 'chart'
  const [name, setName] = useState(task.lxPlaylistName)
  const [mode, setMode] = useState<'incremental' | 'mirror'>(task.mode === 'mirror' ? 'mirror' : 'incremental')
  const [delPolicy, setDelPolicy] = useState<'keep' | 'delete' | 'archive'>(
    task.delPolicy === 'delete' || task.delPolicy === 'archive' ? task.delPolicy : 'keep',
  )
  const [archivePlaylist, setArchivePlaylist] = useState(task.archivePlaylist ?? '')
  const [cronExpr, setCronExpr] = useState(task.cronExpr ?? '')
  const [maxCount, setMaxCount] = useState(task.maxCount ?? 30)
  const [sameName, setSameName] = useState(task.createSameNamePlaylist)
  const [scope, setScope] = useState(task.playlistScope ?? 'shared')
  const [targets, setTargets] = useState<string[]>(task.targetIds ?? [])
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null)

  const scopes = useQuery({
    queryKey: ['scopes', targetKey],
    queryFn: () => api.get<{ users: { id: string; name: string }[] }>(`/options/scopes?type=${targetKey}`),
    enabled: scopeUI,
  })
  const playlists = useQuery({
    queryKey: ['playlists', scope],
    queryFn: () => api.get<{ playlists: { id: string; name: string }[] }>(`/options/playlists?playlistScope=${encodeURIComponent(scope)}`),
  })

  const save = useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; message: string }>(`/tasks/${task.id}/update`, {
        lxPlaylistName: name,
        mode,
        delPolicy: mode === 'mirror' ? delPolicy : undefined,
        archivePlaylist: mode === 'mirror' && delPolicy === 'archive' ? archivePlaylist : undefined,
        cronExpr,
        maxCount: isChart ? maxCount : undefined,
        createSameNamePlaylist: sameName,
        playlistScope: scopeUI ? scope : undefined,
        embyTarget: targets,
      }),
    onSuccess: (r) => {
      setMsg(r)
      onSaved(r)
      if (r.ok) {
        void qc.invalidateQueries({ queryKey: ['tasks'] })
        onClose()
      }
    },
    onError: (e) => setMsg({ ok: false, message: e instanceof Error ? e.message : '保存失败' }),
  })

  return (
    <Sheet open onClose={onClose} title={`编辑：${task.lxPlaylistName}`}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <div>
          <Label htmlFor="ed-name">
            <FieldLabel className="mb-0">任务名称</FieldLabel>
          </Label>
          <Input id="ed-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        {isChart && (
          <div>
            <Label htmlFor="ed-max">
              <FieldLabel className="mb-0">范围（每期取前 N 首，0 = 全部）</FieldLabel>
            </Label>
            <Input
              id="ed-max"
              type="number"
              min={0}
              value={maxCount}
              onChange={(e) => setMaxCount(Number(e.target.value))}
              className="w-28"
            />
          </div>
        )}

        <div>
          <Label htmlFor="ed-cron">
            <FieldLabel className="mb-0">定时 cron（空 = 仅手动）</FieldLabel>
          </Label>
          <Input
            id="ed-cron"
            value={cronExpr}
            onChange={(e) => setCronExpr(e.target.value)}
            placeholder="0 8 * * *"
            className="w-full font-mono md:w-44"
          />
        </div>

        {scopeUI && (
          <div>
            <Label htmlFor="ed-scope">
              <FieldLabel className="mb-0">目标歌单归属</FieldLabel>
            </Label>
            <Select id="ed-scope" value={scope} onChange={(e) => { setScope(e.target.value); setTargets([]) }}>
              <option value="shared">共享（所有人可见）</option>
              {scopes.data?.users.map((u) => (
                <option key={u.id} value={`${u.id}|${u.name}`}>
                  {u.name}
                </option>
              ))}
            </Select>
          </div>
        )}

        <Label className="cursor-pointer">
          <Checkbox checked={sameName} onChange={(e) => setSameName(e.target.checked)} />
          <span className="text-sm">同名播放列表/歌单（同步时自动生成）</span>
        </Label>

        <div>
          <FieldLabel>同步到已有播放列表/歌单</FieldLabel>
          <div className="max-h-40 overflow-y-auto rounded-lg border p-2">
            {!playlists.data?.playlists.length ? (
              <span className="text-xs text-muted-foreground">该作用域下没有可选歌单</span>
            ) : (
              playlists.data.playlists.map((p) => (
                <Label key={p.id} className="min-h-9 cursor-pointer py-0.5">
                  <Checkbox
                    checked={targets.includes(p.id)}
                    onChange={(e) =>
                      setTargets(e.target.checked ? [...targets, p.id] : targets.filter((x) => x !== p.id))
                    }
                  />
                  <span className="text-sm">{p.name}</span>
                </Label>
              ))
            )}
          </div>
        </div>

        <div className="space-y-1 border-t pt-3">
          {(['incremental', 'mirror'] as const).map((m) => (
            <Label key={m} className="cursor-pointer items-start py-0.5">
              <input type="radio" name="ed-mode" className="mt-1 accent-primary" checked={mode === m} onChange={() => setMode(m)} />
              <span className="flex items-center gap-1.5 text-sm">
                {modeLabel(m)}
                <InfoTip>{modeHint(m, isChart ? 'chart' : 'playlist')}</InfoTip>
              </span>
            </Label>
          ))}
        </div>

        {mode === 'mirror' && (
          <div className="ml-4 space-y-1">
            {(
              [
                ['keep', '处理1 移除 + 文件不删'],
                ['delete', '处理2 移除 + 删文件'],
                ['archive', '处理3 移入归档歌单'],
              ] as const
            ).map(([k, label]) => (
              <Label
                key={k}
                className={cn('items-start py-0.5', k === 'delete' && !fileDeleteOK ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')}
              >
                <input
                  type="radio"
                  name="ed-del"
                  className="mt-1 accent-primary"
                  checked={delPolicy === k}
                  disabled={k === 'delete' && !fileDeleteOK}
                  onChange={() => setDelPolicy(k)}
                />
                <span className="text-sm">{label}</span>
              </Label>
            ))}
            {delPolicy === 'archive' && (
              <Input
                value={archivePlaylist}
                onChange={(e) => setArchivePlaylist(e.target.value)}
                placeholder="归档歌单名"
                className="ml-4 w-full md:w-56"
                aria-label="归档歌单名"
              />
            )}
          </div>
        )}

        {msg && <FormMessage ok={msg.ok}>{msg.message}</FormMessage>}

        <div className="flex flex-wrap gap-2 border-t pt-3">
          <Button type="submit" disabled={save.isPending}>
            <Save />
            {save.isPending ? '保存中…' : '保存'}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
        </div>
      </form>
    </Sheet>
  )
}
