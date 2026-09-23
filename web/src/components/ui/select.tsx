import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * 刻意用**原生 select**：移动端会唤起系统选择器（iOS 滚轮 / Android 弹窗），
 * 体验和可访问性都优于自绘下拉。桌面端外观与其它输入框保持一致。
 */
function Select({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      data-slot="select"
      className={cn(
        'flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs outline-none transition-[color,box-shadow]',
        'max-md:h-11',
        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        'md:text-sm',
        className,
      )}
      {...props}
    />
  )
}

export { Select }
