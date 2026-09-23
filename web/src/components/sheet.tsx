import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * 可访问的弹层。**替代裸写的 fixed 遮罩层**。
 *
 * 之前歌曲来历卡和移动抽屉都是"只能鼠标点关闭"，键盘用户打开就困住了。
 * 这里补齐 UX 规则里那几条 High：
 *  - Esc 关闭
 *  - 打开时焦点移入，关闭后**归还**到打开它的元素
 *  - 焦点陷阱（Tab 不会跑到背后的页面）
 *  - role="dialog" + aria-modal
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  className,
  /** 面板宽度：默认 lg(512px)；**内容多的（如逐条记录）用 xl(576px)** */
  size = 'lg',
}: {
  open: boolean
  onClose: () => void
  title?: React.ReactNode
  children: React.ReactNode
  className?: string
  size?: 'lg' | 'xl'
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  /** 打开前焦点在哪 —— 关闭时要还回去 */
  const restoreRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    restoreRef.current = document.activeElement as HTMLElement | null

    // 焦点移入面板（优先第一个可聚焦元素，没有就面板本身）
    const panel = panelRef.current
    const first = panel?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    ;(first ?? panel)?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab' || !panel) return
      // 焦点陷阱：把 Tab 圈在面板内
      const items = [...panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
      )].filter((el) => el.offsetParent !== null)
      if (!items.length) return
      const firstEl = items[0]
      const lastEl = items[items.length - 1]
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }
    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('keydown', onKey)
      // 焦点归还
      restoreRef.current?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  /*
    ⚠️ 必须 portal 到 body，不能就地渲染。
    调用方常在**任务卡片内部**挂这个弹框，而卡片有 `hover:scale-105` ——
    CSS 里 `transform` / `scale` / `filter` / `contain` 都会让元素成为
    position:fixed 的**包含块**，于是弹框不再相对视口、被摁在卡片里，
    再被卡片的 overflow-hidden 裁掉（实测弹框变成 274×171，内容全糊在一起）。
    点「编辑」时鼠标必然停在卡片上 → 悬停态 → 100% 复现。
    portal 出去，祖先再怎么变换都影响不到弹层。
  */
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <button className="absolute inset-0 bg-black/50" aria-label="关闭" tabIndex={-1} onClick={onClose} />
      {/*
        ⚠️ 面板**必须**限高 + 让 body 自己滚。
        原来这里既没有 max-h 也没有 overflow：内容一高，面板就比视口还高，
        再被外层 `items-center` 居中一摆，**上下同时溢出**且整页滚不动 ——
        实测任务编辑弹框 872px / 视口 844px，标题栏的 ✕ 和底部的「保存」各被切掉一截，
        键盘用户直接被困在表单中间（6 个调用点全中，表单最长的那个最先炸）。
        max-h 用 `calc(100svh - 2rem)` 而不是 `max-h-full`：外层 `p-4` 上下各 16px，
        写死比依赖百分比高度链更稳。
      */}
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-[calc(100svh-2rem)] w-full flex-col overflow-hidden',
          'rounded-xl border bg-popover text-popover-foreground shadow-lg outline-none',
          // 宽度写在这里，别让调用方用 className 覆盖 —— 两个 max-w-* 谁赢只看 CSS 里的先后，不可控
          size === 'xl' ? 'max-w-xl' : 'max-w-lg',
          className,
        )}
      >
        {title !== undefined && (
          <div className="flex shrink-0 items-start justify-between gap-3 border-b p-4">
            <h3 className="text-base font-bold">{title}</h3>
            <Button type="button" variant="ghost" size="icon" aria-label="关闭" onClick={onClose}>
              <X />
            </Button>
          </div>
        )}
        {/*
          `p-4` 不能省：`overflow-y-auto` 会连带把横向也变成裁剪，
          而这 16px 内边距正好装得下输入框的 `focus-visible:ring-[3px]`（否则聚焦时圆环被切边）。
        */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
