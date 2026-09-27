import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Eye, EyeOff, Plug, Save, Activity } from 'lucide-react'

import { DelayedLoading } from '@/components/loading'
import { FormMessage } from '@/components/form-message'
import { InfoTip } from '@/components/info-tip'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FieldLabel, Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

type ServerField = { k: string; label: string; ph?: string; password?: boolean; wide?: boolean; hint?: string }
type ServerSpec = {
  key: string
  label: string
  short: string
  apiKeyAuth: boolean
  fields: ServerField[]
  values: Record<string, string>
}
type ConnectData = {
  lx: { baseUrl: string; apiKey: string; username: string; downloadRoot: string }
  target: string
  servers: ServerSpec[]
}
type PathLine = { level: 'ok' | 'bad' | 'hint'; text: string; detail?: string }
type Result = { ok: boolean; message: string; level?: 'ok' | 'warn' | 'bad' }

export function ConnectPage() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['connect'],
    queryFn: () => api.get<ConnectData>('/connect'),
  })

  return (
    <div className="space-y-4">
      {/* 手机端不显示页面名：顶栏已经写着（见 app-shell），这块地方留给内容 */}
      <header className="max-md:hidden">
        <h1 className="text-lg font-bold tracking-tight">连接容器</h1>
      </header>

      {isLoading || !data ? (
        <DelayedLoading loading className="py-10 text-center text-sm text-muted-foreground" />
      ) : (
        <>
          <LxForm lx={data.lx} />
          <ServerSection servers={data.servers} target={data.target} onApplied={() => void refetch()} />
          <PathCheckSection />
        </>
      )}
    </div>
  )
}

function ResultMsg({ result }: { result: (Result & { level?: string }) | null }) {
  if (!result) return null
  const level = result.level ?? (result.ok ? 'ok' : 'bad')
  return <FormMessage ok={level !== 'bad'}>{result.message}</FormMessage>
}

/** 密码输入框 + 眼睛切换（不把明文塞进 DOM 属性，只切 type） */
function PasswordInput({
  value,
  onChange,
  id,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  id?: string
  placeholder?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="flex gap-2">
      <Input
        id={id}
        type={show ? 'text' : 'password'}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={show ? '隐藏' : '显示'}
        aria-pressed={show}
        onClick={() => setShow((s) => !s)}
      >
        {show ? <EyeOff /> : <Eye />}
      </Button>
    </div>
  )
}

function SectionTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h2 className={cn('text-sm font-bold text-emerald-700 dark:text-emerald-400', className)}>{children}</h2>
}

/* ── 一、LX 下载源 ─────────────────────────────── */
function LxForm({ lx }: { lx: ConnectData['lx'] }) {
  const [form, setForm] = useState(lx)
  const [saveMsg, setSaveMsg] = useState<Result | null>(null)
  const [testMsg, setTestMsg] = useState<Result | null>(null)

  const save = useMutation({
    mutationFn: () => api.post<Result>('/connect/lx', form),
    onSuccess: (r) => setSaveMsg(r),
    onError: (e) => setSaveMsg({ ok: false, message: e instanceof Error ? e.message : '保存失败' }),
  })
  const test = useMutation({
    mutationFn: () => api.post<Result>('/connect/test-lx', {}),
    onSuccess: (r) => setTestMsg(r),
    onError: (e) => setTestMsg({ ok: false, message: e instanceof Error ? e.message : '测试失败' }),
  })

  return (
    <div className="space-y-4">
        <SectionTitle>连接 LXSyncServer</SectionTitle>
        <div className="rounded-lg border bg-card p-3">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="lx-baseUrl">
                <FieldLabel className="mb-0">服务地址</FieldLabel>
              </Label>
              <Input
                id="lx-baseUrl"
                value={form.baseUrl}
                placeholder="http://127.0.0.1:19527"
                onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="lx-apiKey">
                <FieldLabel className="mb-0">API key</FieldLabel>
              </Label>
              <PasswordInput
                id="lx-apiKey"
                value={form.apiKey}
                onChange={(v) => setForm({ ...form, apiKey: v })}
              />
            </div>
            <div>
              <Label htmlFor="lx-username">
                <FieldLabel className="mb-0">下载用户名（x-user-name）</FieldLabel>
              </Label>
              <Input
                id="lx-username"
                value={form.username}
                placeholder="lxserver 里的下载用户名"
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="lx-downloadRoot">
                <FieldLabel className="mb-0 flex items-center gap-1.5">
                  LX 下载目录<span className="text-destructive">*</span>
                  <InfoTip>
                    <b>本项目（音乐仓鼠）视角</b>的路径，不是 lxserver 的。
                    <br />
                    指向「<b>歌单同步</b>」的<b>父目录</b> —— 代码会在它下面自己拼 <code>歌单同步/&lt;歌单名&gt;/</code>。
                    <br />
                    <br />
                    判定办法：这一层下面应该<b>同时</b>有 <code>歌单同步/</code> 和 <code>.songhamster-trash/</code>
                    （后者是本项目自己建的回收站）。
                    <br />
                    <br />
                    ⚠️ lxserver 若给用户设了「自定义音乐目录」，会多一层用户名目录，
                    要填到那一层（如 <code>/data/music/user1</code>）。
                  </InfoTip>
                </FieldLabel>
              </Label>
              <Input
                id="lx-downloadRoot"
                value={form.downloadRoot}
                placeholder="如 /data/music/user1（歌单同步 的父目录）"
                onChange={(e) => setForm({ ...form, downloadRoot: e.target.value })}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t pt-4">
          <Button type="button" onClick={() => save.mutate()} disabled={save.isPending}>
            <Save />
            保存配置
          </Button>
          <Button type="button" variant="outline" onClick={() => test.mutate()} disabled={test.isPending}>
            <Plug />
            测试连接
          </Button>
          <ResultMsg result={testMsg} />
          <ResultMsg result={saveMsg} />
        </div>
      </div>
  )
}

/* ── 二、媒体服务器（选项卡 + 确定三步链） ───────── */
function ServerSection({
  servers,
  target,
  onApplied,
}: {
  servers: ServerSpec[]
  target: string
  onApplied: () => void
}) {
  const [activeKey, setActiveKey] = useState(target)
  const active = servers.find((s) => s.key === activeKey) ?? servers[0]
  return (
    <div className="space-y-4">
        <SectionTitle className="flex items-center gap-1.5">
          连接媒体服务器
          <InfoTip>
            「确定」= 保存配置 → 测试连接 → 探测媒体库 → <b>全部通过才设为同步目标</b>
            （任一步不通过都不会切换，避免把同步指向一台连不上或库没匹配的服务器）。
          </InfoTip>
        </SectionTitle>

        {/* 选项卡：切换要配置的服务器（不是切换同步目标，得按「确定」） */}
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="媒体服务器类型">
          {servers.map((s) => (
            <Button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={s.key === activeKey}
              variant={s.key === activeKey ? 'default' : 'outline'}
              size="sm"
              className="max-md:h-10"
              onClick={() => setActiveKey(s.key)}
            >
              {s.short}
              {s.key === target && (
                <span className="size-1.5 rounded-full bg-emerald-500" aria-label="当前同步目标" />
              )}
            </Button>
          ))}
        </div>

        {/* 当前选项卡对应的表单 —— key 保证换服务器时重建，不残留上一台的输入 */}
        <ServerForm key={active.key} spec={active} isTarget={active.key === target} onApplied={onApplied} />
      </div>
  )
}

function ServerForm({
  spec,
  isTarget,
  onApplied,
}: {
  spec: ServerSpec
  isTarget: boolean
  onApplied: () => void
}) {
  const [values, setValues] = useState<Record<string, string>>(spec.values)
  const [result, setResult] = useState<Result | null>(null)

  const apply = useMutation({
    mutationFn: () => api.post<Result & { target: string }>('/connect/apply-json', { type: spec.key, ...values }),
    onSuccess: (r) => {
      setResult(r)
      if (r.ok) onApplied()
    },
    onError: (e) => setResult({ ok: false, level: 'bad', message: e instanceof Error ? e.message : '操作失败' }),
  })

  return (
    <div className="space-y-4">
      {isTarget && (
        <p className="text-xs text-muted-foreground">当前同步目标就是这台（绿点）</p>
      )}
      <div className="rounded-lg border bg-card p-3">
        <div className="grid gap-4 md:grid-cols-2">
          {spec.fields.map((f) => (
            <div key={f.k} className={cn(f.wide && 'md:col-span-2')}>
              <Label htmlFor={`srv-${spec.key}-${f.k}`}>
                <FieldLabel className="mb-0 flex items-center gap-1.5">
                  {f.label}
                  {f.hint && <InfoTip>{f.hint}</InfoTip>}
                </FieldLabel>
              </Label>
              {f.password ? (
                <PasswordInput
                  id={`srv-${spec.key}-${f.k}`}
                  value={values[f.k] ?? ''}
                  placeholder={f.ph}
                  onChange={(v) => setValues({ ...values, [f.k]: v })}
                />
              ) : (
                <Input
                  id={`srv-${spec.key}-${f.k}`}
                  value={values[f.k] ?? ''}
                  placeholder={f.ph}
                  onChange={(e) => setValues({ ...values, [f.k]: e.target.value })}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t pt-4">
        <Button type="button" onClick={() => apply.mutate()} disabled={apply.isPending}>
          <Plug />
          {apply.isPending ? '保存并测试中…' : '确定'}
        </Button>
        <ResultMsg result={result} />
      </div>
    </div>
  )
}

/* ── 三、路径自检 ──────────────────────────────── */
function PathCheckSection() {
  const [lines, setLines] = useState<PathLine[] | null>(null)
  const check = useMutation({
    mutationFn: () => api.post<{ lines: PathLine[] }>('/connect/paths-check', {}),
    onSuccess: (r) => setLines(r.lines),
    onError: (e) =>
      setLines([{ level: 'bad', text: e instanceof Error ? e.message : '自检失败' }]),
  })

  return (
    <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <SectionTitle className="flex flex-1 items-center gap-1.5">
            路径自检
            <InfoTip>检查下载目录可写、媒体库匹配情况，并给出路径关系提示</InfoTip>
          </SectionTitle>
          <Button type="button" variant="outline" onClick={() => check.mutate()} disabled={check.isPending}>
            <Activity />
            运行自检
          </Button>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <div className="min-h-10 space-y-1 text-sm">
            {/* 说明文字收进「i」之后这里就空了 —— 空盒子比一行提示更让人困惑，补个空状态 */}
            {lines === null ? (
              <p className="text-xs text-muted-foreground">还没跑过自检，点右侧「运行自检」</p>
            ) : (
              lines.map((l, i) => (
                <p
                  key={i}
                  className={cn(
                    l.level === 'ok' && 'text-emerald-700 dark:text-emerald-400',
                    l.level === 'bad' && 'text-destructive',
                    l.level === 'hint' && 'text-xs text-muted-foreground',
                  )}
                >
                  {l.level === 'ok' ? '✅ ' : l.level === 'bad' ? '❌ ' : ''}
                  {l.text}
                  {l.detail && <span className="block text-xs text-muted-foreground">{l.detail}</span>}
                </p>
              ))
            )}
          </div>
        </div>
      </div>
  )
}
