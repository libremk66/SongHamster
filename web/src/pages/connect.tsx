import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AlertTriangle, BookOpen, Check, CheckCircle2, ChevronDown, ChevronRight, Clapperboard, Eye, EyeOff, FolderSearch, FolderSync, Info, Music2, Plug, Save, Stethoscope, XCircle } from 'lucide-react'
import { Link } from 'react-router-dom'

import { DelayedLoading } from '@/components/loading'
import { FormMessage } from '@/components/form-message'
import { InfoTip } from '@/components/info-tip'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FieldLabel, Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
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
  /** 是否支持「读取媒体库」下拉（Subsonic 无媒体库概念 → 隐藏按钮） */
  canPickLibrary: boolean
}
type ConnectData = {
  lx: { baseUrl: string; apiKey: string; username: string; downloadRoot: string }
  target: string
  servers: ServerSpec[]
}
type Result = { ok: boolean; message: string; level?: 'ok' | 'warn' | 'bad' }
type LibraryItem = { id: string; name: string; locations: string[] }
type LibrariesResp = { ok: boolean; libraries?: LibraryItem[]; message?: string }
type CheckStatus = 'ok' | 'warn' | 'bad' | 'info'
type CheckItem = { status: CheckStatus; label: string; detail?: string; hint?: string }
type CheckResp = { ok: boolean; items: CheckItem[] }

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
        <p className="mt-0.5 text-xs text-muted-foreground">三步走：先连下载源，再连媒体服务器，最后去建同步任务</p>
      </header>

      {isLoading || !data ? (
        <DelayedLoading loading className="py-10 text-center text-sm text-muted-foreground" />
      ) : (
        <>
          <BackgroundStory />
          <Wizard data={data} onApplied={() => void refetch()} />
        </>
      )}
    </div>
  )
}

/**
 * 开篇指引：一张示意图讲清「两个路径为什么不一样」（2026-10-17 第六版）。
 *
 * 用户反馈：图下那两行「哪个路径填第几步」的说明删掉，改成**图上直接标色**——
 * 紫底 = 第 ① 步（LX 下载目录）要填的 /data/music/user1；
 * 蓝底 = 第 ② 步（媒体库根路径）要填的 /media/music/user1/歌单同步。
 * 两步的指引文案里用同色 PathChip 呼应，读者不用再自己对照文字。
 * 同时去掉「还没挂文件夹？先看路径映射指南」的 GitHub 链接（本页引导已足够）。
 */
function BackgroundStory() {
  return (
    <details open className="group rounded-lg border bg-card">
      <summary className="flex cursor-pointer select-none items-center gap-2 p-3 text-sm font-semibold">
        <BookOpen className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
        一张图看懂：两个路径为什么不一样
        <ChevronDown className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="space-y-3 border-t p-3">
        <FolderSketch />
        <p className="text-xs text-muted-foreground">
          图中<PathChip tone="violet">紫底</PathChip>是第 ① 步要填的路径，
          <PathChip tone="sky">蓝底</PathChip>是第 ② 步要填的路径（两步的指引里同色标出）。
        </p>
        <p className="text-xs text-muted-foreground">
          三个容器挂的是<b>同一个</b> <code>/volume2/music</code>，只是各自叫法不同；真正搬文件的是音乐仓鼠。图中是演示挂载，以你 compose 里的实际写法为准。
        </p>
        <div className="space-y-1 border-t pt-3 text-xs">
          <p className="font-semibold">三步走，前两步都有自动检查：</p>
          <ol className="space-y-1 text-muted-foreground">
            <li>① <b className="text-foreground">连 lxserver</b>：「配置体检」自动验 token、用户名目录、路径层级</li>
            <li>② <b className="text-foreground">连媒体服务器</b>：「读取媒体库」自动列库填路径；「确定」自动测连接、匹配库</li>
            <li>③ <b className="text-foreground">建同步任务</b>：去同步页选歌单开跑</li>
          </ol>
        </div>
      </div>
    </details>
  )
}

/**
 * 挂载示意图（2026-10-17 第六版：树状直角引线 + 按「第几步要填」标色）。
 *
 * 图里是**宿主机视角**的同一个文件夹（演示路径 /volume2/music/...），三张卡片分别说明：
 * - 「lxserver」：挂载 /volume2/music → /server/music，点在 music/，卡片在路径上方偏右；
 * - 「音乐仓鼠」：同样挂 /volume2/music → /data/music，点在 user1/，卡片在路径下方偏左；
 * - 「媒体库」（以 Emby 媒体库「LX同步」为例）：挂 /volume2/music → /media/music，点在 歌单同步/，卡片在路径下方偏右。
 * 三个容器挂的是同一个 /volume2/music，只是各自看到的名字不同。
 *
 * **配色即指引**：user1/ 与 /data/music/user1 用紫底（第 ① 步 LX 下载目录要填）；
 * 歌单同步/ 与 /media/music/user1/歌单同步 用蓝底（第 ② 步媒体库根路径要填）。
 * 两步的指引文案用同一个 PathChip 组件呼应，用户不必再对照图下文字。
 *
 * 连接线走「圆点 → 短竖 → 长横 → 短竖 → 卡片上/下边中点」的直角路径（见 Elbow）。
 * 关键是**引线接在卡片边中点**而不是角上 —— 卡片按引线居中，看起来才像「从这一点引出去」，
 * 而不是悬在拐角上。三张卡片的横向偏移量各自错开，避免互相压住。
 * 圆点锚在**路径分段自身**上（absolute + left-1/2），分段多宽，圆点就落在多宽的正中。
 * 窄屏横向滚动；四周留足内边距，避免卡片被滚动区裁掉。
 */
function FolderSketch() {
  return (
    <div className="overflow-x-auto pb-1">
      <div className="flex w-max flex-col px-40 pt-20 pb-28">
        <div className="flex items-center rounded-md border bg-card px-2 py-1.5 font-mono text-[11px]">
          <span className="text-muted-foreground">/volume2/</span>
          {/* 挂载根：三个容器挂的都是 /volume2/music */}
          <div className="relative flex flex-col items-center">
            <span className="rounded bg-amber-500/15 px-0.5 text-amber-700 dark:text-amber-300">music/</span>
            <Elbow dir="up" offset={130} dot="bg-emerald-500">
              <MountCard icon={Music2} title="lxserver" lines={['挂载 /volume2/music → /server/music']} />
            </Elbow>
          </div>
          {/* 音乐仓鼠：下载目录字段指 user1/ 这层（紫 = 第 ① 步要填） */}
          <div className="relative flex flex-col items-center">
            <span className="rounded bg-violet-500/15 px-0.5 text-violet-700 dark:text-violet-300">user1/</span>
            <Elbow dir="down" offset={-130} dot="bg-violet-500">
              <MountCard
                icon={FolderSync}
                title="音乐仓鼠"
                lines={[
                  '挂载 /volume2/music → /data/music',
                  <>
                    下载目录 <PathChip tone="violet">/data/music/user1</PathChip>
                  </>,
                ]}
              />
            </Elbow>
          </div>
          {/* Emby：媒体库根路径字段指 歌单同步/ 这层（蓝 = 第 ② 步要填） */}
          <div className="relative flex flex-col items-center">
            <span className="rounded bg-sky-500/15 px-0.5 text-sky-700 dark:text-sky-300">歌单同步/</span>
            <Elbow dir="down" offset={130} dot="bg-sky-500">
              <MountCard
                icon={Clapperboard}
                title="媒体库（以 Emby 媒体库「LX同步」为例）"
                lines={[
                  '挂载 /volume2/music → /media/music',
                  <>
                    库路径 <PathChip tone="sky">/media/music/user1/歌单同步</PathChip>
                  </>,
                ]}
              />
            </Elbow>
          </div>
          <span className="text-muted-foreground">我喜欢的/</span>
          <span className="text-muted-foreground">晴天.flac</span>
        </div>
      </div>
    </div>
  )
}

/**
 * 树状直角引线：圆点 → 12px 竖 → 横移到 offset → 12px 竖 → 卡片上/下边**中点**。
 * `offset` 是卡片中心相对圆点的横向位移（负值往左）。卡片用 -translate-x-1/2 居中到拐角，
 * 所以引线正好落在卡片边中点，不会像上一版那样扎在卡片的角上。
 */
function Elbow({
  dir,
  offset,
  dot,
  children,
}: {
  dir: 'up' | 'down'
  offset: number
  dot: string
  children: React.ReactNode
}) {
  const up = dir === 'up'
  return (
    <div className={cn('absolute left-1/2', up ? 'bottom-full' : 'top-full')}>
      {/* 圆点：压在路径分段中心 */}
      <span
        className={cn('absolute left-0 size-1.5 -translate-x-1/2 rounded-full', up ? 'bottom-0' : 'top-0', dot)}
        aria-hidden
      />
      {/* 第一段竖线（12px）：圆点 → 拐角 */}
      <span
        className={cn('absolute left-0 h-3 w-px -translate-x-1/2 bg-border', up ? 'bottom-0' : 'top-0')}
        aria-hidden
      />
      {/* 横线：从圆点正上方/正下方横移到卡片中心 */}
      <span
        className={cn('absolute h-px bg-border', up ? 'bottom-3' : 'top-3')}
        style={{ left: Math.min(0, offset), width: Math.abs(offset) }}
        aria-hidden
      />
      {/* 第二段竖线（12px）：拐角 → 卡片边中点 */}
      <span
        className={cn('absolute h-3 w-px -translate-x-1/2 bg-border', up ? 'bottom-3' : 'top-3')}
        style={{ left: offset }}
        aria-hidden
      />
      <div className={cn('absolute -translate-x-1/2', up ? 'bottom-6' : 'top-6')} style={{ left: offset }}>
        {children}
      </div>
    </div>
  )
}

/**
 * 路径高亮块：示意图与步骤指引共用的「该填哪个」配色 ——
 * 紫 = 第 ① 步（LX 下载目录）、蓝 = 第 ② 步（媒体库根路径），两处同色呼应。
 */
function PathChip({ tone, children }: { tone: 'violet' | 'sky'; children: React.ReactNode }) {
  return (
    <code
      className={cn(
        'rounded px-1 font-mono',
        tone === 'violet'
          ? 'bg-violet-500/15 text-violet-700 dark:text-violet-300'
          : 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
      )}
    >
      {children}
    </code>
  )
}

/** 示意图里的方框：图标 + 容器/媒体库名 + 挂载（或库路径）说明 */
function MountCard({ icon: Icon, title, lines }: { icon: typeof Music2; title: string; lines: React.ReactNode[] }) {
  return (
    <div className="flex items-center gap-2 whitespace-nowrap rounded-md border bg-card px-2 py-1.5 shadow-xs">
      <span className="flex size-7 shrink-0 items-center justify-center rounded bg-muted" aria-hidden>
        <Icon className="size-4" />
      </span>
      <span>
        <span className="block text-[11px] font-semibold leading-tight">{title}</span>
        {lines.map((l, i) => (
          <span key={i} className="block font-mono text-[10px] leading-tight text-muted-foreground">
            {l}
          </span>
        ))}
      </span>
    </div>
  )
}

/**
 * 三步连接向导（2026-10-17 三件套第 3 件）。
 * 渐进披露：折叠步骤卡，默认展开第一个未完成步骤；完成一步自动展开下一步。
 * 每步顶部一句话「去哪拿」指引；路径原理（两个路径差一层）以图解形式内联（见 PathHint）。
 */
function Wizard({ data, onApplied }: { data: ConnectData; onApplied: () => void }) {
  const lxDone = Boolean(data.lx.baseUrl && data.lx.apiKey && data.lx.downloadRoot)
  const targetSpec = data.servers.find((s) => s.key === data.target)
  const srvDone = Boolean(targetSpec && targetSpec.fields.every((f) => (targetSpec.values[f.k] ?? '') !== ''))
  const allDone = lxDone && srvDone

  // 0 = 全部收起；默认展开第一个未完成步骤（全完成时展开第 3 步摘要）
  const [open, setOpen] = useState<number>(() => (!lxDone ? 1 : !srvDone ? 2 : 3))
  const toggle = (n: number) => setOpen((cur) => (cur === n ? 0 : n))

  return (
    <div className="space-y-3">
      <StepCard
        step={1}
        title="连接 lxserver"
        guide={
          <>
            lxserver 指 XCQ0607/lxserver（LX Music 的下载服务端）。API key 在它后台「账户」里生成；下载目录填{' '}
            <PathChip tone="violet">/data/music/user1</PathChip> 这种（音乐仓鼠视角，歌单同步 的父目录）。填完点「配置体检」自动核对。
          </>
        }
        done={lxDone}
        open={open === 1}
        onToggle={() => toggle(1)}
        summary={lxDone ? `${data.lx.baseUrl} · 下载目录 ${data.lx.downloadRoot}` : '还没配置'}
      >
        <LxForm lx={data.lx} onApplied={onApplied} onSaved={() => setOpen(2)} />
      </StepCard>

      <StepCard
        step={2}
        title="连接媒体服务器"
        guide={
          <>
            API key / 账号密码在各服务器后台生成；填完地址和密钥点「📂 读取媒体库」，路径自动填（示例：
            <PathChip tone="sky">/media/music/user1/歌单同步</PathChip>
            ，服务器视角）。最后「确定」会自动测连接并匹配库。
          </>
        }
        done={srvDone}
        open={open === 2}
        onToggle={() => toggle(2)}
        summary={srvDone ? `${targetSpec!.label} · ${targetSpec!.values.libraryRoot || '已连接'}` : '还没配置'}
      >
        <ServerSection servers={data.servers} target={data.target} onApplied={onApplied} onSaved={() => setOpen(3)} />
      </StepCard>

      <StepCard
        step={3}
        title="完成 · 下一步"
        done={allDone}
        open={open === 3}
        onToggle={() => toggle(3)}
        summary={allDone ? '连接就绪，去创建第一个同步任务' : '完成前两步后看这里'}
      >
        <FinishPanel data={data} lxDone={lxDone} srvDone={srvDone} />
      </StepCard>
    </div>
  )
}

/** 折叠步骤卡：圆编号（完成变绿勾）+ 标题 + 收起时的摘要 + 展开时的指引与表单 */
function StepCard({
  step,
  title,
  guide,
  done,
  open,
  onToggle,
  summary,
  children,
}: {
  step: number
  title: string
  guide?: React.ReactNode
  done: boolean
  open: boolean
  onToggle: () => void
  summary?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('rounded-lg border bg-card', done && 'border-emerald-500/50')}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 p-3 text-left"
      >
        <span
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold',
            done ? 'bg-emerald-500 text-white' : 'bg-muted text-muted-foreground',
          )}
          aria-hidden
        >
          {done ? <Check className="size-4" /> : step}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{title}</span>
          {!open && summary && <span className="block truncate text-xs text-muted-foreground">{summary}</span>}
        </span>
        {open ? (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
      </button>
      {open && (
        <div className="space-y-4 border-t p-3">
          {guide && <p className="text-xs text-muted-foreground">💡 {guide}</p>}
          {children}
        </div>
      )}
    </div>
  )
}

/** 第 3 步：完成摘要 + 下一步入口 */
function FinishPanel({ data, lxDone, srvDone }: { data: ConnectData; lxDone: boolean; srvDone: boolean }) {
  if (!lxDone || !srvDone) {
    return (
      <p className="text-sm text-muted-foreground">
        {!lxDone
          ? '先完成第 ① 步（连接 lxserver）—— 上面的步骤卡点开就能填。'
          : 'lxserver 已连好 👍 再完成第 ② 步（连接媒体服务器），连接就绪后这里会出现下一步入口。'}
      </p>
    )
  }
  const targetSpec = data.servers.find((s) => s.key === data.target)!
  return (
    <div className="space-y-3">
      <ul className="space-y-1.5 text-sm">
        <li className="flex gap-2">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" aria-hidden />
          <span>
            lxserver：<span className="text-muted-foreground">{data.lx.baseUrl}</span>
            ，下载目录 <code className="text-xs">{data.lx.downloadRoot}</code>
          </span>
        </li>
        <li className="flex gap-2">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" aria-hidden />
          <span>
            媒体服务器：{targetSpec.label}
            {targetSpec.values.libraryRoot && (
              <>
                ，媒体库根 <code className="text-xs">{targetSpec.values.libraryRoot}</code>
              </>
            )}
          </span>
        </li>
      </ul>
      <div className="flex flex-wrap items-center gap-3 border-t pt-3">
        <Button asChild>
          <Link to="/sync-setup">去创建歌单同步任务 →</Link>
        </Button>
        <p className="text-xs text-muted-foreground">连接配置随时可回上面两步修改（改完重新体检一次更稳）。</p>
      </div>
    </div>
  )
}

function ResultMsg({ result }: { result: (Result & { level?: string }) | null }) {
  if (!result) return null
  const level = result.level ?? (result.ok ? 'ok' : 'bad')
  return <FormMessage ok={level !== 'bad'}>{result.message}</FormMessage>
}

/** 体检结果分级图标（ok=绿勾 / warn=黄叹 / bad=红叉 / info=灰圈） */
const CHECK_ICON: Record<CheckStatus, typeof CheckCircle2> = {
  ok: CheckCircle2,
  warn: AlertTriangle,
  bad: XCircle,
  info: Info,
}
const CHECK_COLOR: Record<CheckStatus, string> = {
  ok: 'text-emerald-500',
  warn: 'text-amber-500',
  bad: 'text-destructive',
  info: 'text-muted-foreground',
}

/**
 * 配置体检结果清单（2026-10-17 三件套第 2 件）。
 * 分级渲染：每条 = 图标 + 结论；有 detail/hint 时折叠在下面（小字）。
 * 整块包 aria-live：屏幕阅读器能听到体检完成后的结论更新。
 */
function CheckList({ items }: { items: CheckItem[] }) {
  if (!items.length) return null
  return (
    <ul aria-live="polite" className="space-y-2 rounded-lg border bg-card p-3">
      {items.map((it, i) => {
        const Icon = CHECK_ICON[it.status] ?? Info
        return (
          <li key={i} className="flex gap-2 text-sm">
            <Icon className={cn('mt-0.5 size-4 shrink-0', CHECK_COLOR[it.status] ?? '')} aria-hidden />
            <div className="min-w-0 space-y-0.5">
              <p className="break-words">{it.label}</p>
              {it.detail && <p className="break-words text-xs text-muted-foreground">{it.detail}</p>}
              {it.hint && <p className="break-words text-xs text-muted-foreground">💡 {it.hint}</p>}
            </div>
          </li>
        )
      })}
    </ul>
  )
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

/* ── 一、lxserver ─────────────────────────────── */
function LxForm({ lx, onApplied, onSaved }: { lx: ConnectData['lx']; onApplied?: () => void; onSaved?: () => void }) {
  const [form, setForm] = useState(lx)
  const [saveMsg, setSaveMsg] = useState<Result | null>(null)
  /** 配置体检结果（用表单当前值探测，未保存也能跑） */
  const [checkItems, setCheckItems] = useState<CheckItem[] | null>(null)

  const save = useMutation({
    mutationFn: () => api.post<Result>('/connect/lx', form),
    onSuccess: (r) => {
      setSaveMsg(r)
      // 保存成功 → 刷新父级数据（步骤完成态）并前进到下一步
      if (r.ok) {
        onApplied?.()
        onSaved?.()
      }
    },
    onError: (e) => setSaveMsg({ ok: false, message: e instanceof Error ? e.message : '保存失败' }),
  })
  const check = useMutation({
    mutationFn: () => api.post<CheckResp>('/connect/lx-check', form),
    onSuccess: (r) => setCheckItems(r.items ?? []),
    onError: (e) =>
      setCheckItems([{ status: 'bad', label: e instanceof Error ? e.message : '体检失败' }]),
  })

  return (
    <div className="space-y-4">
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
          <Button type="button" variant="outline" onClick={() => check.mutate()} disabled={check.isPending}>
            <Stethoscope />
            {check.isPending ? '体检中…' : '配置体检'}
          </Button>
          <ResultMsg result={saveMsg} />
        </div>
        {checkItems && <CheckList items={checkItems} />}
      </div>
  )
}

/* ── 二、媒体服务器（选项卡 + 确定三步链） ───────── */
function ServerSection({
  servers,
  target,
  onApplied,
  onSaved,
}: {
  servers: ServerSpec[]
  target: string
  onApplied: () => void
  onSaved?: () => void
}) {
  const [activeKey, setActiveKey] = useState(target)
  const active = servers.find((s) => s.key === activeKey) ?? servers[0]
  return (
    <div className="space-y-4">
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
        <ServerForm key={active.key} spec={active} onApplied={onApplied} onSaved={onSaved} />
      </div>
  )
}

function ServerForm({
  spec,
  onApplied,
  onSaved,
}: {
  spec: ServerSpec
  onApplied: () => void
  onSaved?: () => void
}) {
  const [values, setValues] = useState<Record<string, string>>(spec.values)
  const [result, setResult] = useState<Result | null>(null)
  /** 读取媒体库的结果（下拉列表 / 空态 / 错误） */
  const [libs, setLibs] = useState<LibraryItem[] | null>(null)
  const [libMsg, setLibMsg] = useState<string | null>(null)

  const apply = useMutation({
    mutationFn: () => api.post<Result & { target: string }>('/connect/apply-json', { type: spec.key, ...values }),
    onSuccess: (r) => {
      setResult(r)
      if (r.ok) {
        onApplied()
        onSaved?.()
      }
    },
    onError: (e) => setResult({ ok: false, level: 'bad', message: e instanceof Error ? e.message : '操作失败' }),
  })

  /**
   * 读取媒体库（「读取媒体库」按钮）—— 用**表单当前值**探测（后端走临时配置，不落盘）。
   * 拿到列表后：含「歌单同步」的库自动填入并标 ✦（推荐），否则提示手选。
   */
  const pick = useMutation({
    mutationFn: () =>
      api.post<LibrariesResp>('/connect/libraries', {
        type: spec.key,
        baseUrl: values.baseUrl,
        apiKey: values.apiKey,
        username: values.username,
        password: values.password,
        libraryRoot: values.libraryRoot,
      }),
    onSuccess: (r) => {
      if (!r.ok) {
        setLibs(null)
        setLibMsg(r.message ?? '读取失败')
        return
      }
      const list = (r.libraries ?? []).filter((l) => l.locations.length > 0)
      if (list.length === 0) {
        setLibs(null)
        setLibMsg(
          `${spec.label} 上还没找到带路径的音乐库——请先在 ${spec.label} 后台添加音乐媒体库（文件夹指向「歌单同步」层）再回来；也可直接手填下方路径`,
        )
        return
      }
      setLibMsg(null)
      setLibs(list)
      // 含「歌单同步」的库 → 自动填入（用户仍可在下拉里改）
      const recommended = list.find((l) => l.locations.some((loc) => loc.includes('歌单同步')))
      if (recommended) setValues((v) => ({ ...v, libraryRoot: recommended.locations[0] }))
    },
    onError: (e) => {
      setLibs(null)
      setLibMsg(e instanceof Error ? e.message : '读取失败')
    },
  })

  return (
    <div className="space-y-4">
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

              {/* 媒体库根路径行：附「读取媒体库」按钮 + 下拉选择（2026-10-16 方案 A） */}
              {f.k === 'libraryRoot' && spec.canPickLibrary && (
                <div className="mt-2 space-y-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="max-md:h-10"
                    onClick={() => pick.mutate()}
                    disabled={pick.isPending || !values.baseUrl}
                    title={!values.baseUrl ? '请先填服务器地址' : '按当前填写的地址与密钥读取媒体库列表'}
                  >
                    <FolderSearch />
                    {pick.isPending ? '读取中…' : '读取媒体库'}
                  </Button>
                  {libMsg && <FormMessage ok={false}>{libMsg}</FormMessage>}
                  {libs && (
                    <Select
                      aria-label="选择媒体库"
                      value={values.libraryRoot ?? ''}
                      onChange={(e) => setValues({ ...values, libraryRoot: e.target.value })}
                    >
                      <option value="">— 选择媒体库（自动填入路径）—</option>
                      {libs.map((l) => {
                        const rec = l.locations.some((loc) => loc.includes('歌单同步'))
                        return (
                          <option key={l.id} value={l.locations[0]}>
                            {rec ? '✦ ' : ''}
                            {l.name}（{l.locations[0]}）
                          </option>
                        )
                      })}
                    </Select>
                  )}
                  {libs && (
                    <p className="text-xs text-muted-foreground">
                      点选即自动填入路径（仍可手动改）。带 ✦ 的库名含「歌单同步」，是推荐项。
                    </p>
                  )}
                </div>
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

