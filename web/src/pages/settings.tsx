import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, Save, Shield, SlidersHorizontal } from 'lucide-react'

import { DelayedLoading } from '@/components/loading'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { FieldLabel, Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { NotifySection, type NotifyData } from '@/pages/notify-section'

type SettingsData = {
  general: { logRetentionDays: number }
  auth: { enabled: boolean; username: string }
}
type Result = { ok: boolean; message: string }

export function SettingsPage() {
  const [msg, setMsg] = useState<Result | null>(null)
  const [tab, setTab] = useState<'general' | 'account' | 'notify'>('general')
  /** 访问过的标签才渲染（学 MoviePilot 的 visitedTabs）——避免一进页面就拉三份数据 */
  const [visited, setVisited] = useState<Set<string>>(() => new Set(['general']))
  const { data, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<SettingsData>('/settings'),
  })
  const notify = useQuery({
    queryKey: ['notify'],
    queryFn: () => api.get<NotifyData>('/settings/notify'),
    // 没点过「通知」标签就不拉 —— 这个接口要读配置 + 组装 7 个渠道的规格，不必每次都跑
    enabled: visited.has('notify'),
  })

  const TABS = [
    ['general', '通用', SlidersHorizontal],
    ['account', '账号安全', Shield],
    ['notify', '通知', Bell],
  ] as const

  const go = (k: 'general' | 'account' | 'notify') => {
    setTab(k)
    setVisited((v) => new Set(v).add(k))
  }

  return (
    <div className="space-y-4">
      {/* 手机端不显示页面名：顶栏已经写着（见 app-shell），这块地方留给内容 */}
      <header className="max-md:hidden">
        <h1 className="text-lg font-bold tracking-tight">设置</h1>
      </header>

      {/* 横向标签（学 MoviePilot 的 settings 页）：一节一件事，不再竖着堆一页 */}
      <div className="flex gap-1 border-b border-border" role="tablist" aria-label="设置">
        {TABS.map(([k, label, Icon]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => go(k)}
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

      {isLoading || !data ? (
        <DelayedLoading loading className="py-10 text-center text-sm text-muted-foreground" />
      ) : (
        <>
          {tab === 'general' && <GeneralForm general={data.general} />}

          {tab === 'account' && <AuthForm auth={data.auth} />}

          {/* 通知：数据另拉，所以只在访问过之后挂载 */}
          {tab === 'notify' && visited.has('notify') && (
            <div className="space-y-3">
              {notify.data ? (
                <NotifySection data={notify.data} onMsg={setMsg} />
              ) : (
                <DelayedLoading loading className="py-8 text-center text-sm text-muted-foreground" />
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function SaveMsg({ msg }: { msg: { ok: boolean; message: string } | null }) {
  if (!msg) return null
  return <FormMessage ok={msg.ok}>{msg.message}</FormMessage>
}

function GeneralForm({ general }: { general: SettingsData['general'] }) {
  const qc = useQueryClient()
  const [days, setDays] = useState(general.logRetentionDays)
  const [msg, setMsg] = useState<Result | null>(null)

  const save = useMutation({
    mutationFn: () => api.post<Result>('/settings/general', { logRetentionDays: days }),
    onSuccess: (r) => {
      setMsg(r)
      void qc.invalidateQueries({ queryKey: ['settings'] })
    },
    onError: (e) => setMsg({ ok: false, message: e instanceof Error ? e.message : '保存失败' }),
  })

  return (
    <div className="space-y-4">
        <h2 className="text-sm font-bold">通用</h2>
        <div>
          <Label htmlFor="logRetentionDays">
            <FieldLabel className="mb-0">日志保留天数</FieldLabel>
          </Label>
          <Input
            id="logRetentionDays"
            type="number"
            min={1}
            max={365}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="w-28"
          />
          <div className="mt-1">
            <span className="text-xs text-muted-foreground">
              日志按天存在 <code className="rounded bg-muted px-1">data/logs/</code>
              ；启动时清理超过该天数的旧文件。1~365 天，默认 30。
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t pt-4">
          <Button type="button" onClick={() => save.mutate()} disabled={save.isPending}>
            <Save />
            保存
          </Button>
          <SaveMsg msg={msg} />
        </div>
    </div>
  )
}

function AuthForm({ auth }: { auth: SettingsData['auth'] }) {
  const qc = useQueryClient()
  const [enabled, setEnabled] = useState(auth.enabled)
  const [username, setUsername] = useState(auth.username)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [msg, setMsg] = useState<Result | null>(null)

  const save = useMutation({
    mutationFn: () => api.post<Result>('/settings/auth', { enabled, username, currentPassword, newPassword }),
    onSuccess: (r) => {
      setMsg(r)
      if (r.ok) {
        setCurrentPassword('')
        setNewPassword('')
        void qc.invalidateQueries({ queryKey: ['settings'] })
      }
    },
    onError: (e) => setMsg({ ok: false, message: e instanceof Error ? e.message : '保存失败' }),
  })

  return (
    <div className="space-y-4">
        <h2 className="text-sm font-bold">账号安全</h2>

        <Label className="min-h-11 cursor-pointer md:min-h-0">
          <Checkbox checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span className="text-sm">启用账号认证（登录后访问）</span>
        </Label>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="auth-user">
              <FieldLabel className="mb-0">用户名</FieldLabel>
            </Label>
            <Input id="auth-user" value={username} placeholder="admin" onChange={(e) => setUsername(e.target.value)} />
          </div>

          {auth.enabled && (
            <div>
              <Label htmlFor="auth-current">
                <FieldLabel className="mb-0">当前密码</FieldLabel>
              </Label>
              <Input
                id="auth-current"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                placeholder="修改账号需验证"
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
              <div className="mt-1">
                <span className="text-xs text-muted-foreground">已启用状态下修改/停用需要验证当前密码</span>
              </div>
            </div>
          )}

          <div>
            <Label htmlFor="auth-new">
              <FieldLabel className="mb-0">{auth.enabled ? '新密码（留空=不改）' : '新密码'}</FieldLabel>
            </Label>
            <Input
              id="auth-new"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <div className="mt-1">
              <span className="text-xs text-muted-foreground">密码以 scrypt 哈希存储，不保存明文；启用时必填</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t pt-4">
          <Button type="button" onClick={() => save.mutate()} disabled={save.isPending}>
            <Save />
            保存账号设置
          </Button>
          <SaveMsg msg={msg} />
        </div>
    </div>
  )
}
