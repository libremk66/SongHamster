import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { LxServerAdapter } from '../adapters/lxserver.js'
import type { AppConfig } from '../config.js'

/**
 * LX 配置体检（连接页「配置体检」按钮）—— 把 path-mapping.md 里的已知判据做成界面反馈。
 *
 * 背景：原「测试连接」只打一次 /api/user/list，**验不出**三件事：
 *   ① token 是否有效（带 x-user-name 时 user/list 可能无鉴权也返回内容）
 *   ② 下载用户名是否正常（非 ASCII 会直接把下载打成异常）
 *   ③ 下载目录层级填得对不对（多/少一层要到真跑同步才暴露）
 * 体检用**只读**手段逐项检查，结论分级（ok/warn/bad/info），绝不造假绿灯：
 *   - 「目录存在」≠「层级对」，所以必须用 lxserver 的文件清单交叉验证（能验到的验到底）
 *   - 库为空 / 还没跑过同步时，如实说明「尚不能完全确认」，不硬判对错
 *
 * 关键事实（2026-10-17 读 lxserver 源码 + 实测确认）：
 *   - 下载落盘位置由 **token 归属用户**决定（music/<token用户名>），x-user-name 只作
 *     「私有/公共」开关（空 → 落到 _open 公共目录）；两者不一致时按 token 走
 *   - /api/user/auth/verify 是唯一能同时验 token + 返回归属用户的只读接口
 *   - cache/list 的 filename 相对「lxserver 视角的 music/<用户名>/」→ 可与本地
 *     downloadRoot 直接拼接验证（三方挂载是否指向同一物理目录的实锤）
 *
 * 2026-10-17 随「连接易上手」三件套第 2 件引入（调研见 docs/local/songhamster/connect-onboarding-research.md）。
 */

export type LxCheckStatus = 'ok' | 'warn' | 'bad' | 'info'

export interface LxCheckItem {
  status: LxCheckStatus
  /** 一句话结论（界面主行） */
  label: string
  /** 补充细节 / 原始错误（界面次行，可省） */
  detail?: string
  /** 修复指引（bad/warn 时给「该去改哪里」） */
  hint?: string
}

export interface LxCheckInput {
  baseUrl: string
  apiKey: string
  username: string
  downloadRoot: string
}

export interface LxCheckResult {
  items: LxCheckItem[]
  /** 整体结论：全部 ok/info → true；出现 warn/bad → false */
  ok: boolean
}

const stripSlash = (s: string) => s.replace(/\/+$/, '')

/** 「下载根」的特征：同时有「歌单同步/」和回收站目录（新名或旧名 .songferry-trash） */
function looksLikeDownloadRoot(dir: string): boolean {
  try {
    const names = readdirSync(dir)
    return names.includes('歌单同步') && (names.includes('.songhamster-trash') || names.includes('.songferry-trash'))
  } catch {
    return false
  }
}

export async function runLxCheck(input: LxCheckInput): Promise<LxCheckResult> {
  const items: LxCheckItem[] = []
  const baseUrl = stripSlash(String(input.baseUrl ?? '').trim())
  const apiKey = String(input.apiKey ?? '').trim()
  const username = String(input.username ?? '').trim()
  const downloadRoot = stripSlash(String(input.downloadRoot ?? '').trim())

  /** 用给定用户名构造只读适配器（体检全程不落盘、不写配置） */
  const makeAdapter = (uname: string) =>
    new LxServerAdapter(() => ({ lxserver: { baseUrl, apiKey, username: uname, downloadRoot } }) as unknown as AppConfig)

  // ── ① 必填项 ─────────────────────────────────────────────
  if (!baseUrl || !apiKey) {
    items.push({
      status: 'bad',
      label: '服务地址 / API key 未填',
      hint: '地址一般填到端口（如 http://127.0.0.1:19527）；API key 在 lxserver 后台「账户 → Token 管理」里生成',
    })
    return { items, ok: false }
  }

  // ── ② token 有效性 + 归属用户（auth/verify：唯一能验 token 的只读接口） ──
  let tokenUser: string | null = null
  try {
    const v = await makeAdapter(username).verifyAuth()
    if (v.valid && v.username) {
      tokenUser = v.username
      items.push({ status: 'ok', label: `API key 有效（归属用户：${v.username}）` })
    } else {
      items.push({
        status: 'bad',
        label: 'API key 无效或已过期',
        hint: '到 lxserver 后台「账户 → Token 管理」重新生成一个，粘贴回来再体检',
      })
    }
  } catch (e) {
    const msg = (e as Error).message
    const friendly = /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|socket hang up|network/i.test(msg)
      ? '无法连接：地址不通或 lxserver 未启动'
      : msg
    items.push({ status: 'bad', label: `连接失败（${friendly}）`, hint: '检查服务地址是否填对、lxserver 是否在运行' })
    return { items, ok: false }
  }

  // ── ③ 下载用户名 ────────────────────────────────────────
  if (!username) {
    items.push({
      status: 'bad',
      label: '下载用户名未填',
      hint: '不填会落到 lxserver 的公共目录（_open）；一般应填你的用户名（用户管理页可见）',
    })
  } else if (!/^[\x20-\x7e]+$/.test(username)) {
    // Node fetch 的请求头只接受 ByteString：非 ASCII 会直接抛异常（实测）
    items.push({
      status: 'bad',
      label: '下载用户名含非 ASCII 字符（中文等）',
      detail: 'lxserver 的 x-user-name 请求头不支持中文，下载请求会直接失败',
      hint: '改用 lxserver 里的英文用户名（用户管理页可见）',
    })
  } else if (tokenUser && tokenUser !== username) {
    items.push({
      status: 'warn',
      label: `下载用户名与 API key 归属用户不一致（key 属于「${tokenUser}」，你填的是「${username}」）`,
      detail: '下载以 key 的归属用户执行，落盘在它的目录；用户名只作「私有/公共」开关',
      hint: `下载目录应按「${tokenUser}」那一层填（如 …/${tokenUser}），或用「${tokenUser}」对应的用户核对配置`,
    })
  } else {
    items.push({ status: 'ok', label: `下载用户名「${username}」格式正常` })
  }

  // ── ④ 下载目录 ──────────────────────────────────────────
  let rootExists = false
  if (!downloadRoot) {
    items.push({
      status: 'bad',
      label: 'LX 下载目录未填',
      hint: '填「歌单同步」的父目录（本项目视角，如 /data/music/<用户名>）',
    })
  } else if (!path.isAbsolute(downloadRoot)) {
    items.push({
      status: 'bad',
      label: 'LX 下载目录不是绝对路径',
      detail: `当前填的是「${downloadRoot}」`,
      hint: '要填本项目（音乐仓鼠）视角的完整路径，如 /data/music/<用户名>',
    })
  } else if (!existsSync(downloadRoot)) {
    items.push({
      status: 'bad',
      label: '下载目录在本项目里不存在',
      detail: `${downloadRoot}（以音乐仓鼠的视角）不存在`,
      hint: '检查两处：① compose 里这个目录有没有挂进音乐仓鼠容器；② 路径是否少了用户名一层（如 /data/music/<用户名>）',
    })
  } else {
    rootExists = true
    const hasSync = existsSync(path.join(downloadRoot, '歌单同步'))
    const hasTrash =
      existsSync(path.join(downloadRoot, '.songhamster-trash')) || existsSync(path.join(downloadRoot, '.songferry-trash'))
    if (hasSync && hasTrash) {
      items.push({ status: 'ok', label: '下载目录存在，且含「歌单同步/」+ 回收站特征（层级正确）' })
    } else if (hasSync || hasTrash) {
      items.push({
        status: 'warn',
        label: `下载目录存在，但特征目录不全（歌单同步：${hasSync ? '有' : '无'}；回收站：${hasTrash ? '有' : '无'}）`,
        hint: '若还没跑过同步，属于正常（首次同步会自动建）；跑过一次后仍是这样就核对层级',
      })
    } else {
      items.push({
        status: 'info',
        label: '下载目录存在，但还没看到「歌单同步/」与回收站特征目录',
        hint: '目录看起来是新的 —— 跑一次同步会自动建；若之前跑过同步却仍没有，多半是层级填错',
      })
    }

    // ── ⑤ 层级错位线索（多/少一层是最高频的坑） ──
    const clues: string[] = []
    if (!looksLikeDownloadRoot(downloadRoot)) {
      const parent = path.dirname(downloadRoot)
      const children = (() => {
        try {
          return readdirSync(downloadRoot, { withFileTypes: true })
            .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
            .map((d) => d.name)
        } catch {
          return []
        }
      })()
      // 少了一层：子目录里有完整特征（如 downloadRoot 填成 …/music，实际是 …/music/<用户名>）
      const childHits = children.filter((c) => looksLikeDownloadRoot(path.join(downloadRoot, c)))
      if (childHits.length) {
        clues.push(`它下面这层才是对的：${childHits.map((c) => `${downloadRoot}/${c}`).join('、')}（缺少用户名一层）`)
      }
      // 多了一层：父目录有完整特征（如 downloadRoot 填成 …/<用户名>/歌单同步，实际是 …/<用户名>）
      if (parent !== downloadRoot && parent !== '/' && looksLikeDownloadRoot(parent)) {
        clues.push(`它上一层才是对的：${parent}（多填了「歌单同步」一层）`)
      }
    }
    if (clues.length) {
      items.push({
        status: 'warn',
        label: '检测到层级错位的线索',
        detail: clues.join('；'),
        hint: '下载目录要填「歌单同步」的父目录 —— 那一层下面应同时有「歌单同步/」和回收站目录',
      })
    }
  }

  // ── ⑥ 与 lxserver 实际文件交叉验证（三方挂载是否同一物理目录的实锤） ──
  if (rootExists && tokenUser) {
    try {
      // 用 token 归属用户读清单：下载实际就落在他名下（x-user-name 不影响落盘位置）
      const files = await makeAdapter(tokenUser).listFiles()
      const music = files.filter((f) => f.folder === 'music' && f.filename && f.size > 0)
      if (music.length === 0) {
        items.push({
          status: 'info',
          label: 'lxserver 下载目录里还没有文件，无法交叉验证路径映射',
          hint: '先跑一次同步，或先手动下载一首 —— 有文件后回来体检，这项能验得更实',
        })
      } else {
        // 优先抽近期、非回收站的文件（旧文件可能被手动挪走，产生陈旧索引噪音）
        const normal = music.filter((f) => !f.filename.startsWith('.'))
        const sample = (normal.length ? normal : music).sort((a, b) => b.mtime - a.mtime).slice(0, 20)
        const missing = sample.filter((f) => !existsSync(path.join(downloadRoot, f.filename)))
        const okCount = sample.length - missing.length
        if (missing.length === 0) {
          items.push({
            status: 'ok',
            label: `抽检 ${sample.length} 个 lxserver 文件，全部在下载目录中找到（三方挂载与路径映射实测通过）`,
          })
        } else if (okCount > 0) {
          items.push({
            status: 'warn',
            label: `抽检 ${sample.length} 个 lxserver 文件，${missing.length} 个在下载目录中找不到`,
            detail: `例：${missing[0].filename}`,
            hint: '可能已被移走/删除（回收站里）；若同步报「源文件不存在」，重点查这里',
          })
        } else {
          items.push({
            status: 'bad',
            label: `lxserver 上有 ${music.length} 个文件，但在下载目录里一个都找不到`,
            detail: `例：${missing[0].filename}`,
            hint: `「LX 下载目录」不是 lxserver 落盘的那个目录 —— 它实际落盘在（它视角的）music/${tokenUser}，核对层级与挂载`,
          })
        }
      }
    } catch (e) {
      items.push({
        status: 'warn',
        label: `读取 lxserver 文件清单失败（${(e as Error).message}）`,
        hint: '不影响其它检查项；多为 lxserver 暂时不可用，稍后重试',
      })
    }
  }

  return { items, ok: !items.some((i) => i.status === 'warn' || i.status === 'bad') }
}
