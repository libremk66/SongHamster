import * as React from 'react'

import { cn } from '@/lib/utils'

function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    <label
      data-slot="label"
      className={cn(
        'flex select-none items-center gap-2 text-sm leading-none',
        'has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60',
        className,
      )}
      {...props}
    />
  )
}

/** 表单里的字段标题（小节内的说明文字） */
function FieldLabel({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="field-label"
      className={cn('mb-1 block text-xs text-muted-foreground', className)}
      {...props}
    />
  )
}

export { Label, FieldLabel }
