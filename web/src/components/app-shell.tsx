import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { CircleHelp, LogOut, Menu, Tag, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/theme-toggle'
import { NAV } from '@/lib/nav'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

/*
 * 侧栏尺寸参考 MoviePilot 的 VerticalNav（源码实测，不是我编的）：
 *   宽度          16.25rem = 260px
 *   顶栏高        4rem = 64px
 *   导航项内边距  左右 22px / 16px，右侧再留 18px 外边距
 *   导航项圆角    0 3.125rem 3.125rem 0 —— 右半边全圆，形成"胶囊贴着左边"的样子
 *   字号          14px（Vuetify VListItem 默认，和我们的 text-sm 一致）
 * 唯一没照搬的是 logo 标题：MP 是「MOVIEPILOT」全大写拉丁字母，24px 撑得住；
 * 「音乐仓鼠」4 个汉字用 24px 会显得头重脚轻，用 20px。
 */
/*
  ⚠️ 字号别用 text-sm（=15px）：MP 的 `.nav-item-title` 压根没设 font-size，它继承
  `body{font-size:16px}` —— 所以它实际是 16px。同理图标 MP 是 1.5rem(24px)，
  我们原来是 20px，那 4px 才是"看着比 MP 小"的主因。
*/
const NAV_ITEM =
  'flex h-11 items-center gap-3 rounded-r-full pr-4 pl-[1.375rem] mr-[1.125rem] text-base transition-colors'

const FOOT_ITEM =
  'flex h-9 w-full items-center gap-2.5 rounded-md px-3 text-base text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'

/** logo + 站名（桌面侧栏和手机抽屉共用） */
function SidebarLogo({ right }: { right?: React.ReactNode }) {
  return (
    <div className="flex h-16 shrink-0 items-center gap-3 border-b pr-3 pl-[1.375rem]">
      <img src="/static/icon.png" alt="" className="size-9 shrink-0 rounded-lg object-cover" />
      <span className="flex-1 truncate text-xl font-bold tracking-tight">音乐仓鼠</span>
      {right}
    </div>
  )
}

/**
 * 侧栏底部：帮助 / 版本 / 退出登录。
 * 版本号取自后端 `/healthz`（它读的是 package.json，不会再像以前那样写死）。
 */
function SidebarFooter() {
  const [version, setVersion] = useState('')
  useEffect(() => {
    fetch('/healthz')
      .then((r) => r.json())
      .then((d: { version?: string }) => setVersion(d.version ?? ''))
      .catch(() => {})
  }, [])

  const logout = async () => {
    try {
      await api.post('/auth/logout', {})
    } catch {
      /* 登出接口失败也要走，不然用户被困在这一页 */
    }
    window.location.href = '/app/login'
  }

  return (
    <div className="shrink-0 space-y-0.5 border-t p-2">
      <a
        href="https://github.com/libremk66/songhamster#readme"
        target="_blank"
        rel="noreferrer"
        className={FOOT_ITEM}
      >
        <CircleHelp className="size-4 shrink-0" aria-hidden />
        帮助说明
      </a>
      <div className={cn(FOOT_ITEM, 'cursor-default hover:bg-transparent')} title="当前版本">
        <Tag className="size-4 shrink-0" aria-hidden />
        版本 {version || '—'}
      </div>
      <button type="button" onClick={() => void logout()} className={cn(FOOT_ITEM, 'cursor-pointer')}>
        <LogOut className="size-4 shrink-0" aria-hidden />
        退出登录
      </button>
      <div className="px-1 pt-1">
        <ThemeToggle />
      </div>
    </div>
  )
}

/**
 * 应用外壳 —— 一套代码两种形态：
 * - ≥md：左侧固定侧栏 + 内容区
 * - <md：顶栏（汉堡）+ 内容区 + 底部常驻标签栏（4 个主入口 + 「更多」抽屉）
 */
export function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()
  const current = NAV.find((n) => location.pathname.startsWith(n.to))

  // 切页时自动关抽屉
  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  // 抽屉打开时，把「返回」接管成「关抽屉」而不是退出页面（UX 规则：Mobile Back Button）
  useEffect(() => {
    if (!drawerOpen) return
    window.history.pushState({ drawer: true }, '')
    const onPop = () => setDrawerOpen(false)
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      // 若是点遮罩/切页关的（没经过返回键），把刚压进去的那条历史弹掉，别留垃圾
      if (window.history.state?.drawer) window.history.back()
    }
  }, [drawerOpen])

  return (
    /*
      ⚠️ 骨架是「定高 + 内容区自己滚」，不是文档流滚动。
      为什么非这样：进度历史那种页面要「面板撑满剩余高度、内部列表滚动」，
      就得让子元素能拿到**确定高度**。原来根节点是 `min-h-svh`（只有最小高度、
      高度仍是不确定的），整条 `flex-1` 链算不出"剩余多少"，卡片会被内容撑到 2500px；
      各页面只好自己 `calc(100svh - Nrem)` 猜死高度 —— 猜错就是底部空一大片
      （实测回收站手机端空 156px、历史记录空 100px）。
      改成 `h-svh` + `main` 当滚动容器后，高度是确定的，`flex-1` 才有意义，
      页面也不用再猜任何数。（body 已有 bg-background，移动端地址栏收起时不会露白边。）
    */
    <div className="flex h-svh flex-col bg-background">
      {/* ── 桌面侧栏 ───────────────────────────── */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[16.25rem] flex-col border-r bg-sidebar md:flex">
        <SidebarLogo />
        <nav className="flex-1 space-y-0.5 overflow-y-auto py-2">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  NAV_ITEM,
                  isActive
                    ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
                )
              }
            >
              <item.icon className="size-6 shrink-0" aria-hidden />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <SidebarFooter />
      </aside>

      {/* ── 移动顶栏（在滚动容器之外，天然常驻，不用 sticky） ── */}
      <header className="z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-2 backdrop-blur md:hidden">
        <Button
          variant="ghost"
          size="icon"
          aria-label="打开菜单"
          onClick={() => setDrawerOpen(true)}
        >
          <Menu />
        </Button>
        <span className="truncate text-sm font-semibold">{current?.label ?? '音乐仓鼠'}</span>
      </header>

      {/* ── 移动抽屉（全部入口） ─────────────────── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true">
          <button
            className="absolute inset-0 bg-black/40"
            aria-label="关闭菜单"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-[16.25rem] flex-col bg-sidebar shadow-xl">
            <SidebarLogo
              right={
                <Button variant="ghost" size="icon" aria-label="关闭" onClick={() => setDrawerOpen(false)}>
                  <X />
                </Button>
              }
            />
            <nav className="flex-1 space-y-0.5 overflow-y-auto py-2">
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      NAV_ITEM,
                      'h-12', // 手机上手指点，比桌面高一点
                      isActive
                        ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                        : 'text-sidebar-foreground/80',
                    )
                  }
                >
                  <item.icon className="size-6 shrink-0" aria-hidden />
                  {item.label}
                </NavLink>
              ))}
            </nav>
            <SidebarFooter />
          </div>
        </div>
      )}

      {/* ── 内容区 ─────────────────────────────── */}
      {/* 滚动容器（见根节点注释）：flex-1 拿到确定高度，overflow-y-auto 让长页面在这儿滚 */}
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto md:pl-[16.25rem]">
        {/*
          内容区**铺满**（不设 max-width）——
          这是数据密集的后台：表格列越多越需要横向空间，
          在 1440px 屏上 max-w-6xl(1152px) 会白白浪费两成宽度、把表格挤窄。
          参考 MoviePilot / 多数后台的流式布局。

          手机底部内边距**按底栏实际高度算**（`min-h-14` 56px + 安全区 + 8px 余量），
          不写死 `pb-24`(96px) —— 那多出来的 40px 会让"撑满屏幕"的页面永远差一截。
        */}
        {/*
          ⚠️ `min-h-0` 不能少。flex 项的**自动最小尺寸 = 内容高度**，
          没有它这层会被内容顶开（实测 2484px），里面页面的 `flex-1` 全白算。
          有了它这层正好等于 main 的可视高度，页面才拿得到"剩余高度"。
        */}
        <div className="flex min-h-0 flex-1 flex-col px-3 pt-4 md:px-6 md:pt-6">
          <Outlet />
          {/*
            底部留白：原先要躲开 56px 的移动底栏，现在底栏删了，只让开安全区 + 16px 呼吸位。
            用一块**流内**占位，不用容器的 `padding-bottom` ——
            内容比一屏高时是"溢出"，会连 padding 一起吃掉，最后一截贴着屏幕底边。
          */}
          <div className="h-[calc(env(safe-area-inset-bottom)+1rem)] shrink-0 md:h-6" aria-hidden />
        </div>
      </main>

      {/*
        ⚠️ 移动底栏（原「歌单同步/榜单订阅/进度历史/日志/更多」五格）已按用户要求**删除** ——
        导航改走左上角抽屉。省下的 56px 全给内容区（历史记录那种页面的滚动区直接变高）。
        换句话说：手机上不再有任何 fixed 底栏压着内容，底部只需让开安全区。
      */}
    </div>
  )
}
