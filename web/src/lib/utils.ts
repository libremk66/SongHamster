import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** shadcn/ui 约定的类名合并工具：clsx 拼装 + tailwind-merge 去重 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
