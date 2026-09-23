import {
  Cable,
  History,
  ListMusic,
  ScrollText,
  Settings,
  SlidersHorizontal,
  Trophy,
  type LucideIcon,
} from 'lucide-react'

/**
 * 侧栏 / 移动抽屉的导航项。
 *
 * ⚠️ 手机端**不再有底栏**：原来按 `primary` 挑 4 项 + 「更多」铺满五格的底栏已按要求删掉，
 * 导航统一走左上角抽屉 —— 所以这里也没有 `primary` 标记了。
 */
export type NavItem = {
  to: string
  label: string
  icon: LucideIcon
}

/** 与后端 `src/routes/pages.ts` 的 NAV 对齐；「曲库管理」界面暂时收起，故不列 */
export const NAV: NavItem[] = [
  { to: '/connect', label: '连接容器', icon: Cable },
  { to: '/sync-setup', label: '歌单同步', icon: ListMusic },
  { to: '/charts', label: '榜单订阅', icon: Trophy },
  { to: '/options', label: '下载选项', icon: SlidersHorizontal },
  { to: '/history', label: '进度历史', icon: History },
  { to: '/logs', label: '日志', icon: ScrollText },
  { to: '/settings', label: '设置', icon: Settings },
]
