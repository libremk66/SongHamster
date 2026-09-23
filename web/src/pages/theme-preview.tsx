import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/**
 * 阶段二：设计方向对比页（临时页面，定稿后删除）。
 *
 * 用**同一套界面**（KPI 卡 + 密集表格 + 按钮 + 徽章）在三种 token 下渲染 ——
 * 这样比较的是设计系统本身，不是内容差异。
 *
 * ⚠️ 中文界面里字体影响有限（汉字走系统字体），所以对比重点是
 *    配色 / 密度 / 圆角 / 层次，不是字体名。
 */

type Theme = {
  key: string
  name: string
  desc: string
  /** 覆盖 shadcn 的 CSS 变量 */
  vars: Record<string, string>
  /** 半径与密度（这两项对"后台工具"的手感影响最大） */
  radius: string
  rowPad: string
  fontHeading?: string
}

const THEMES: Theme[] = [
  {
    key: 'dark',
    name: 'A · 深色科技',
    desc: '深蓝黑底 + 品牌绿点缀。适合长时间盯屏、日志/进度这类「看数据」的场景；和同步工具的气质一致。',
    radius: '0.5rem',
    rowPad: 'py-1.5 px-2',
    vars: {
      '--background': '#0F172A',
      '--foreground': '#F8FAFC',
      '--card': '#1B2336',
      '--card-foreground': '#F8FAFC',
      '--muted': '#272F42',
      '--muted-foreground': '#94A3B8',
      '--border': '#334155',
      '--primary': '#22C55E',
      '--primary-foreground': '#0F172A',
      '--secondary': '#272F42',
      '--secondary-foreground': '#F8FAFC',
      '--destructive': '#EF4444',
      '--destructive-foreground': '#FFFFFF',
      '--ring': '#22C55E',
    },
  },
  {
    key: 'light-blue',
    name: 'B · 浅色专业蓝',
    desc: '白底 + 靛蓝主色 + 琥珀点缀。信息密度高但清爽，接近传统运维后台；白天在明亮环境看更省眼。',
    radius: '0.375rem',
    rowPad: 'py-1.5 px-2',
    vars: {
      '--background': '#F8FAFC',
      '--foreground': '#0F172A',
      '--card': '#FFFFFF',
      '--card-foreground': '#0F172A',
      '--muted': '#F1F5F9',
      '--muted-foreground': '#64748B',
      '--border': '#E2E8F0',
      '--primary': '#1E40AF',
      '--primary-foreground': '#FFFFFF',
      '--secondary': '#EFF6FF',
      '--secondary-foreground': '#1E40AF',
      '--destructive': '#DC2626',
      '--destructive-foreground': '#FFFFFF',
      '--ring': '#1E40AF',
    },
  },
  {
    key: 'light-green',
    name: 'C · 浅色品牌绿',
    desc: '白底微绿 + 深绿主色。延续现在界面的品牌绿，改动最小、和项目图标最搭；比 B 更「轻」一些。',
    radius: '0.625rem',
    rowPad: 'py-2 px-2',
    vars: {
      '--background': '#F7FDF9',
      '--foreground': '#052E16',
      '--card': '#FFFFFF',
      '--card-foreground': '#052E16',
      '--muted': '#ECFDF5',
      '--muted-foreground': '#4B7C5F',
      '--border': '#D1FAE5',
      '--primary': '#15803D',
      '--primary-foreground': '#FFFFFF',
      '--secondary': '#DCFCE7',
      '--secondary-foreground': '#14532D',
      '--destructive': '#DC2626',
      '--destructive-foreground': '#FFFFFF',
      '--ring': '#15803D',
    },
  },
  {
    key: 'vinyl',
    name: 'D · 暖夜黑胶',
    desc: '暖棕黑底 + 琥珀金。像黑胶唱片店的灯光，暖色不刺眼；音乐主题里最有「味道」的一档。',
    radius: '0.5rem',
    rowPad: 'py-1.5 px-2',
    vars: {
      '--background': '#1C1917',
      '--foreground': '#FAFAF9',
      '--card': '#292524',
      '--card-foreground': '#FAFAF9',
      '--muted': '#3A3633',
      '--muted-foreground': '#A8A29E',
      '--border': '#44403C',
      '--primary': '#F59E0B',
      '--primary-foreground': '#1C1917',
      '--secondary': '#3A3633',
      '--secondary-foreground': '#FAFAF9',
      '--destructive': '#EF4444',
      '--destructive-foreground': '#FFFFFF',
      '--ring': '#F59E0B',
    },
  },
  {
    key: 'soft',
    name: 'E · 柔和紫（Catppuccin 风）',
    desc: '低饱和紫灰底 + 藕荷点缀。开发者社区很流行的"护眼深色"，对比度刻意压低，长时间看不累。',
    radius: '0.625rem',
    rowPad: 'py-1.5 px-2',
    vars: {
      '--background': '#1E1E2E',
      '--foreground': '#CDD6F4',
      '--card': '#313244',
      '--card-foreground': '#CDD6F4',
      '--muted': '#45475A',
      '--muted-foreground': '#A6ADC8',
      '--border': '#45475A',
      '--primary': '#CBA6F7',
      '--primary-foreground': '#1E1E2E',
      '--secondary': '#45475A',
      '--secondary-foreground': '#CDD6F4',
      '--destructive': '#F38BA8',
      '--destructive-foreground': '#1E1E2E',
      '--ring': '#CBA6F7',
    },
  },
  {
    key: 'paper',
    name: 'F · 纸白（印刷感）',
    desc: '暖米白纸底 + 墨黑 + 朱红点缀。像乐谱纸/印刷品，克制、有质感；表格边界靠细线而不是阴影。',
    radius: '0.25rem',
    rowPad: 'py-1.5 px-2',
    vars: {
      '--background': '#FAF7F2',
      '--foreground': '#1C1917',
      '--card': '#FFFFFF',
      '--card-foreground': '#1C1917',
      '--muted': '#F0EBE3',
      '--muted-foreground': '#78716C',
      '--border': '#E0D9CE',
      '--primary': '#1C1917',
      '--primary-foreground': '#FAF7F2',
      '--secondary': '#F0EBE3',
      '--secondary-foreground': '#1C1917',
      '--destructive': '#B91C1C',
      '--destructive-foreground': '#FFFFFF',
      '--ring': '#C2410C',
    },
  },
  {
    key: 'mono',
    name: 'G · 高对比硬朗',
    desc: '纯黑白 + 一个强强调色（电光蓝）。没有圆角、没有阴影，边框说话；信息密度最高，也最"工具"。',
    radius: '0rem',
    rowPad: 'py-1 px-2',
    vars: {
      '--background': '#FFFFFF',
      '--foreground': '#000000',
      '--card': '#FFFFFF',
      '--card-foreground': '#000000',
      '--muted': '#F4F4F5',
      '--muted-foreground': '#52525B',
      '--border': '#000000',
      '--primary': '#000000',
      '--primary-foreground': '#FFFFFF',
      '--secondary': '#F4F4F5',
      '--secondary-foreground': '#000000',
      '--destructive': '#DC2626',
      '--destructive-foreground': '#FFFFFF',
      '--ring': '#2563EB',
    },
  },
]

export function ThemePreviewPage() {
  const [picked, setPicked] = useState<string | null>(null)
  return (
    <div className="space-y-4">
      {/* 手机端不显示页面名：顶栏已经写着（见 app-shell），这块地方留给内容 */}
      <header className="max-md:hidden">
        <h1 className="text-lg font-bold tracking-tight">设计方向对比</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          同一套界面在七种 token 下的样子（A~C 第一批 / D~G 第二批）。看配色 / 密度 / 圆角 / 层次 —— 中文界面里字体影响有限（汉字走系统字体）。
        </p>
      </header>

      <div className="space-y-6">
        {THEMES.map((t) => (
          <div key={t.key}>
            <div className="mb-2 flex flex-wrap items-center gap-3">
              <h2 className="text-sm font-bold">{t.name}</h2>
              <span className="text-xs text-muted-foreground">{t.desc}</span>
              <Button
                type="button"
                size="sm"
                variant={picked === t.key ? 'default' : 'outline'}
                onClick={() => setPicked(t.key)}
              >
                {picked === t.key ? '已选这个' : '选这个'}
              </Button>
            </div>
            <ThemeFrame theme={t} />
          </div>
        ))}
      </div>

      {picked && (
        <p className="rounded-lg border bg-muted/40 p-3 text-sm">
          你选了 <b>{THEMES.find((t) => t.key === picked)?.name}</b> —— 告诉我一声，我就把它的 token 灌进
          <code className="mx-1 rounded bg-background px-1">web/src/index.css</code>
          的 <code className="rounded bg-background px-1">:root</code> / <code className="rounded bg-background px-1">.dark</code>，组件代码一行不用改。
        </p>
      )}
    </div>
  )
}

/** 把 token 以 inline style 注入这一块，模拟"换肤后"的样子 */
function ThemeFrame({ theme }: { theme: Theme }) {
  return (
    <div
      style={{ ...(theme.vars as React.CSSProperties), ['--radius' as string]: theme.radius, padding: 16 }}
      className="rounded-xl border bg-background text-foreground"
    >
      <div className="mx-auto max-w-4xl space-y-3">
        {/* KPI 卡 */}
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {[
            ['本期新增', '12'],
            ['复用', '38'],
            ['未满足', '3'],
            ['移出', '1'],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg border bg-card p-2.5 text-card-foreground">
              <div className="text-xs text-muted-foreground">{k}</div>
              <div className="mt-0.5 text-xl font-bold tabular-nums">{v}</div>
            </div>
          ))}
        </div>

        {/* 密集表格 */}
        <div className="overflow-hidden rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className={cn('font-medium', theme.rowPad)}>时间</th>
                <th className={cn('font-medium', theme.rowPad)}>任务</th>
                <th className={cn('font-medium', theme.rowPad)}>歌曲</th>
                <th className={cn('font-medium', theme.rowPad)}>音质</th>
                <th className={cn('font-medium', theme.rowPad)}>结果</th>
                <th className={cn('text-right font-medium', theme.rowPad)}>操作</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['09-20 08:00', 'QQ·热歌榜', '特别的人', 'master', '✅ 成功'],
                ['09-20 08:00', 'QQ·热歌榜', '失眠', 'flac24bit', '♻️ 复用已有'],
                ['09-18 08:00', '华语', '心要野', 'flac', '⚠️ 未满足'],
                ['09-18 08:00', '华语', '稻香', '320k', '🗑 已移出'],
              ].map((r, i) => (
                <tr key={i} className="border-b last:border-b-0 hover:bg-muted/40">
                  <td className={cn('whitespace-nowrap text-xs text-muted-foreground', theme.rowPad)}>{r[0]}</td>
                  <td className={cn('whitespace-nowrap text-xs', theme.rowPad)}>{r[1]}</td>
                  <td className={cn(theme.rowPad)}>{r[2]}</td>
                  <td className={cn(theme.rowPad)}>
                    <Badge variant="secondary">{r[3]}</Badge>
                  </td>
                  <td className={cn('whitespace-nowrap text-xs', theme.rowPad)}>{r[4]}</td>
                  <td className={cn('text-right', theme.rowPad)}>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs">
                      重试
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 按钮层次 */}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm">主操作</Button>
          <Button size="sm" variant="secondary">
            次操作
          </Button>
          <Button size="sm" variant="outline">
            描边
          </Button>
          <Button size="sm" variant="ghost">
            幽灵
          </Button>
          <Button size="sm" variant="destructive">
            危险
          </Button>
        </div>
      </div>
    </div>
  )
}
