import { cn } from '@/lib/utils'

/**
 * 榜单卡片配图 —— **模板生成**，不是封面墙。
 *
 * 歌单是"一堆歌"，用封面拼图合适；榜单是"一个身份"（QQ音乐·新歌榜），
 * 该有一张自己的图：榜单名当主角 + 平台名当副题。
 *
 * 用内联 SVG 而不是后端出图：不占网络、任意尺寸都清晰、主题色能跟着 token 走。
 */

/** label 给大图当水印（要品牌全名）；short 给卡片上那个方形小格用（一格才 72px，塞不下四个字） */
const PLATFORM: Record<string, { label: string; short: string; color: string }> = {
  tx: { label: 'QQ音乐', short: 'QQ', color: '#31C27C' },
  wy: { label: '网易云音乐', short: '网易云', color: '#C20C0C' },
  kw: { label: '酷我音乐', short: '酷我', color: '#FFB800' },
  kg: { label: '酷狗音乐', short: '酷狗', color: '#2AA3FF' },
  mg: { label: '咪咕音乐', short: '咪咕', color: '#FF6A00' },
}

export function platformOf(source: string) {
  return PLATFORM[source] ?? { label: source.toUpperCase() || '榜单', short: source.toUpperCase() || '榜单', color: '#8A8279' }
}

/** 从 lxPlaylistKey（chart:<source>:<id>）里取平台 */
export function sourceOfKey(key: string): string {
  const m = /^chart:([^:]+):/.exec(key)
  return m ? m[1] : ''
}

/**
 * 榜单模板图的**背景部分**：平台色渐变 + 三道同心弧，不带任何文字。
 *
 * 单独抽出来是给卡片当背景用的 —— 歌单卡拿封面图放大模糊当底，
 * 榜单卡没封面，就用它自己那张模板图的底（放大 + 模糊后是一层平台色的光晕），
 * 这样两类卡片的背景来源是同一套逻辑。
 * 文字不能一起放进来：放大模糊之后字会糊成一条脏印子。
 */
export function ChartCoverBg({ source, className }: { source: string; className?: string }) {
  const p = platformOf(source)
  const id = `cb-${source || 'x'}` // 同页多张要唯一，否则渐变互相覆盖
  return (
    <svg viewBox="0 0 320 200" className={cn('size-full', className)} aria-hidden preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={p.color} stopOpacity="0.55" />
          <stop offset="55%" stopColor="#1B1917" stopOpacity="1" />
          <stop offset="100%" stopColor="#0E0D0C" stopOpacity="1" />
        </linearGradient>
      </defs>
      <rect width="320" height="200" fill={`url(#${id})`} />
      <g stroke={p.color} strokeOpacity="0.65" fill="none" strokeWidth="2">
        <circle cx="284" cy="40" r="54" />
        <circle cx="284" cy="40" r="78" />
        <circle cx="284" cy="40" r="102" />
      </g>
    </svg>
  )
}

export function ChartCover({
  source,
  name,
  className,
}: {
  /** 平台代码：tx / wy / kw / kg / mg / bd */
  source: string
  /** 榜单名，如「新歌榜」 */
  name: string
  className?: string
}) {
  const p = platformOf(source)
  const id = `cc-${source || 'x'}` // 渐变 id 要唯一，避免同页多张互相覆盖

  // 榜单名可能较长（如「QQ音乐·新歌榜」），按字数缩字号
  const title = name.length > 6 ? 34 : name.length > 4 ? 44 : 56

  return (
    <svg
      viewBox="0 0 320 200"
      className={cn('size-full', className)}
      role="img"
      aria-label={`${p.label} ${name}`}
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={p.color} stopOpacity="0.30" />
          <stop offset="55%" stopColor="#1B1917" stopOpacity="1" />
          <stop offset="100%" stopColor="#0E0D0C" stopOpacity="1" />
        </linearGradient>
      </defs>

      <rect width="320" height="200" fill={`url(#${id})`} />

      {/* 平台色弧线 —— 模板的"装饰",表达"这是个榜单/排名" */}
      <g stroke={p.color} strokeOpacity="0.55" fill="none" strokeWidth="2">
        <circle cx="284" cy="40" r="54" />
        <circle cx="284" cy="40" r="78" />
        <circle cx="284" cy="40" r="102" />
      </g>

      {/* 平台名：右下角小字。不放左上角 —— 那里被卡片的叠加信息占着，会打架 */}
      <text x="304" y="186" textAnchor="end" fontSize="12" fontWeight="600" fill={p.color} fillOpacity="0.95">
        {p.label}
      </text>

      {/* 榜单名（主角） */}
      <text x="20" y="128" fontSize={title} fontWeight="800" fill="#F2ECE2" letterSpacing="1">
        {name}
      </text>

      {/* 副题 */}
      <text x="20" y="152" fontSize="13" fill="#F2ECE2" fillOpacity="0.55" letterSpacing="2">
        榜单订阅 · 自动跟进新上榜
      </text>
    </svg>
  )
}
