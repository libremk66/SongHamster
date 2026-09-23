import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Info } from 'lucide-react'

import { cn } from '@/lib/utils'

const GAP = 6 // 图标与气泡之间的间距
const EDGE = 8 // 气泡离视口边缘至少留这么多

/**
 * 「i」小图标 + 点开的小提示框 —— 用来收纳界面上的说明性文字。
 *
 * 为什么是**点击**不是 hover：
 *  - 触屏没有 hover，hover 提示在手机上等于不存在；
 *  - 这些文字是"可看可不看"的解释，不是操作前必须看到的警告。藏起来界面才干净，
 *    想确认的人点一下就有。
 *
 * ⚠️ 只收"解释性"文字，不收**状态**和**警告**：
 *    像「当前同步目标就是这台」这种随时在变的状态、以及不可逆操作的确认提示，
 *    必须一直看得见 —— 收进气泡里等于没提示。
 *
 * 无障碍走 **disclosure** 模式（button + aria-expanded / aria-controls），
 * 不是 role="tooltip"：tooltip 的语义是 hover/focus，点击展开的面板用它是错的。
 */
export function InfoTip({
  children,
  label = '说明',
  className,
}: {
  children: React.ReactNode
  /** 无障碍名称：读屏会念「说明，按钮」 */
  label?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  /** null = 还没量过尺寸；量完前先画在屏幕外，避免用户看到它跳位置 */
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const id = useId()
  const wrap = useRef<HTMLSpanElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  /**
   * 定位：把气泡**夹到视口里**。
   *
   * 一开始我用的是"图标在视口右半边就右对齐"，手机上直接翻车 ——
   * 390px 宽时图标在左半边（x≈110），左对齐后 110+288=398 戳出屏幕。
   * 按实际宽度算就不会有这种想当然：
   *   水平 left = clamp(图标左边, 8, 视口宽 - 气泡宽 - 8)
   *   垂直 优先放下面；下面放不下且上面放得下，就翻上去
   * 用 position:fixed 而不是 absolute —— 免得被祖先的 overflow:hidden 裁掉。
   */
  const place = useCallback(() => {
    const b = btn.current
    const p = panel.current
    if (!b || !p) return
    const r = b.getBoundingClientRect()
    const w = p.offsetWidth
    const h = p.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    const left = Math.min(Math.max(r.left, EDGE), Math.max(EDGE, vw - w - EDGE))
    const below = r.bottom + GAP
    const top = below + h + EDGE > vh ? Math.max(EDGE, r.top - h - GAP) : below
    setPos({ left, top })
  }, [])

  // 量尺寸 + 定位。useLayoutEffect：绘制前算完，不闪
  useLayoutEffect(() => {
    if (open) place()
  }, [open, place])

  // 开着的时候跟着滚动/改窗口走，不然气泡会留在原地
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

  // Esc 关闭 + 点外面关闭
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // ⚠️ 必须**捕获阶段**拦下来并掐断：Sheet 弹框的 Esc 监听挂在 document 冒泡阶段，
      //    而它比气泡先注册、会先跑 —— 不拦的话按一下 Esc 会把气泡和整个弹框一起关掉
      //    （在「订阅这个榜单」弹框里实测踩到）。Esc 只该关最上面那层。
      e.stopPropagation()
      setOpen(false)
      btn.current?.focus()
    }
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open])

  return (
    <span ref={wrap} className="relative inline-flex align-middle">
      <button
        ref={btn}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={(e) => {
          // 这个按钮常常嵌在 <label> 里：不拦的话点它会顺带把焦点送给输入框
          e.preventDefault()
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        className={cn(
          'inline-flex size-4 items-center justify-center rounded-full text-muted-foreground transition-colors',
          // 图标只有 16px，低于 WCAG 的 24px 触控目标下限。
          // 视觉上保持小，用一层透明伪元素把**可点区域**撑到 28×32。
          'before:absolute before:-inset-x-1.5 before:-inset-y-2 before:content-[""]',
          'hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
          open && 'text-foreground',
          className,
        )}
      >
        <Info className="size-3.5" aria-hidden />
      </button>

      {open &&
        createPortal(
          <div
            ref={panel}
            id={id}
            role="note"
            style={
              pos
                ? { left: pos.left, top: pos.top }
                : { left: -9999, top: -9999, visibility: 'hidden' }
            }
            className={cn(
              'fixed z-40 w-72 max-w-[calc(100vw-1rem)] rounded-md border border-border bg-popover p-2.5',
              'text-left text-xs font-normal leading-relaxed text-popover-foreground shadow-md',
            )}
          >
            {children}
          </div>,
          document.body,
        )}
    </span>
  )
}
