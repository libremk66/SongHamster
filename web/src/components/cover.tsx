import { useState } from 'react'
import { Music } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * 歌曲封面缩略图。
 *
 * 图源是**媒体服务器**（走 /api/cover/:songKey 代理，不用把 API key 暴露给浏览器）。
 * 没有封面/条目不在库里 → 显示占位方块（音乐图标），不显示破图。
 *
 * ⚠️ 尺寸按 2x 取（retina），列表用 40 逻辑像素 → 实际取 80。
 */
export function Cover({
  songKey,
  size = 40,
  fill = false,
  className,
}: {
  songKey: string
  /** 逻辑像素边长 */
  size?: number
  /** 填满父容器（卡片背景用）—— 此时忽略 size */
  fill?: boolean
  className?: string
}) {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return (
      <span
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded bg-muted text-muted-foreground',
          className,
        )}
        style={fill ? undefined : { width: size, height: size }}
        aria-hidden
      >
        <Music style={fill ? { width: 24, height: 24 } : { width: size * 0.5, height: size * 0.5 }} />
      </span>
    )
  }

  return (
    <img
      src={`/api/cover/${encodeURIComponent(songKey)}?size=${size * 2}`}
      alt=""
      aria-hidden
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={cn('shrink-0 rounded object-cover', fill && 'size-full rounded-none', className)}
      style={fill ? undefined : { width: size, height: size }}
    />
  )
}
