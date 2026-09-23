import { useEffect, useState } from 'react'

/**
 * 延迟出现的加载指示。
 *
 * UX 规则原文：Loading feedback should match the expected wait and
 * **avoid flashing for near-instant work**。
 *
 * 这台机器是本地 NAS，请求经常 50ms 就回来了 —— 直接渲染「加载中…」
 * 等于每次切页都闪一下。这里改成：超过 delayMs 还没好才显示。
 */
export function DelayedLoading({
  loading,
  children = '加载中…',
  delayMs = 200,
  className = 'py-8 text-center text-sm text-muted-foreground',
}: {
  loading: boolean
  children?: React.ReactNode
  delayMs?: number
  className?: string
}) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!loading) {
      setShow(false)
      return
    }
    const t = setTimeout(() => setShow(true), delayMs)
    return () => clearTimeout(t)
  }, [loading, delayMs])

  if (!show) return null
  return (
    <p className={className} role="status" aria-live="polite">
      {children}
    </p>
  )
}
