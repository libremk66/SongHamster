/**
 * 本地路径 ↔ 媒体服务器路径的换算。
 *
 * ⚠️ **两个配置字段指的不是同一个目录，差一层「歌单同步」**，这是这块最容易搞错的点：
 *
 * ```
 * 本地（lxserver.downloadRoot）:  <下载目录>/歌单同步/<歌单名>/晴天.flac
 *                                      ↑ 这一层由 file-manager 拼，映射到服务器侧时会被去掉
 * 服务器（emby.libraryRoot）:      <媒体库根>/<歌单名>/晴天.flac
 * ```
 *
 * 所以 `downloadRoot` 填「歌单同步」的**父目录**、`libraryRoot` 填「歌单同步」**本身**。
 * 两边各自是**对应容器/进程的视角**，不是同一个字符串。
 *
 * ⚠️ 界面上的「测试连接」**验不出路径填错**（它只验 API 连通性），
 *    填错的后果要到真跑同步才暴露 —— 所以这两个字段只能照 docs/path-mapping.md 仔细填。
 *    （曾有过一个「路径自检」按钮，只验「目录存在且可写」，给的是一致性误导，已删除。）
 */
import path from 'node:path'
import type { AppConfig } from '../config.js'

/** Emby 条目路径 → 本项目可操作路径；映射不了返回 null */
export function localizeEmbyPath(cfg: AppConfig, embyPath: string): string | null {
  if (!embyPath || !cfg.lxserver.downloadRoot) return null
  const dl = cfg.lxserver.downloadRoot.replace(/\/+$/, '')
  const lib = cfg.emby.libraryRoot?.replace(/\/+$/, '')
  if (!lib) return null
  let rest = ''
  if (embyPath.startsWith(lib + '/')) {
    rest = embyPath.slice(lib.length) // 媒体库文件夹内
  } else {
    // 不在媒体库文件夹下：尝试按共享根推导（libraryRoot 与 downloadRoot 同源的前提）
    return null
  }
  // rest 形如 /歌单同步/我喜欢的/x.flac 或 /我喜欢的/x.flac
  if (rest.startsWith('/歌单同步')) return dl + rest
  return dl + '/歌单同步' + rest
}

/**
 * `localizeEmbyPath` 的逆运算：本地路径 → **媒体服务器视角**的路径。
 * 用途：入库时用「按路径精确查」定位条目（Emby 支持 /Items?Path= ），
 * 比按歌名搜再过滤可靠得多——常见歌名（如「此刻」）能搜出 55 条同名/含此词的歌，
 * 目标可能排在几十位之后，按歌名搜的小 limit 根本取不到（实测踩到）。
 * 不在 downloadRoot 下 / 未配置库根 → null（调用方回退到按歌名搜）。
 */
export function toServerPath(cfg: AppConfig, localPath: string): string | null {
  if (!localPath || !cfg.lxserver.downloadRoot) return null
  const dl = cfg.lxserver.downloadRoot.replace(/\/+$/, '')
  const lib = cfg.emby.libraryRoot?.replace(/\/+$/, '')
  if (!lib) return null
  if (!localPath.startsWith(dl + '/')) return null
  let rest = localPath.slice(dl.length) // 形如 /歌单同步/我喜欢的/x.flac
  if (rest.startsWith('/歌单同步')) rest = rest.slice('/歌单同步'.length)
  return lib + rest
}

