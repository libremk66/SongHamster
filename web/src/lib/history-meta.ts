/**
 * 历史记录页的展示派生函数。
 *
 * ⚠️ 这三个函数在后端 `src/core/history-meta.ts` 里各有一份，是**故意**的重复：
 * 后端用它们渲染 Eta 旧页，前端用它们渲染 React 新页，两边并行期都得活着。
 * 中文标签本身没在这硬编码 —— 走 `/history/rows-json` 返回的 `labels`，
 * 所以改文案只需要改后端一处，这里只负责"怎么拼"。
 */

/** 任务属性那一格：`手动 · 增量 · →《华语》· 处理3`（全部取自批次快照，任务后来改了配置也不影响） */
export function taskAttrs(
  b: {
    trigger?: string | null
    mode?: string | null
    delPolicy?: string | null
    archivePlaylist?: string | null
    targetPlaylists?: string | null
    playlistScopeName?: string | null
    taskType?: string | null
    maxCount?: number | null
    taskName?: string | null
  },
  L: { triggers: Record<string, string>; modes: Record<string, string>; delPolicies: Record<string, string> },
): string[] {
  const out: string[] = []
  out.push(L.triggers[b.trigger ?? ''] ?? b.trigger ?? '—')
  let targets: string[] = []
  try {
    targets = b.targetPlaylists ? (JSON.parse(b.targetPlaylists) as string[]) : []
  } catch {
    targets = []
  }
  // 目标歌单与任务名相同（同名歌单，最常见）→ 不重复显示；只有指向别的歌单时才有信息量
  const sameAsTask = targets.length === 1 && targets[0] === b.taskName
  if (targets.length && !sameAsTask) out.push('→《' + targets.join('》《') + '》')
  else if (b.taskType === 'adhoc') out.push('不入歌单')
  if (b.playlistScopeName) out.push(b.playlistScopeName)
  if (b.mode) out.push(L.modes[b.mode] ?? b.mode)
  // 只有镜像模式才谈得上"从 LX 移除时怎么处理"
  if (b.mode === 'mirror' && b.delPolicy) {
    const p = L.delPolicies[b.delPolicy] ?? b.delPolicy
    out.push(b.delPolicy === 'archive' && b.archivePlaylist ? `${p}（${b.archivePlaylist}）` : p)
  }
  if (b.taskType === 'chart') out.push(b.maxCount && b.maxCount > 0 ? `前 ${b.maxCount} 首` : '全榜')
  return out
}

/** 处理轨迹（JSON 数组字符串）→ 字符串数组；坏数据不炸页面 */
export function detailSteps(detail?: string | null): string[] {
  if (!detail) return []
  try {
    const a = JSON.parse(detail) as unknown
    return Array.isArray(a) ? a.map((x) => String(x)) : []
  } catch {
    return []
  }
}

/** 引用快照 → `无 → 本任务` / `华语 → 华语、热歌榜` */
export function refsText(refBefore?: string | null, refAfter?: string | null): string {
  const parse = (s?: string | null): string[] => {
    if (!s) return []
    try {
      return (JSON.parse(s) as { taskName: string }[]).map((r) => r.taskName)
    } catch {
      return []
    }
  }
  const a = parse(refBefore)
  const b = parse(refAfter)
  const fmt = (arr: string[]) => (arr.length ? arr.join('、') : '无')
  if (a.join() === b.join()) return fmt(a)
  return `${fmt(a)} → ${fmt(b)}`
}
