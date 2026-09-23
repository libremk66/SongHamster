import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MoreVertical, Music, Pause, Pencil, Play, RefreshCw, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ChartCoverBg, platformOf, sourceOfKey } from '@/components/chart-cover'
import { Cover } from '@/components/cover'
import { DeletePanel, useTaskActions, fmtTime, type TaskRow } from '@/pages/sync-setup'
import { TaskEditDialog } from '@/components/task-edit-dialog'
import { cn } from '@/lib/utils'

/**
 * 任务卡片（参考 MoviePilot 的订阅卡片）。
 *
 * 设计要点 —— **信息极简**：
 *   图占满上半部分，文字叠在渐变遮罩上，全卡只有 4 条信息：
 *     ① 小字：模式 · 定时      ② 大字：歌单名
 *     ③ 底部左：进度           ④ 底部右：状态 · 上次跑完时间
 *   操作全部收进右上角 ⋮ 菜单 —— 卡片上不摆一排按钮。
 */

export const MODE_LABEL: Record<string, string> = { mirror: '镜像', incremental: '增量' }

/** 上次执行结果的灯：绿=成功、黄=部分成功、红=失败、灰=被中断/未运行 */
const RESULT_LIGHT: Record<string, string> = {
  success: 'bg-emerald-500',
  partial: 'bg-amber-500',
  failed: 'bg-red-500',
  interrupted: 'bg-muted-foreground/40',
}
const RESULT_TEXT: Record<string, string> = {
  success: '成功',
  partial: '部分成功',
  failed: '失败',
  interrupted: '被中断',
}

/** 卡片左上角那个方块的共用尺寸（歌单卡放封面，榜单卡放平台+榜单名） */
const SQUARE = 'grid aspect-square h-full max-h-[4.5rem] shrink-0 self-center place-items-center overflow-hidden rounded-lg border border-border'

/**
 * 手机紧凑行里的方块：**定死 56px**。
 * 不能复用上面那个 `h-full` —— 海报卡的框高是 16:10 撑出来的确定值，紧凑行里没有，
 * `h-full` 会塌成内容高度（图标 24px 的方块）。
 */
const SQUARE_M = 'grid size-14 shrink-0 place-items-center overflow-hidden rounded-lg border border-border'

/**
 * 榜单卡的方块：平台名 + 榜单名，两行。
 *
 * 为什么不放封面图：榜单不是一个"作品"，没有封面 —— 原来的做法是本地生成一张 16:10 的
 * 模板图铺满整卡，现在改成和歌单卡一个骨架，就把榜单的「身份」压进这个方块里。
 * 底色取平台色（QQ 绿、网易云红…），这样一眼能分辨平台，也补上了没有封面图缺的那点颜色。
 */
function ChartSquare({ task, compact }: { task: TaskCardRow; compact?: boolean }) {
  const p = platformOf(sourceOfKey(task.lxPlaylistKey))
  return (
    <div
      /*
        底色：平台色从左上往右下淡出，比卡片背景那层重得多（0.55 → 0.14），
        让方块是块"有颜色的砖"，而不是浮在背景上的一层纱。
      */
      className={cn(compact ? SQUARE_M : SQUARE, 'content-center gap-1 px-1.5 text-center')}
      style={{ background: `linear-gradient(140deg, ${p.color}8c 0%, ${p.color}24 62%, ${p.color}0a 100%)` }}
      title={task.lxPlaylistName}
    >
      {/*
        平台色直接当文字色在浅色主题下会看不清（QQ 绿 #31C27C 压在浅绿底上对比度只有 ~1.9:1）。
        往 --foreground 里混 20%：浅色主题下前景是近黑 → 变成深绿；深色主题下前景是近白 → 变成亮绿。
        一个表达式同时满足两套主题。
      */}
      <span
        className={cn('leading-none font-medium', compact ? 'text-[10px]' : 'text-xs')}
        style={{ color: `color-mix(in oklab, ${p.color} 80%, var(--foreground))` }}
      >
        {p.short}
      </span>
      {/*
        72px 方块里 14px 放得下 4 个字（新歌榜/热歌榜），5 个字自动折两行。
        ⚠️ 手机紧凑行的方块只有 56px（去掉 px-1.5 只剩 44px），14px 的「新歌榜」正好放不下，
        会折成「新歌 / 榜」两行 —— 所以 compact 时降到 12px（3 个字 36px，稳）。
      */}
      <span className={cn('line-clamp-2 font-bold leading-tight', compact ? 'text-xs' : 'text-sm')}>
        {task.chartName || task.lxPlaylistName}
      </span>
    </div>
  )
}

/**
 * 方块右侧的属性：两行、四个关键词。两种卡片共用一套（榜单/歌单在这块上信息完全一样）。
 * ⚠️ pr-4 是给右上角 ⋮ 让位，别去掉 —— 去掉后第一行会被按钮压住。
 */
function CardAttrs({
  task,
  running,
  live,
  lb,
}: {
  task: TaskCardRow
  running: boolean
  live: { done: number; total: number } | null
  lb: TaskCardRow['lastBatch']
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5 pr-4 text-xs">
      {/* 第一行：启用灯 · 镜像/增量 · 手动/定时 */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="inline-flex items-center gap-1.5">
          <i className={cn('size-2 shrink-0 rounded-full', task.enabled ? 'bg-emerald-500' : 'bg-muted-foreground/40')} aria-hidden />
          {task.enabled ? '启用' : '停用'}
        </span>
        <span className="text-muted-foreground">{MODE_LABEL[task.mode ?? 'incremental']}</span>
        <span className="text-muted-foreground">{task.cronExpr ? '定时' : '手动'}</span>
      </div>

      {/* 第二行：结果灯 · 上次结果 · 时间 */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {running && live ? (
          <>
            <RefreshCw className="size-3 shrink-0 animate-spin text-primary" aria-hidden />
            <span className="text-muted-foreground">
              同步中 {live.done}/{live.total}
            </span>
          </>
        ) : (
          <>
            <i className={cn('size-2 shrink-0 rounded-full', RESULT_LIGHT[lb?.result ?? ''] ?? 'bg-muted-foreground/40')} aria-hidden />
            <span>{lb ? (RESULT_TEXT[lb.result ?? ''] ?? '已运行') : '未运行'}</span>
            {lb && <span className="truncate text-muted-foreground">{fmtTime(lb.startedAt)}</span>}
          </>
        )}
      </div>
    </div>
  )
}

/** 榜单卡底部那一行：取几首 + 同步到哪儿 */
function chartRangeText(task: TaskCardRow): string {
  const range = task.maxCount && task.maxCount > 0 ? `前 ${task.maxCount} 首` : '全榜'
  const to = task.targetNames.length
    ? `→《${task.targetNames.join('》《')}》`
    : task.createSameNamePlaylist
      ? '同名歌单'
      : '未设目标歌单'
  return `${range} · ${to}`
}

export type TaskCardRow = TaskRow & {
  maxCount?: number | null
  /** 榜单专有：平台代码 + 榜单原名（卡片方块里分两行显示，不拆任务名） */
  chartSource?: string | null
  chartName?: string | null
  coverKeys?: string[]
  /** 编辑弹框回填用（卡片本身不显示） */
  archivePlaylist?: string
  playlistScope?: string
  playlistScopeName?: string
}

export function TaskCard({
  task,
  live,
  targetKey,
  scopeUI,
  fileDeleteOK,
  isChart,
  onMsg,
  deleting,
  setDeleting,
}: {
  task: TaskCardRow
  live: { taskId: number; taskName: string; phase: string; done: number; total: number } | null
  targetKey: string
  scopeUI: boolean
  fileDeleteOK: boolean
  isChart?: boolean
  onMsg: (r: { ok: boolean; message: string }) => void
  deleting: number | null
  setDeleting: (id: number | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const act = useTaskActions(task, onMsg)
  const running = live?.taskId === task.id
  const covers = task.coverKeys ?? []
  const lb = task.lastBatch

  return (
    /*
      `isolate`：建一个层叠上下文，好让下面那层背景用 -z-10 老老实实待在内容后面。
      没有它的话 z-index 会跑到卡片外面去跟整页的元素比大小。
    */
    <div className="relative isolate overflow-hidden rounded-lg border border-border bg-card transition duration-300 hover:z-10 hover:scale-105 hover:shadow-lg motion-reduce:transition-none motion-reduce:hover:scale-100">
      {/*
        卡片背景：拿歌单封面自己放大模糊铺一层（音乐类封面的经典做法 —— 颜色是从封面里来的，
        所以每张卡片的花色都不一样，而且和封面对得上），再压一层主题色渐变把文字衬出来。
        ⚠️ 封面那层要 scale-150：blur 会把图像边缘糊出去，不放大就会露出四条透明边。
        没封面时只剩渐变，也不至于是一块死黑。
      */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden>
        {isChart ? (
          /*
            榜单卡用它自己那张模板图的**背景部分**（弧线 + 平台色渐变），保持锐利、不模糊。
            ⚠️ 不能用带文字的整张图：图里那行「新歌榜」大字会正好落在卡片中间，
               和方块、属性行、底部那行全撞上（实测过）。名字在方块里已经有了。
          */
          <ChartCoverBg source={sourceOfKey(task.lxPlaylistKey)} />
        ) : (
          covers[0] && (
            <img
              src={`/api/cover/${encodeURIComponent(covers[0])}?size=320`}
              alt=""
              loading="lazy"
              decoding="async"
              className="size-full scale-150 object-cover opacity-70 blur-xl"
            />
          )
        )}
          {/*
            压一层渐变保证正文对比度：左上角（挨着缩略图那侧）留得多，右下角
            （歌单名的位置）几乎压满。纯 card 色 100% 会在边角形成一圈死黑，所以用 /95 收尾。
          */}
        <div
          className={cn(
            'absolute inset-0 bg-gradient-to-br',
            'from-card/35 via-card/65 to-card/95',
          )}
        />
      </div>

      {/*
        配图分两套：
        - **榜单**用模板生成的图（它只有一个身份，图里就写着榜单名）→ 整块铺满，文字叠上去
        - **歌单**是一堆歌 → 左上角一张方形封面（取第一首歌的封面），右侧排属性，名字放图下方
        ⚠️ 歌单封面不是 lxserver 给的 —— 自建歌单在 LX 里根本没有封面字段
           （`{id,name,locationUpdateTime,list}`），它的播放器也是回落到一张通用 logo。
           这里取歌单里第一首歌的封面，走仓鼠自己的 /api/cover 代理。
      */}
      {/*
        手机：**一行一张的紧凑行**，约 84px 高 —— 一屏能扫 8 张。
        ⚠️ 原来手机也用双列海报卡，390px 的屏上每张只有 180px 宽，封面 72 + 给 ⋮ 让位的
           pr-4 一扣，属性列只剩 56px：「启用 · 镜像 · 手动」折成三行、歌单名被截、
           ⋮（手机 40px）还压着字（实测）。窄屏要的是"扫一眼有哪些订阅"，不是海报，
           所以这里换成行式排版，md 起才回到海报卡。`pr-12` 给右上角那个绝对定位的 ⋮ 让位。
      */}
      <div className="flex items-center gap-3 p-3 pr-12 md:hidden">
        {isChart ? (
          <ChartSquare task={task} compact />
        ) : (
          <div className={cn(SQUARE_M, 'bg-muted')}>
            {covers[0] ? (
              <Cover songKey={covers[0]} fill />
            ) : (
              <Music className="size-6 text-muted-foreground" aria-hidden />
            )}
          </div>
        )}
        <div className="min-w-0 flex-1">
          {/* 榜单卡和歌单卡在这一行同名同姓：都是任务名（`QQ·新歌榜` / `我喜欢的`） */}
          <h3 className="line-clamp-2 text-sm font-medium leading-tight" title={task.lxPlaylistName}>
            {task.lxPlaylistName}
          </h3>
          <CardAttrs task={task} running={running} live={live} lb={lb} />
          {/* 范围 + 去向（榜单卡独有，歌单卡没有这一行） */}
          {isChart && (
            <p className="truncate text-xs text-muted-foreground" title={task.lxPlaylistName}>
              {chartRangeText(task)}
            </p>
          )}
        </div>
      </div>

      {isChart ? (
        /* 和歌单卡同一个 16:10 框、同一套骨架：左上角一个方块 + 右侧属性 + 底部一行。
           区别只在于方块里放什么 —— 歌单放封面，榜单放「平台 / 榜单名」（榜单没有封面图）。 */
        <div className="hidden aspect-[16/10] flex-col gap-2 p-3 md:flex">
          <div className="flex min-h-0 flex-1 gap-3">
            <ChartSquare task={task} />
            <CardAttrs task={task} running={running} live={live} lb={lb} />
          </div>
          {/* 底部：范围 + 去向（榜单卡独有的两条，歌单卡的底部是歌单名） */}
          <p className="shrink-0 truncate text-xs text-muted-foreground" title={task.lxPlaylistName}>
            {chartRangeText(task)}
          </p>
        </div>
      ) : (
        /*
          ⚠️ 这个 `aspect-[16/10]` 是**和榜单卡片对齐**用的 —— 榜单卡的高度就是它那张
          16:10 的模板图撑出来的。两种卡片外形一致，混在一屏里才不会一高一矮。
          内容全部塞进这个固定框里，所以下面每一层都要能压缩（min-h-0），
          歌单名那一行反过来要 shrink-0，不能把框顶破。
        */
        <div className="hidden aspect-[16/10] flex-col gap-2 p-3 md:flex">
          {/* 左上角：圆角正方形封面 + 右侧属性 */}
          <div className="flex min-h-0 flex-1 gap-3">
            {/*
              封面跟着框高走（仍是正方形），但要封顶 —— 不封顶它会占满整个上半区（~90px），
              把右边的属性列挤到 「手动」折行。72px 时属性列还剩 126px，两行都放得下。
            */}
            <div className={cn(SQUARE, 'bg-muted')}>
              {covers[0] ? (
                <Cover songKey={covers[0]} fill />
              ) : (
                <Music className="size-6 text-muted-foreground" aria-hidden />
              )}
            </div>

            <CardAttrs task={task} running={running} live={live} lb={lb} />
          </div>

          {/* 封面下方：歌单名，最多两行（shrink-0：宁可挤上方，也不能把 16:10 的框顶破） */}
          <h3 className="line-clamp-2 shrink-0 text-sm font-medium leading-tight" title={task.lxPlaylistName}>
            {task.lxPlaylistName}
          </h3>
        </div>
      )}

      {/* 操作收进 ⋮ 菜单：两种卡片共用，钉在右上角 */}
      <CardMenu
        isChart={isChart}
        pending={act.pending}
        enabled={task.enabled}
        onRun={act.run}
        onToggle={act.toggle}
        onEdit={() => setEditing(true)}
        onDelete={() => setDeleting(task.id)}
      />

      {/* 底部进度条：跑着时才有（对应参照卡那条绿条） */}
      {running && (
        <div className="h-1 w-full bg-black/30">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${live!.total > 0 ? Math.min(100, Math.round((live!.done / live!.total) * 100)) : 0}%` }}
          />
        </div>
      )}

      {deleting === task.id && (
        <div className="p-3">
          <DeletePanel task={task} onMsg={onMsg} onClose={() => setDeleting(null)} />
        </div>
      )}

      {editing && (
        <TaskEditDialog
          task={task}
          targetKey={targetKey}
          scopeUI={scopeUI}
          fileDeleteOK={fileDeleteOK}
          onClose={() => setEditing(false)}
          onSaved={onMsg}
        />
      )}
    </div>
  )
}

const MENU_GAP = 4 // ⋮ 按钮底边与菜单之间的间距
const EDGE = 8 // 菜单离视口边缘至少留这么多

/**
 * 卡片右上角的 ⋮ 菜单（同步 / 编辑 / 启用停用 / 删除）。
 *
 * ⚠️ 菜单必须 **portal 到 body + position:fixed**，不能就地 `absolute`，两个原因：
 *  ① 卡片上有 `overflow-hidden`（用来把模糊封面裁进圆角里），而菜单从按钮往下伸约 170px，
 *     卡片却只有 16:10 那么高 —— 实测**手机双列时卡片才 118px，菜单底部被裁掉 62px**，
 *     「删除」整项既看不见也点不到（桌面 285px 宽的卡片也只多出 2px，纯属侥幸）。
 *  ② 卡片悬停时有 `scale-105`，就地渲染的菜单会跟着一起放大 —— 菜单是 `w-32`(128px)，
 *     实测量出来 134.4px，圆角和字号也都糊了。
 * portal 出去，祖先的 overflow 和 transform 都够不着它。
 *
 * 定位和 InfoTip 同一套：右对齐到按钮、夹进视口；下面放不下就翻到按钮上方。
 * （卡片在页面底部时最容易撞上这条，栅格最后一行的菜单往下弹就会被视口切掉。）
 */
function CardMenu({
  isChart,
  pending,
  enabled,
  onRun,
  onToggle,
  onEdit,
  onDelete,
}: {
  /** 榜单卡的底色是模板图（偏深），⋮ 要换成白色系才看得见 */
  isChart?: boolean
  pending: boolean
  enabled: boolean
  onRun: () => void
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  /** null = 还没量过尺寸；量完前先画在屏幕外，免得用户看到它跳位置 */
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  const place = useCallback(() => {
    const w = wrap.current
    const p = panel.current
    if (!w || !p) return
    const r = w.getBoundingClientRect()
    const pw = p.offsetWidth
    const ph = p.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    // 菜单挂在卡片右上角，所以**右对齐**到按钮，再夹进视口
    const left = Math.min(Math.max(r.right - pw, EDGE), Math.max(EDGE, vw - pw - EDGE))
    const below = r.bottom + MENU_GAP
    const top = below + ph + EDGE > vh ? Math.max(EDGE, r.top - ph - MENU_GAP) : below
    setPos({ left, top })
  }, [])

  // useLayoutEffect：绘制前算完，不闪
  useLayoutEffect(() => {
    if (open) place()
  }, [open, place])

  // 开着的时候跟着滚动/改窗口走，不然菜单会留在原地
  useEffect(() => {
    if (!open) return
    const onMove = () => place()
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // 捕获阶段拦下并掐断（同 InfoTip）：Esc 只该关最上面那层
      e.stopPropagation()
      setOpen(false)
      wrap.current?.querySelector('button')?.focus()
    }
    /*
      点菜单外面关掉它。
      ⚠️ 不用 `fixed inset-0` 的透明遮罩：卡片悬停时有 `scale-105`，
      而 scale/transform/filter 会让元素成为 position:fixed 的**包含块** ——
      遮罩会被缩进卡片里，点卡片外面就关不掉菜单了。
      直接监听 document，不受任何祖先变换影响。
      ⚠️ 判断要**同时**看按钮和菜单：菜单 portal 在 body 下，只查按钮的话，
      点菜单本身会被当成"点了外面"→ 菜单在 onClick 之前就被关掉。
    */
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!wrap.current?.contains(t) && !panel.current?.contains(t)) setOpen(false)
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open])

  /** 点完就收菜单，再干正事（原来每项各写一遍，抽出来免得漏） */
  const run = (fn: () => void) => () => {
    setOpen(false)
    fn()
  }

  return (
    <div ref={wrap} className="absolute right-1.5 top-1.5 z-10">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="任务操作"
        aria-expanded={open}
        className={cn(
          'size-6 max-md:size-10',
          isChart && 'text-white hover:bg-white/20 hover:text-white',
        )}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreVertical className="size-3.5" />
      </Button>
      {open &&
        createPortal(
          <div
            ref={panel}
            style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999, visibility: 'hidden' }}
            className="fixed z-50 w-32 overflow-hidden rounded-md border bg-popover py-1 text-popover-foreground shadow-lg"
          >
            <MenuItem icon={Play} label="同步" disabled={pending} onClick={run(onRun)} />
            <MenuItem icon={Pencil} label="编辑" onClick={run(onEdit)} />
            <MenuItem
              icon={enabled ? Pause : Play}
              label={enabled ? '停用' : '启用'}
              disabled={pending}
              onClick={run(onToggle)}
            />
            <MenuItem icon={Trash2} label="删除" danger onClick={run(onDelete)} />
          </div>,
          document.body,
        )}
    </div>
  )
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger,
  disabled,
}: {
  icon: typeof Play
  label: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent disabled:opacity-40',
        danger && 'text-destructive',
      )}
      onClick={onClick}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  )
}

export function TaskCards({
  tasks,
  live,
  targetKey,
  scopeUI,
  fileDeleteOK,
  isChart,
  onMsg,
  deleting,
  setDeleting,
}: {
  tasks: TaskCardRow[]
  live: { taskId: number; taskName: string; phase: string; done: number; total: number } | null
  targetKey: string
  scopeUI: boolean
  fileDeleteOK: boolean
  isChart?: boolean
  onMsg: (r: { ok: boolean; message: string }) => void
  deleting: number | null
  setDeleting: (id: number | null) => void
}) {
  return (
    /*
      栅格抄 MoviePilot 的 `.grid-subscribe-card`：
        grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));  gap: 1rem

      和两种"错解"的区别：
      - 固定列数（我们最早写的 sm:3/md:4/lg:5/xl:6）：列宽 = 容器 ÷ 列数，
        卡片会随窗口连续变大变小；配图又是 viewBox 矢量图，里面的字等比放大，
        整张卡片看起来像在缩放（实测 1280→1920 时 157px → 263px）。
      - 固定列宽（repeat(auto-fill, 16.5rem)）：卡片不变了，但排不满，
        1280 那种宽度右边会空出近 200px。
      MP 这版是**下限 + 填满**：列数随容器算，每列在 [15rem, ~20rem] 之间浮动，
      行尾永远不留空档。尺寸仍在变，但只在窄带内变，不会翻倍。
      ⚠️ auto-fill 不用 auto-fit：auto-fit 会收掉空轨道、把剩下的卡片拉宽，又变回缩放。

      断点放在 lg 而不是 md：md(768) 起侧栏就出现了，内容区只剩 480px，
      15rem 的下限在那儿只排得下 1 列 → 一张 480px 宽的巨卡。

      手机（< md）强制**单列**：卡片在那儿是紧凑行（见 TaskCard 的手机分支），
      两列会把每张压到 180px —— 正好是修掉的那个排版错乱。
    */
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2 md:gap-4 lg:[grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]">
      {tasks.map((t) => (
        <TaskCard
          key={t.id}
          task={t}
          live={live}
          targetKey={targetKey}
          scopeUI={scopeUI}
          fileDeleteOK={fileDeleteOK}
          isChart={isChart}
          onMsg={onMsg}
          deleting={deleting}
          setDeleting={setDeleting}
        />
      ))}
    </div>
  )
}
