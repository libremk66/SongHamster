/**
 * 远端最新版本探测（侧栏底部「已是最新 · vX」那行用）。
 *
 * 对齐 DockHamster 的做法：拿不到远端信息就**什么都不显示**，
 * 不猜、不提示"已是最新"——避免网络不通时给出虚假的绿灯。
 *
 * 为什么走浏览器直连 GitHub：
 * - api.github.com 允许匿名跨域（Access-Control-Allow-Origin: *），不需要后端代理；
 * - 检查失败（无外网 / 被墙）只是少一行字，不影响任何功能；
 * - 用 sessionStorage 缓存 1 小时，匿名 API 每小时 60 次的限额足够。
 */

const REPO = 'libremk66/SongHamster'
const CACHE_KEY = 'sh-latest-version'
const CACHE_TTL = 60 * 60 * 1000

/** 解析 "v1.2.3" / "1.2.3" → [1,2,3]；解析不了返回 null */
function parseVersion(v: string): [number, number, number] | null {
  const m = v.trim().replace(/^[vV]/, '').match(/^(\d+)\.(\d+)\.(\d+)/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** latest 是否比 current 新（任一解析失败都按"不比"处理） */
export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest)
  const b = parseVersion(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i]
  }
  return false
}

/** 取 GitHub 最新 release 的 tag；失败/超时返回 null */
export async function fetchLatestVersion(): Promise<string | null> {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (raw) {
      const { at, tag } = JSON.parse(raw) as { at: number; tag: string | null }
      if (Date.now() - at < CACHE_TTL) return tag
    }
  } catch {
    /* 隐私模式 / 缓存损坏，照常走网络 */
  }

  let tag: string | null = null
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(6000),
    })
    if (res.ok) {
      const data = (await res.json()) as { tag_name?: string }
      tag = data.tag_name ?? null
    }
  } catch {
    /* 离线/超时：保持 null，界面不显示这行 */
  }

  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), tag }))
  } catch {
    /* 存不下就算了 */
  }
  return tag
}
