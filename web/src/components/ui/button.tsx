import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

/**
 * 尺寸带 `max-md:` 分支。
 *
 * ⚠️ 触控目标的量纲**不是**统一的（UI UX Pro Max 规则原文）：
 *   iOS 44pt ／ Android 48dp ／ **Web 用 WCAG Target Size（24 CSS px + 例外）**
 * 原文特别提醒 Don't: Treat one unit or minimum as universal across platforms。
 *
 * 所以这里的分工是：**主操作保持 44px**（单手够得着、不误触），
 * **次级/行内**放到 36~40px 并保证间距 —— 全站一律 44px 会让界面显得笨重。
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium outline-none transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90',
        outline: 'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2 max-md:h-11 has-[>svg]:px-3',
        sm: 'h-8 gap-1.5 rounded-md px-3 max-md:h-9 has-[>svg]:px-2.5',
        lg: 'h-10 rounded-md px-6 max-md:h-12 has-[>svg]:px-4',
        icon: 'size-9 max-md:size-11',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : 'button'

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
