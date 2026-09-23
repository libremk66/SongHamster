import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * 用**原生 checkbox**：可访问性最好、移动端命中判定由系统处理。
 * 触控目标靠外层 label 撑（`min-h-11`），不是靠把方框画大。
 */
function Checkbox({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type="checkbox"
      data-slot="checkbox"
      className={cn(
        'size-4 shrink-0 rounded border-input accent-primary outline-none',
        'focus-visible:ring-[3px] focus-visible:ring-ring/50',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'max-md:size-5',
        className,
      )}
      {...props}
    />
  )
}

export { Checkbox }
