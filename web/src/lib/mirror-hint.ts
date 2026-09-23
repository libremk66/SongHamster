/**
 * 镜像模式的说明文案（一处定义，四处引用，避免同一个概念四种说法）。
 *
 * 之前的问题：「镜像」这个词本身没说明代价，「处理1/2/3」又是凭空出现的黑话。
 * 这段话把因果连起来 —— 镜像 = LX 删了也同步 → 那删掉的歌去哪儿？→ 处理1/2/3。
 *
 * 「跌出」是榜单的说法；歌单是「移除」（歌不会从歌单里"跌出"）。
 */
export function mirrorHint(kind: 'playlist' | 'chart'): string {
  return kind === 'chart'
    ? '（LX 增/删都同步。请选择「跌出榜单」的歌曲去向：）'
    : '（LX 增/删都同步。请选择「从 LX 歌单移除」的歌曲去向：）'
}

/**
 * 单选项上**看得见**的短标题。
 * ⚠️ 这两个词是用户做选择时唯一能看到的区别，别再往这里加解释；
 *    解释统一放进「i」（InfoTip + modeHint）。
 */
export function modeLabel(mode: 'incremental' | 'mirror'): string {
  return mode === 'incremental' ? '增量同步' : '镜像同步'
}

/** 点「i」才展开的完整解释 */
export function modeHint(mode: 'incremental' | 'mirror', kind: 'playlist' | 'chart'): string {
  return mode === 'incremental'
    ? 'LX 新增 → 同步；LX 删除不处理，目标歌单只增不减'
    : mirrorHint(kind)
}
