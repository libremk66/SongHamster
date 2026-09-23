import { cn } from '@/lib/utils'

/**
 * 统一的表单/操作反馈。
 *
 * 为什么要抽组件：以前 8 个页面各写各的 `<p className="text-destructive">`，
 * 结果是**只有 4 处标了 role**，其余全是"视觉-only"——屏幕阅读器读不到。
 * 这里把语义焊死：成功 = role="status"（polite），失败 = role="alert"（assertive）。
 *
 * UX 规则原文：Error messages must be announced — 不要只有视觉提示。
 */
export function FormMessage({
  ok,
  children,
  className,
}: {
  ok: boolean
  children: React.ReactNode
  className?: string
}) {
  if (!children) return null
  return (
    <p
      role={ok ? 'status' : 'alert'}
      className={cn('text-sm', ok ? 'text-emerald-400' : 'text-destructive', className)}
    >
      {ok ? '✅' : '❌'} {children}
    </p>
  )
}

/** 有些地方消息不在 <p> 里（表格行内、工具条里），只要语义时用这个 */
export function messageRole(ok: boolean) {
  return ok ? ('status' as const) : ('alert' as const)
}
