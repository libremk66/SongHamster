import { Router } from 'express'
import type { AppConfig, ListenParams, Quality } from '../config.js'
import { QUALITY_ORDER, QUALITY_LABELS, TARGET_LABEL, DEFAULT_ARCHIVE_PLAYLIST, isArchiveTemplate, resolveArchiveName, archiveNameOf, supportsFileDelete } from '../config.js'
import { saveConfig } from '../config.js'
import { LxServerAdapter } from '../adapters/lxserver.js'
import type { MediaServerAdapter } from '../adapters/media-server.js'
import { EmbyAdapter } from '../adapters/emby.js'
import { NavidromeAdapter } from '../adapters/navidrome.js'
import { DaoliyuAdapter } from '../adapters/daoliyu.js'
import { SubsonicAdapter } from '../adapters/subsonic.js'
import * as repo from '../store/repo.js'
import { SyncEngine, RUN_BLOCKED } from '../core/sync-engine.js'
import { Scheduler } from '../scheduler/index.js'
import { listenScan, originOfMode } from '../core/listen.js'
import { hashPassword, verifyPassword } from '../auth.js'
import { listTrash, restoreFromTrash, purgePath } from '../core/trash.js'
import { localizeEmbyPath } from '../core/paths.js'
import * as HMeta from '../core/history-meta.js'
import { NOTIFY_EVENTS, CHANNEL_LABEL, CHANNEL_GROUPS, testChannel, type NotifyChannelType, type NotifyConfig } from '../core/notify.js'
import { applyDeletion, reportLine } from '../core/delete.js'
import { SERVER_SPECS, specOf } from '../core/server-spec.js'
import { logger } from '../core/logger.js'
import { getDb, taskSemantics } from '../store/db.js'

const bool = (v: unknown) => v === '1' || v === true || v === 1
// 表单复选:隐藏 0 占位 + 勾选 1 → qs 解析为数组;任一 '1' 即 true(未勾选只发 [0] → false)
const boolV = (v: unknown): boolean => (Array.isArray(v) ? v.some((x) => x === '1' || x === true || x === 1) : bool(v))


export function apiRouter(
  cfg: AppConfig,
  lx: LxServerAdapter,
  emby: MediaServerAdapter,
  engine: SyncEngine,
  scheduler: Scheduler,
): Router {
  const r = Router()

  /** 服务器视角路径 → 宿主机可操作路径（按 target 分支；映射不了返回 null）
   * Navidrome：path 相对媒体库根（约定库根 = downloadRoot 同源）；绝对路径走 Emby 逻辑兜底 */
  const localizePath = (serverPath: string): string | null => {
    if (!serverPath) return null
    const dl = cfg.lxserver.downloadRoot?.replace(/\/+$/, '')
    if (!dl) return null
    if (cfg.target === 'navidrome') {
      if (!serverPath.startsWith('/')) return dl + '/' + serverPath
      return serverPath.startsWith(dl) ? serverPath : localizeEmbyPath(cfg, serverPath)
    }
    if (cfg.target === 'jellyfin') {
      // 与 Emby 同源：libraryRoot（jellyfin 段）前缀 → downloadRoot
      const lib = cfg.jellyfin.libraryRoot?.replace(/\/+$/, '')
      if (lib && serverPath.startsWith(lib + '/')) return dl + serverPath.slice(lib.length)
      return serverPath.startsWith(dl) ? serverPath : null
    }
    if (cfg.target === 'daoliyu') {
      // filePath 为容器内绝对路径（与 downloadRoot 同源）：libraryRoot 前缀 → downloadRoot
      const lib = cfg.daoliyu.libraryRoot?.replace(/\/+$/, '')
      if (lib && serverPath.startsWith(lib + '/')) return dl + serverPath.slice(lib.length)
      return serverPath.startsWith(dl) ? serverPath : null
    }
    return localizeEmbyPath(cfg, serverPath)
  }

  // ===== 下载选项 / 保护：新旧端点共用的保存逻辑 =====
  const saveDownloadOptions = (b: Record<string, unknown>) => {
    const qs = Array.isArray(b.qualities) ? b.qualities : b.qualities ? [b.qualities] : []
    const valid: Quality[] = QUALITY_ORDER.filter((q) => qs.includes(q)) as Quality[]
    if (!valid.length) return { ok: false as const, message: '至少勾选一种音质' }
    cfg.download.qualities = valid
    cfg.download.filenameTemplate = String(b.filenameTemplate ?? '').trim() || cfg.download.filenameTemplate
    cfg.download.embedLyric = bool(b.embedLyric)
    cfg.download.cacheLyric = bool(b.cacheLyric)
    saveConfig(cfg)
    logger.info(`[config] 下载选项：音质=${valid.join('>')} 模板=${cfg.download.filenameTemplate} 歌词=${cfg.download.embedLyric ? '内嵌' : ''}${cfg.download.cacheLyric ? '+外置' : ''}（标签/封面由 LX 服务端始终写入；下载逐首串行、无自动重试）`)
    return { ok: true as const, message: '下载选项已保存' }
  }

  // 批量下载保护保存逻辑（同上，新旧共用）
  const saveProtection = (b: Record<string, unknown>) => {
    cfg.download.protection.enabled = bool(b.enabled)
    const dl = Number(b.downloadIntervalSec)
    const rs = Number(b.resolveIntervalSec)
    cfg.download.protection.downloadIntervalSec = Math.min(60, Math.max(2, dl || 5))
    cfg.download.protection.resolveIntervalSec = Math.min(30, Math.max(1, rs || 2))
    saveConfig(cfg)
    return { ok: true as const, message: '保护设置已保存' }
  }


  // ===== 连接媒体服务器（统一分区：选项卡切类型 + 确定一键"存→测→探测→设为目标"）=====
  const serverVals = (type: string): Record<string, string> => {
    const c = (cfg as unknown as Record<string, Record<string, string>>)[type] ?? {}
    return {
      baseUrl: c.baseUrl ?? '', apiKey: c.apiKey ?? '', username: c.username ?? '', password: c.password ?? '', libraryRoot: c.libraryRoot ?? '',
    }
  }
  /** 解析表单里的「目标歌单归属」：'shared' 或 'id|名字'；返回 { scope, name } */
  const parseScope = (raw: unknown): { scope: string; name: string } => {
    const v = String(raw ?? '').trim()
    if (!v || v === 'shared') return { scope: 'shared', name: '共享（所有人可见）' }
    const [id, nm] = v.split('|')
    return { scope: id || 'shared', name: nm || id }
  }


  /** 按类型把表单字段写进对应配置段（与各 /config/* 保持同一套字段名） */
  const applyServerCfg = (type: string, b: Record<string, unknown>): void => {
    const g = (k: string) => String(b[k] ?? '').trim()
    if (type === 'emby') {
      cfg.emby.baseUrl = g('baseUrl'); cfg.emby.apiKey = g('apiKey'); cfg.emby.libraryRoot = g('libraryRoot')
    } else if (type === 'jellyfin') {
      cfg.jellyfin.baseUrl = g('baseUrl'); cfg.jellyfin.apiKey = g('apiKey'); cfg.jellyfin.libraryRoot = g('libraryRoot')
    } else if (type === 'navidrome') {
      cfg.navidrome.baseUrl = g('baseUrl'); cfg.navidrome.username = g('username'); cfg.navidrome.password = g('password'); cfg.navidrome.libraryRoot = g('libraryRoot')
    } else if (type === 'daoliyu') {
      cfg.daoliyu.baseUrl = g('baseUrl'); cfg.daoliyu.username = g('username'); cfg.daoliyu.password = g('password'); cfg.daoliyu.libraryRoot = g('libraryRoot')
    } else if (type === 'subsonic') {
      cfg.subsonic.baseUrl = g('baseUrl'); cfg.subsonic.username = g('username'); cfg.subsonic.password = g('password')
    }
  }
  const adapterOf = (type: string): MediaServerAdapter =>
    type === 'emby' ? emby
      : type === 'jellyfin' ? new EmbyAdapter(() => cfg, 'jellyfin')
        : type === 'navidrome' ? new NavidromeAdapter(() => cfg)
          : type === 'daoliyu' ? new DaoliyuAdapter(() => cfg)
            : new SubsonicAdapter(() => cfg)

  /** 把底层报错翻成人话（让用户知道该去改哪个字段） */
  const friendlyErr = (e: string): string =>
    /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|socket hang up|network/i.test(e)
      ? '无法连接：地址不通或服务未启动'
      : /\b401\b|\b403\b|unauthor/i.test(e)
        ? '鉴权失败：API key / 账号密码不正确'
        : /\b404\b/.test(e)
          ? '接口返回 404：地址可能多写了路径（一般填到端口即可）'
          : e

  /** 「确定」的结果：level 决定前端提示样式，ok 决定要不要刷新页面数据 */
  type ApplyResult = { ok: boolean; level: 'ok' | 'warn' | 'bad'; message: string }

  /**
   * 确定 = 保存该服务器配置 → 测试连接 → 探测媒体库 → 全部通过才设为同步目标。
   * 任一步不通过都不切换目标（避免把同步指向一台连不上/库没匹配的服务器）。
   * 新旧端点共用本函数，避免「保存→测→探测」这套顺序逻辑两处各写一遍。
   */
  const applyServer = async (type: string, b: Record<string, unknown>): Promise<ApplyResult> => {
    const spec = specOf(type)
    if (!spec) return { ok: false, level: 'bad', message: '未知的媒体服务器类型' }
    applyServerCfg(spec.key, b)
    saveConfig(cfg)
    const ad = adapterOf(spec.key)
    let connErr = ''
    try {
      const t = await ad.test()
      if (!t.ok) connErr = t.error ?? '未知错误'
    } catch (e) {
      connErr = (e as Error).message
    }
    if (connErr) return { ok: false, level: 'bad', message: `${spec.label} 连接失败，请检查媒体服务器信息（${friendlyErr(connErr)}）` }
    // 媒体库探测（Subsonic 无媒体库概念，跳过）
    if (spec.probePath) {
      try {
        const libs = await ad.listLibraries()
        const id = await ad.resolveLibraryId()
        if (!id) {
          const list = libs.map((l) => l.name).join('、')
          return { ok: false, level: 'warn', message: `${spec.label} 已连接，但媒体库根路径未匹配到库${list ? `（现有：${list}）` : '（该服务器上还没有音乐库）'}，请核对后重按「确定」；同步目标未切换` }
        }
      } catch (e) {
        return { ok: false, level: 'warn', message: `${spec.label} 已连接，但探测媒体库出错（${(e as Error).message}）；同步目标未切换` }
      }
    }
    if (cfg.target !== spec.key) {
      // 条目 Id 体系随服务器不同（Emby 数字 / Navidrome base64 …）→ 换目标必须作废缓存
      const n = repo.clearAllEmbyMap()
      if (n) logger.info(`[connect] 同步目标 ${cfg.target} → ${spec.key}：已清空 ${n} 条媒体库条目缓存（换服务器后 Id 不再有效）`)
      else logger.info(`[connect] 同步目标切换为 ${spec.key}`)
    }
    cfg.target = spec.key
    if (spec.key === 'emby' || spec.key === 'jellyfin') {
      const id = await ad.resolveLibraryId().catch(() => null)
      if (id) (spec.key === 'emby' ? cfg.emby : cfg.jellyfin).mediaLibraryId = id
    }
    if (spec.key === 'navidrome') {
      const id = await ad.resolveLibraryId().catch(() => null)
      if (id) cfg.navidrome.libraryId = id
    }
    saveConfig(cfg)
    logger.info(`[connect] ${spec.label} 已连接并设为同步目标（${cfg[spec.key === 'jellyfin' ? 'jellyfin' : spec.key].baseUrl}）`)
    return { ok: true, level: 'ok', message: `${spec.label} 已连接，已设为同步目标` }
  }


  // ===== 连接容器（JSON 版，React SPA 用）=====
  r.get('/connect', (_req, res) => {
    res.json({
      lx: {
        baseUrl: cfg.lxserver.baseUrl,
        apiKey: cfg.lxserver.apiKey,
        username: cfg.lxserver.username,
        downloadRoot: cfg.lxserver.downloadRoot,
      },
      target: cfg.target,
      servers: SERVER_SPECS.map((s) => ({
        key: s.key,
        label: s.label,
        short: s.short,
        apiKeyAuth: s.apiKeyAuth,
        fields: s.fields,
        values: serverVals(s.key),
      })),
    })
  })

  r.post('/connect/lx', (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    cfg.lxserver.baseUrl = String(b.baseUrl ?? '').trim()
    cfg.lxserver.apiKey = String(b.apiKey ?? '').trim()
    cfg.lxserver.username = String(b.username ?? 'admin').trim() || 'admin'
    cfg.lxserver.downloadRoot = String(b.downloadRoot ?? '').trim()
    saveConfig(cfg)
    res.json({ ok: true, message: 'LX 连接配置已保存' })
  })

  r.post('/connect/test-lx', async (_req, res) => {
    const t = await lx.test()
    res.json(t.ok ? { ok: true, message: 'LX 连接正常' } : { ok: false, message: `LX ${t.error}` })
  })

  r.post('/connect/apply-json', async (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    const r = await applyServer(String(b.type ?? ''), b)
    res.json({ ...r, target: cfg.target })
  })

  r.post('/connect/paths-check', async (_req, res) => {
    res.json({ lines: await runPathCheck() })
  })

  // ===== 榜单订阅 API =====
  // 平台显示名：统一用**短名**（`QQ·新歌榜`，不是 `QQ音乐·新歌榜`），
  // 也是榜单任务没填名字时的兜底名。改这里会让新旧任务名不一致，别随手动。
  // 没有 bd：lxserver 已停用百度（详见 adapters/lxserver.ts 的 chartPlatforms 注释）
  const PLAT_LABEL: Record<string, string> = { tx: 'QQ', kw: '酷我', wy: '网易云', kg: '酷狗', mg: '咪咕' }


  // ===== 任务 CRUD =====
  async function lxKeyToName(): Promise<Record<string, string>> {
    const map: Record<string, string> = {}
    try {
      for (const p of await lx.listPlaylists()) map[p.key] = p.name
    } catch { /* LX 未连接 */ }
    return map
  }


  /** 是否存在"自动纳入"机制（决定删除任务时是否提示「永久忽略」） */
  function autoWatchOn(): boolean {
    return cfg.general.listen.enabled
  }


  // ===== 歌单同步任务（JSON 版，React SPA 用）=====
  // 路径用复数 /tasks/:id/*，与旧页面的单数 /task/:id/*（返回 HTML 片段）区分
  r.get('/tasks', async (req, res) => {
    const scope = String(req.query.scope ?? 'playlist')
    const keyToName = await lxKeyToName()
    const idToName: Record<string, string> = {}
    try {
      for (const p of await emby.listPlaylists()) idToName[p.id] = p.name
    } catch { /* 媒体服务器未连接时退回显示 id */ }
    const lastBatch: Record<number, repo.BatchRow> = {}
    for (const b of repo.listBatches(undefined, 300)) if (!(b.taskId in lastBatch)) lastBatch[b.taskId] = b
    const tasks = repo
      .listTasks()
      .filter((t) => t.taskType !== 'adhoc')
      .filter((t) => scope !== 'playlist' || t.taskType === 'playlist')
      .map((t) => {
        // 兜底：任务名缺失或仍是 key（旧数据/创建时未解析）→ 用 LX 歌单真实名称
        const looksKey = !t.lxPlaylistName || t.lxPlaylistName === t.lxPlaylistKey || t.lxPlaylistName.startsWith('user:') || t.lxPlaylistName === 'loveList'
        const sem = taskSemantics(t)
        const lb = lastBatch[t.id]
        const ids = t.embyTargetPlaylistIdsParsed
        return {
          id: t.id,
          taskType: t.taskType,
          lxPlaylistKey: t.lxPlaylistKey,
          lxPlaylistName: looksKey ? keyToName[t.lxPlaylistKey] ?? t.lxPlaylistKey : t.lxPlaylistName,
          targetIds: ids,
          targetNames: ids.map((pid) => idToName[pid] ?? pid),
          createSameNamePlaylist: !!t.createSameNamePlaylist,
          /** 榜单订阅专有：取榜单前 N 首；歌单任务为 null */
          maxCount: t.taskType === 'chart' ? t.maxCount : null,
          /**
           * 榜单订阅专有：平台代码 + 榜单原名。
           * 卡片左上角要分两行显示「QQ / 新歌榜」，**不能去拆 lxPlaylistName** ——
           * 那是任务名，用户随时能改（改成「我追的榜」就拆不出来了），这里给原始字段。
           */
          chartSource: t.taskType === 'chart' ? t.chartSource : null,
          chartName: t.taskType === 'chart' ? t.chartName : null,
          /** 卡片配图：这个任务下最多 4 首歌的 songKey（前端拼成 2×2 封面墙） */
          coverKeys: repo.listTaskSongKeys(t.id).slice(0, 4),
          /** 编辑弹框要用：归档目标与歌单归属（卡片不显示，但改的时候得回填） */
          archivePlaylist: t.archivePlaylist ?? '',
          playlistScope: t.playlistScope ?? 'shared',
          playlistScopeName: t.playlistScopeName ?? '共享（所有人可见）',
          cronExpr: t.cronExpr,
          enabled: !!t.enabled,
          mode: sem.taskMode,
          delPolicy: sem.delPolicy,
          lastBatch: lb
            ? {
                id: lb.id,
                startedAt: lb.startedAt,
                result: lb.result,
                okCount: lb.okCount,
                failCount: lb.failCount,
                unsatisfiedCount: lb.unsatisfiedCount,
              }
            : null,
        }
      })
    const live = engine.live
    res.json({
      tasks,
      targetName: TARGET_LABEL[cfg.target] ?? 'Emby',
      fileDeleteOK: supportsFileDelete(cfg.target),
      targetKey: cfg.target,
      /** 「目标歌单归属」下拉只在按用户存歌单的服务器上有意义 */
      scopeUI: cfg.target === 'emby' || cfg.target === 'jellyfin',
      defaultArchive: DEFAULT_ARCHIVE_PLAYLIST,
      /*
        榜单平台清单也从后端给，别让前端再硬编码一份。
        ⚠️ 前端原来自己写了一份 6 个平台的列表，**和这里重复**——lxserver 停用百度后
           两边改一处漏一处（bd 白列了很久，点进去必报 "try max num"）。
           现在只有 adapters/lxserver.ts 的 chartPlatforms() 一个来源。
      */
      platforms: await lx.chartPlatforms(),
      live:
        live && live.finishedAt === null
          ? { taskId: live.taskId, taskName: live.taskName, phase: live.phase, done: live.done, total: live.total }
          : null,
    })
  })

  r.post('/tasks/:id/run', async (req, res) => {
    const id = Number(req.params.id)
    const t = repo.getTask(id)
    if (!t) return res.status(404).json({ ok: false, message: '任务不存在' })
    // 先用引擎的预检拿准确原因再回复：不能"先答应已开始、引擎再静默退出"
    const blocked = engine.checkRun(id, 'manual')
    if (blocked) return res.json({ ok: false, message: RUN_BLOCKED[blocked] ?? '无法运行' })
    const wasDisabled = !t.enabled
    void engine.runTask(id, 'manual')
    res.json({ ok: true, message: `已开始同步${wasDisabled ? '（该任务处于停用状态，本次为手动单次运行，不影响定时）' : ''}——进度见「进度历史」页` })
  })

  r.post('/tasks/:id/toggle', (req, res) => {
    const id = Number(req.params.id)
    const t = repo.getTask(id)
    if (!t) return res.status(404).json({ ok: false, message: '任务不存在' })
    repo.updateTask(id, { enabled: t.enabled ? 0 : 1 })
    scheduler.reload()
    res.json({ ok: true, message: t.enabled ? '已停用' : '已启用' })
  })

  r.post('/tasks/:id/delete', async (req, res) => {
    const id = Number(req.params.id)
    const t = repo.getTask(id)
    if (!t) return res.status(404).json({ ok: false, message: '任务不存在' })
    if (engine.isRunning) return res.json({ ok: false, message: '有任务正在运行，稍后再删除（避免和同步过程抢同一批文件）' })
    const body = (req.body ?? {}) as Record<string, unknown>
    const opts = { file: bool(body.file), playlist: bool(body.playlist), history: bool(body.history) }
    const rep = await applyDeletion({
      cfg,
      emby,
      targets: repo.listTaskSongKeys(id).map((songKey) => ({ taskId: id, songKey })),
      itemIds: repo.listHistoryItemIds(id),
      opts,
    })
    repo.deleteTask(id, { keepHistory: !opts.history })
    scheduler.reload()
    logger.info(`[task] 删除任务 #${id}「${t.lxPlaylistName}」（文件=${opts.file ? '删' : '留'} 歌单=${opts.playlist ? '移除' : '留'} 历史=${opts.history ? '删' : '留'}${bool(body.ignore) ? ' ·永久忽略' : ''}）｜${reportLine(rep)}`)
    if (t.lxPlaylistKey.startsWith('user:') && bool(body.ignore)) {
      const key = t.lxPlaylistKey
      // 旧 autoadd 已删。以前这里得同时写 listen 和 autoadd 两份忽略列表
      // （只写 autoadd 会导致监听模式下删了又被重建）—— 现在只剩 listen 一份。
      const list = cfg.general.listen.ignoredKeys
      if (!list.includes(key)) {
        list.push(key)
        saveConfig(cfg)
      }
    }
    res.json({ ok: true, message: `已删除任务「${t.lxPlaylistName}」（${reportLine(rep)}）` })
  })

  /**
   * 批量建任务（新旧端点共用）。返回结构化结果，由调用方决定怎么呈现。
   */
  const createTasks = async (b: Record<string, unknown>) => {
    const raw = b.lxPlaylistKey
    const keys = (Array.isArray(raw) ? raw : raw ? [raw] : []).map(String).filter(Boolean)
    if (!keys.length) return { ok: false as const, message: '未选择 LX 歌单', created: [] as string[], skipped: [] as string[] }
    const keyToName = await lxKeyToName()
    const existing = new Set(repo.listTasks().map((t) => t.lxPlaylistKey))
    const created: string[] = []
    const skipped: string[] = []
    let archiveNote = ''
    for (const key of keys) {
      if (existing.has(key)) { skipped.push(keyToName[key] ?? key); continue }
      const name = keyToName[key] ?? key
      repo.createTask({
        lxPlaylistKey: key,
        lxPlaylistName: name,
        embyTargetPlaylistIds: (Array.isArray(b.embyTarget) ? b.embyTarget : b.embyTarget ? [b.embyTarget] : []).map(String),
        createSameNamePlaylist: bool(b.createSameNamePlaylist),
        cronExpr: String(b.cronExpr ?? '').trim() || null,
        syncMode: b.syncMode === 'full' ? 'full' : 'incremental',
        mode: b.mode === 'mirror' || b.mode === 'incremental' ? b.mode : undefined,
        delPolicy: ['keep', 'delete', 'archive'].includes(String(b.delPolicy)) ? (b.delPolicy as 'keep' | 'delete' | 'archive') : undefined,
        archivePlaylist: String(b.archivePlaylist ?? '').trim() || undefined,
        taskType: 'playlist',
      })
      created.push(name)
      // 归档目标：配置期创建（含 [歌单名] 占位符时按来源逐个建）
      if (b.delPolicy === 'archive') {
        const an = resolveArchiveName(String(b.archivePlaylist ?? ''), name)
        const ar = await engine.ensureArchiveTarget(an, parseScope(b.playlistScope).scope)
        if (ar.created) archiveNote = `；已创建归档歌单「${an}」`
        else if (!ar.ok) archiveNote = `；归档歌单「${an}」创建失败：${ar.error}`
      }
    }
    scheduler.reload()
    if (!created.length) {
      return { ok: false as const, message: `所选歌单均已有任务：${skipped.join('、')}`, created, skipped }
    }
    return {
      ok: true as const,
      message: `已创建 ${created.length} 个任务：${created.join('、')}${archiveNote}${skipped.length ? `（已跳过已存在：${skipped.join('、')}）` : ''}`,
      created,
      skipped,
    }
  }

  // 批量创建(选择歌单多选):一次为多个 LX 歌单建同步任务(同默认设置)
  

  // ===== 创建任务所需的下拉/多选数据（JSON 版，React SPA 用）=====
  r.get('/options/lx-playlists', async (_req, res) => {
    try {
      const ps = await lx.listPlaylists()
      res.json({ ok: true, playlists: ps.map((p) => ({ key: p.key, name: p.name, songCount: p.songCount })) })
    } catch (e) {
      res.json({ ok: false, message: (e as Error).message, playlists: [] })
    }
  })

  /** 目标歌单归属候选：用表单里当前填的地址/key 拉（还没保存也能用） */
  r.get('/options/scopes', async (req, res) => {
    const type = String(req.query.type ?? 'emby')
    const pick = (v: unknown, fb: string) => (v === undefined || v === '' ? fb : String(v))
    const tmp: AppConfig =
      type === 'jellyfin'
        ? { ...cfg, jellyfin: { ...cfg.jellyfin, baseUrl: pick(req.query.baseUrl, cfg.jellyfin.baseUrl), apiKey: pick(req.query.apiKey, cfg.jellyfin.apiKey) } }
        : { ...cfg, emby: { ...cfg.emby, baseUrl: pick(req.query.baseUrl, cfg.emby.baseUrl), apiKey: pick(req.query.apiKey, cfg.emby.apiKey) } }
    try {
      const ad = new EmbyAdapter(() => tmp, type === 'jellyfin' ? 'jellyfin' : 'emby')
      const users = (await ad.listUsers()) ?? []
      res.json({ ok: true, users: users.map((u) => ({ id: u.id, name: u.name })) })
    } catch (e) {
      res.json({ ok: false, message: (e as Error).message, users: [] })
    }
  })

  /** 「同步到已有歌单」候选：随作用域变化 */
  r.get('/options/playlists', async (req, res) => {
    try {
      const scope = parseScope(req.query.playlistScope ?? req.query.scope ?? 'shared').scope
      const ps = await emby.listPlaylists(scope)
      res.json({ ok: true, playlists: ps.map((p) => ({ id: p.id, name: p.name })) })
    } catch (e) {
      res.json({ ok: false, message: (e as Error).message, playlists: [] })
    }
  })

  r.post('/tasks/create', async (req, res) => {
    const r = await createTasks((req.body ?? {}) as Record<string, unknown>)
    res.status(r.ok ? 200 : 400).json(r)
  })

  // ===== 榜单订阅（JSON 版，React SPA 用）=====
  r.get('/charts/boards-json', async (req, res) => {
    try {
      res.json({ ok: true, boards: await lx.getChartBoards(String(req.query.source ?? 'tx')) })
    } catch (e) {
      res.json({ ok: false, message: (e as Error).message, boards: [] })
    }
  })

  r.get('/charts/songs-json', async (req, res) => {
    const source = String(req.query.source ?? 'tx')
    const bangid = String(req.query.bangid ?? '')
    try {
      const songs = await lx.getChartSongs(source, bangid)
      const downloaded = repo.listDownloadedKeys()
      res.json({
        ok: true,
        songs: songs.map((sg) => ({
          songKey: sg.songKey,
          name: sg.name,
          singer: sg.singer,
          album: sg.albumName ?? '',
          best: sg.qualities?.length ? sg.qualities[sg.qualities.length - 1] : '',
          downloaded: downloaded.has(sg.songKey),
        })),
      })
    } catch (e) {
      res.json({ ok: false, message: (e as Error).message, songs: [] })
    }
  })

  r.post('/charts/subscribe', async (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    const chartSource = String(b.chartSource ?? '').trim()
    const chartId = String(b.chartId ?? '').trim()
    const chartName = String(b.chartName ?? '').trim()
    if (!chartSource || !chartId) return res.status(400).json({ ok: false, message: '请选择平台与榜单' })
    const key = `chart:${chartSource}:${chartId}`
    const dup = repo.listTasks().find((t) => t.lxPlaylistKey === key)
    if (dup) return res.status(400).json({ ok: false, message: `该榜单已订阅（任务「${dup.lxPlaylistName}」）` })
    const name = String(b.lxPlaylistName ?? '').trim() || `${PLAT_LABEL[chartSource] ?? chartSource}·${chartName}`
    const sc = parseScope(b.playlistScope)
    const mirror = b.mode === 'mirror'
    repo.createTask({
      lxPlaylistKey: key,
      lxPlaylistName: name,
      embyTargetPlaylistIds: (Array.isArray(b.embyTarget) ? b.embyTarget : b.embyTarget ? [b.embyTarget] : []).map(String),
      createSameNamePlaylist: bool(b.createSameNamePlaylist),
      cronExpr: String(b.cronExpr ?? '').trim() || null,
      syncMode: mirror ? 'full' : 'incremental',
      mode: mirror ? 'mirror' : 'incremental',
      delPolicy: ['keep', 'delete', 'archive'].includes(String(b.delPolicy)) ? (b.delPolicy as 'keep' | 'delete' | 'archive') : undefined,
      archivePlaylist: String(b.archivePlaylist ?? '').trim() || undefined,
      taskType: 'chart',
      chartSource,
      chartId,
      chartName,
      maxCount: Math.max(0, Number(b.maxCount) || 30),
      playlistScope: sc.scope,
      playlistScopeName: sc.name,
    } as never)
    scheduler.reload()
    logger.info(`[task] 新建榜单订阅「${name}」${mirror ? ' 镜像' : ' 增量'}`)
    // 配置期创建归档目标（运行期只找不建）
    let note = ''
    if (mirror && b.delPolicy === 'archive') {
      const an = resolveArchiveName(String(b.archivePlaylist ?? ''), name)
      const ar = await engine.ensureArchiveTarget(an, sc.scope)
      if (ar.created) note = `；已创建归档歌单「${an}」`
      else if (!ar.ok) note = `；归档歌单「${an}」创建失败：${ar.error}`
    }
    res.json({ ok: true, message: `已订阅「${name}」${note}` })
  })

  r.post('/charts/download-json', async (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    const source = String(b.source ?? '')
    const bangid = String(b.bangid ?? '')
    const keys = (Array.isArray(b.songKeys) ? b.songKeys : []).map(String).filter(Boolean)
    if (!source || !bangid || !keys.length) return res.status(400).json({ ok: false, message: '参数缺失（source/bangid/songKeys）' })
    if (engine.isRunning) return res.json({ ok: false, message: '已有任务在运行（全局单飞），请稍后再试' })
    const want = new Set(keys)
    const full = await lx.getChartSongs(source, bangid)
    const songs = full.filter((sg) => want.has(sg.songKey))
    if (!songs.length) return res.json({ ok: false, message: '所选歌曲均无法从榜单解析（可能已跌出榜单），请刷新后重试' })
    void engine
      .runManualDownload(songs)
      .then((r) => logger.info(`[charts] 手动下载后台完成: ok=${r.ok} fail=${r.fail} dup=${r.dup} unsatisfied=${r.unsatisfied}`))
      .catch((e) => logger.warn(`[charts] 手动下载失败: ${(e as Error).message}`))
    res.json({ ok: true, message: `已提交 ${songs.length} 首下载（后台进行，进度见「进度历史」；仅入库不入歌单）` })
  })

  


  /**
   * 删除任务（三个复选框：文件 / 歌单 / 历史记录）。
   * 顺序要紧：先 applyDeletion（读得到本任务的归属与引用），再 deleteTask（把任务行收掉）。
   */
  

  // 保存编辑
  /** 保存任务编辑（新旧端点共用）。返回 {ok, message}，HTML 版自己决定怎么呈现。 */
  const updateTaskFromBody = async (id: number, b: Record<string, unknown>): Promise<{ ok: boolean; message: string }> => {
    scheduler.reload()
    const t = repo.getTask(id)
    if (!t) return { ok: false, message: '任务不存在' }
    if (t.taskType === 'chart') {
      const chMode = b.mode === 'mirror' || b.mode === 'incremental' ? (b.mode as 'mirror' | 'incremental') : null
      const chDel = ['keep', 'delete', 'archive'].includes(String(b.delPolicy)) ? (b.delPolicy as 'keep' | 'delete' | 'archive') : 'keep'
      repo.updateTask(id, {
        lxPlaylistName: String(b.lxPlaylistName ?? '').trim() || t.lxPlaylistName,
        maxCount: Math.max(0, Number(b.maxCount) || 30),
        createSameNamePlaylist: bool(b.createSameNamePlaylist) ? 1 : 0,
        cronExpr: String(b.cronExpr ?? '').trim() || null,
        syncMode: chMode === 'mirror' ? 'full' : 'incremental',
        mode: chMode,
        delPolicy: chDel,
        archivePlaylist: String(b.archivePlaylist ?? '').trim() || null,
        playlistScope: parseScope(b.playlistScope).scope,
        playlistScopeName: parseScope(b.playlistScope).name,
      })
      // 配置期创建归档目标（运行期只找不建）
      let chNote = ''
      if (chMode === 'mirror' && chDel === 'archive') {
        const t2 = repo.getTask(id)!
        const an = archiveNameOf(t2)
        const ar = await engine.ensureArchiveTarget(an, t2.playlistScope ?? 'shared')
        if (ar.created) chNote = `；已创建归档歌单「${an}」`
        else if (!ar.ok) chNote = `；归档歌单「${an}」创建失败：${ar.error}`
      }
      return { ok: true, message: '订阅已保存' + chNote }
    }
    const embyTargets = Array.isArray(b.embyTarget) ? b.embyTarget : b.embyTarget ? [b.embyTarget] : []
    const newMode = b.mode === 'mirror' || b.mode === 'incremental' ? (b.mode as 'incremental' | 'mirror') : undefined
    repo.updateTask(id, {
      embyTargetPlaylistIds: JSON.stringify(embyTargets.map(String)),
      createSameNamePlaylist: boolV(b.createSameNamePlaylist) ? 1 : 0,
      syncMode: b.mode === 'mirror' || b.syncMode === 'full' ? 'full' : 'incremental',
      mode: newMode ?? null,
      delPolicy: ['keep', 'delete', 'archive'].includes(String(b.delPolicy)) ? (b.delPolicy as 'keep' | 'delete' | 'archive') : 'keep',
      archivePlaylist: String(b.archivePlaylist ?? '').trim() || null,
      cronExpr: String(b.cronExpr ?? '').trim() || null,
      dedupCheck: boolV(b.dedupCheck) ? 1 : 0,
      dedupMinQuality: String(b.dedupMinQuality ?? '').trim() || null,
      playlistScope: parseScope(b.playlistScope).scope,
      playlistScopeName: parseScope(b.playlistScope).name,
    })
    // 配置期创建归档目标（运行期只找不建）
    const t2 = repo.getTask(id)
    let note = ''
    if (t2 && t2.delPolicy === 'archive') {
      const an = resolveArchiveName(t2.archivePlaylist, t2.lxPlaylistName)
      const ar = await engine.ensureArchiveTarget(an, t2.playlistScope ?? 'shared')
      if (ar.created) note = `；已创建归档歌单「${an}」`
      else if (!ar.ok) note = `；归档歌单「${an}」创建失败：${ar.error}`
    }
    return { ok: true, message: '任务已保存' + note }
  }


  r.post('/tasks/:id/update', async (req, res) => {
    const r = await updateTaskFromBody(Number(req.params.id), (req.body ?? {}) as Record<string, unknown>)
    res.status(r.ok ? 200 : 400).json(r)
  })


  // ===== 任务进度 =====
  // 实时进度（内存态，1 秒轮询）：正在下载第几首/共几首、阶段、当前歌曲、计数
  

  // 实时进度（JSON）：列表页轮询用（微缩进度条）
  r.get('/progress/json', (_req, res) => {
    const l = engine.live
    if (!l || l.finishedAt !== null) return res.json({ running: false })
    const pct = l.total > 0 ? Math.min(100, Math.round((l.done / l.total) * 100)) : 0
    res.json({
      running: true,
      taskId: l.taskId,
      taskName: l.taskName,
      phase: l.phase,
      index: l.index,
      total: l.total,
      done: l.done,
      pct,
      ok: l.ok,
      fail: l.fail,
      unsat: l.unsat,
      current: l.current?.name ?? null,
    })
  })

  

  // ===== 进度历史（重构后的查询层，P2）=====
  const qs = (v: unknown): string | undefined => {
    const s = String(v ?? '').trim()
    return s ? s : undefined
  }

  /** 平铺事件表：一次「任务运行 × 歌曲」一行，支持表头筛选 + keyset 分页 */
  

  // JSON 版（React SPA 用）：与 /history/rows 同参同逻辑，只是返回数据而非 HTML
  r.get('/history/rows-json', (req, res) => {
    const q = req.query
    const localStart = (d?: string) => (d && !d.includes('T') ? new Date(`${d}T00:00:00`).toISOString() : d)
    const localEnd = (d?: string) => (d && !d.includes('T') ? new Date(`${d}T23:59:59.999`).toISOString() : d)
    const f: repo.HistoryQuery = {
      q: qs(q.q), song: qs(q.song), singer: qs(q.singer), attr: qs(q.attr),
      taskName: qs(q.taskName), trigger: qs(q.trigger), mode: qs(q.mode),
      quality: qs(q.quality), action: qs(q.action), process: qs(q.process), status: qs(q.status),
      from: localStart(qs(q.from)), to: localEnd(qs(q.to)), path: qs(q.path), ref: qs(q.ref),
      cursor: Number(q.cursor) || undefined,
      limit: Number(q.limit) || undefined,
    }
    const PAGE_SIZE = 25
    const total = repo.countHistoryRows(f)
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
    const page = Math.min(pages, Math.max(1, Number(q.page) || 1))
    f.limit = PAGE_SIZE
    f.offset = (page - 1) * PAGE_SIZE
    const rows = repo.listHistoryRows(f)
    res.json({
      rows,
      page,
      pages,
      total,
      pageSize: PAGE_SIZE,
      facets: repo.historyFacets(),
      // 回显原始输入：f.from/to 已转成 UTC ISO，不能再喂回日期控件
      raw: { from: qs(q.from) ?? '', to: qs(q.to) ?? '' },
      // 标签映射（前端不硬编码中文，避免两处漂移）
      labels: {
        processes: HMeta.PROCESS_LABELS,
        statuses: HMeta.STATUS_META,
        groups: HMeta.PROCESS_GROUPS,
        // 「任务属性」列要拼 `手动 · 增量 · →《华语》`，这三个映射也得给前端
        triggers: HMeta.TRIGGER_LABELS,
        modes: HMeta.MODE_LABELS,
        delPolicies: HMeta.DELPOLICY_LABELS,
      },
    })
  })

  /** 批次视图：每批次一行（含跳过名单），空批次也在这里出现 */
  

  // JSON 版（React SPA 用）：批次列表与批次明细，与 HTML 版同逻辑
  r.get('/history/batches-json', (req, res) => {
    const q = req.query
    const f = { taskName: qs(q.taskName), trigger: qs(q.trigger), mode: qs(q.mode), from: qs(q.from), to: qs(q.to), cursor: Number(q.cursor) || undefined }
    const PAGE_SIZE = 25
    const all = repo.listBatchRows({ ...f, limit: 1000, offset: 0 })
    const total = all.length
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
    const page = Math.min(pages, Math.max(1, Number(q.page) || 1))
    res.json({
      batches: all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
      page,
      pages,
      total,
      // 「任务」下拉的候选值（跟着批次表走，不是历史明细那张表）
      taskNames: repo.batchFacets().taskNames,
    })
  })

  r.get('/history/batch/:id/rows-json', (req, res) => {
    const id = Number(req.params.id)
    const b = repo.getBatch(id)
    if (!b) return res.status(404).json({ ok: false, message: '批次不存在（可能已被删除）' })
    const items = repo.listBatchItems(id)
    const isNew = (p: string | null) => p === 'download_new'
    const isReuse = (p: string | null) => p === 'reuse_skip' || p === 'dedup_skip'
    res.json({
      ok: true,
      batch: b,
      groups: {
        new: items.filter((i) => isNew(i.process)),
        reuse: items.filter((i) => isReuse(i.process)),
        // 早期记录：那时还没写 process 字段（不猜，单独一组如实展示）
        legacy: items.filter((i) => !i.process),
        other: items.filter((i) => i.process && !isNew(i.process) && !isReuse(i.process)),
        skipped: repo.batchSkippedDetail(id),
      },
    })
  })

  /** 搜索卡：命中歌单 + 命中歌曲（按歌聚合：当前状态/文件来源/首次·最近/记录数） */
  

  // ===== 历史 =====
  // type=playlist 歌单同步任务 | type=chart 榜单订阅任务（含手动下载） | 缺省 all
  

  /**
   * 历史页批量删除（勾选若干条记录 + 三个复选框）。
   * 选择以 token 传：`b:<批次id>`（整批）/ `i:<明细id>`（单曲）；整批由服务端展开成明细。
   */
  /** 历史删除（新旧端点共用）：body { sel: 'b:1,i:2,s:3:key', file, playlist, history } */
  const deleteHistory = async (body: Record<string, unknown>): Promise<{ ok: boolean; message: string }> => {
    const tokens = String(body.sel ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (!tokens.length) return { ok: false, message: '未勾选任何记录' }
    if (engine.isRunning) return { ok: false, message: '有任务正在运行，稍后再删除（避免和同步过程抢同一批文件）' }
    const opts = { file: bool(body.file), playlist: bool(body.playlist), history: bool(body.history) }
    if (!opts.file && !opts.playlist && !opts.history) return { ok: false, message: '请至少勾选一项要删除的内容' }

    const itemIds = new Set<number>()
    const batchIds: number[] = []
    const targets = new Map<string, { taskId: number; songKey: string }>()
    const addItem = (it: { id: number; taskId: number; songKey: string } | undefined) => {
      if (!it) return
      itemIds.add(it.id)
      targets.set(`${it.taskId} ${it.songKey}`, { taskId: it.taskId, songKey: it.songKey })
    }
    for (const tok of tokens) {
      const parts = tok.split(':')
      const kind = parts[0]
      const id = Number(parts[1])
      if (kind === 's') {
        // s:<taskId>:<songKey>：按「任务×歌曲」删（台账里没有具体事件行 id，只能这么指）
        const songKey = parts.slice(2).join(':')
        if (!id || !songKey) continue
        for (const it of dbAll('SELECT id, taskId, songKey FROM history_item WHERE taskId = ? AND songKey = ?', [id, songKey])) addItem(it)
        targets.set(`${id} ${songKey}`, { taskId: id, songKey })
      } else if (!id) {
        continue
      } else if (kind === 'b') {
        batchIds.push(id)
        for (const it of dbAll('SELECT id, taskId, songKey FROM history_item WHERE batchId = ?', [id])) addItem(it)
      } else {
        addItem(dbGet('SELECT id, taskId, songKey FROM history_item WHERE id = ?', [id]))
      }
    }
    const rep = await applyDeletion({ cfg, emby, targets: [...targets.values()], itemIds: [...itemIds], batchIds, opts })
    const line = reportLine(rep)
    return { ok: !rep.errors.length, message: line }
  }

  

  // ===== 封面（JSON 版，React SPA 用）=====
  // 走媒体服务器的主图：历史里存的是 songKey，用 getEmbyMap 换条目 id。
  // 前端列为缩略图（size=80），来历卡用大图（size=300）。

  /*
    封面兜底用的两个缓存。

    emby_song_map 是「songKey → 媒体条目 Id」的缓存，**只在同步时回填**。
    而切换同步目标会主动清空它（旧服务器的条目 Id 不能用），封面接口原先只看缓存 ——
    于是切完目标，界面上所有封面会一直空到下次同步跑过（而且只恢复那个任务涉及的歌）。
    这里补一层自愈：缓存没命中就按歌名+歌手现场搜一次，搜到就回填。

    ⚠️ 两道护栏是必须的，不然这层兜底会变成对媒体服务器的持续骚扰：
    1. **负缓存**：搜不到的（歌根本没入库）记下来，10 分钟内不再重复搜 ——
       否则每开一次页面，所有未入库的歌都会各发一次搜索，一屏就是几十个请求。
    2. **并发去重**：同一首歌可能被多张卡片同时请求，共享同一个 Promise。
  */
  const coverMiss = new Map<string, number>()
  const coverInflight = new Map<string, Promise<string | null>>()
  const COVER_MISS_TTL = 10 * 60 * 1000

  /** 解析封面用的条目 Id：先查缓存，没命中再现场按歌名搜一次 */
  const resolveCoverId = async (key: string): Promise<string | null> => {
    const hit = repo.getEmbyMap(key)
    if (hit) return hit.embySongId
    const until = coverMiss.get(key)
    if (until && until > Date.now()) return null
    const running = coverInflight.get(key)
    if (running) return running
    const task = (async (): Promise<string | null> => {
      try {
        // ⚠️ 必须**按文件路径**定位，不能按歌名搜。
        //    实测：按「晴天 / 周杰伦」搜到的是库里另一个同名条目（没有封面），
        //    于是缓存里存了个错 Id。同步引擎在同样场景下用的也是 findItemByPath。
        if (!emby.findItemByPath) return null
        for (const f of repo.listFilesForSong(key)) {
          const found = await emby.findItemByPath(f.filePath).catch(() => null)
          if (found) {
            repo.setEmbyMap(key, found.id)
            return found.id
          }
        }
        coverMiss.set(key, Date.now() + COVER_MISS_TTL)
        return null
      } catch {
        // 服务器连不上/路径查报错也按"暂时没有"处理，别让它变成每屏几十次重试
        coverMiss.set(key, Date.now() + COVER_MISS_TTL)
        return null
      } finally {
        coverInflight.delete(key)
      }
    })()
    coverInflight.set(key, task)
    return task
  }

  r.get('/cover/:songKey', async (req, res) => {
    const key = String(req.params.songKey)
    const size = Math.min(600, Math.max(32, Number(req.query.size) || 80))
    if (typeof emby.getPrimaryImage !== 'function') return res.status(404).end()
    const id = await resolveCoverId(key)
    if (!id) return res.status(404).end()
    const img = await emby.getPrimaryImage(id, size)
    if (!img) return res.status(404).end()
    // 封面不会变（变了说明文件被换了），可以放心长缓存；但不设 immutable，
    // 免得换服务器/换封面后浏览器一直拿旧的
    res.set('Content-Type', img.contentType).set('Cache-Control', 'public, max-age=86400').send(img.data)
  })

  // ===== 历史：搜索卡 / 删除（JSON 版，React SPA 用）=====
  r.get('/history/search-json', (req, res) => {
    const q = qs(req.query.q)
    if (!q) return res.json({ tasks: [], songs: [] })
    res.json({ tasks: repo.searchTasks(q), songs: repo.searchSongs(q) })
  })

  r.post('/history/delete-json', async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    if (engine.isRunning) return res.json({ ok: false, message: '有任务正在运行，稍后再删除（避免和同步过程抢同一批文件）' })
    const opts = { file: bool(body.file), playlist: bool(body.playlist), history: bool(body.history) }
    if (!opts.file && !opts.playlist && !opts.history) return res.json({ ok: false, message: '请至少勾选一项要删除的内容' })
    const r = await deleteHistory(body)
    res.status(r.ok ? 200 : 400).json(r)
  })

  /** 文件大小：MB 一位小数（历史 / 回收站几处复用） */
  function fmtSize(b: number | null): string {
    if (!b) return '—'
    return (b / 1048576).toFixed(1) + ' MB'
  }
  // ===== 路径自检（部署引导） =====
  /** 路径自检：结构化结果，HTML 版与 JSON 版共用同一份判断逻辑 */
  type PathCheckLine = { level: 'ok' | 'bad' | 'hint'; text: string; detail?: string }
  const runPathCheck = async (): Promise<PathCheckLine[]> => {
    const { existsSync, writeFileSync, rmSync } = await import('node:fs')
    const lines: PathCheckLine[] = []
    const dl = cfg.lxserver.downloadRoot
    // 1. 下载目录可写
    if (!dl) {
      lines.push({ level: 'bad', text: '未配置 LX 下载目录' })
    } else if (!existsSync(dl)) {
      lines.push({ level: 'bad', text: `下载目录不存在：${dl}`, detail: '检查卷挂载路径是否与界面填写一致' })
    } else {
      try {
        const t = dl.replace(/\/+$/, '') + '/.write_test'
        writeFileSync(t, 'x')
        rmSync(t)
        lines.push({ level: 'ok', text: `下载目录可写：${dl}` })
      } catch {
        lines.push({ level: 'bad', text: `下载目录不可写：${dl}` })
      }
    }
    // 2. Emby 媒体库匹配
    if (!cfg.emby.baseUrl || !cfg.emby.apiKey) {
      lines.push({ level: 'hint', text: 'Emby 未连接，跳过媒体库匹配检查' })
    } else {
      try {
        const libs = await emby.listLibraries()
        const root = cfg.emby.libraryRoot?.replace(/\/+$/, '')
        const hit = libs.find((l) => l.locations.some((p) => (p.replace(/\/+$/, '') === root) || p.replace(/\/+$/, '').startsWith(root + '/') || (root && root.startsWith(p.replace(/\/+$/, '') + '/'))))
        if (hit) {
          lines.push({ level: 'ok', text: `已匹配媒体库「${hit.name}」（Id=${hit.id}）` })
        } else if (root) {
          lines.push({
            level: 'bad',
            text: `未匹配到媒体库：现有音乐库：${libs.map((l) => `${l.name}(${l.locations[0] || '?'})`).join('、')}`,
            detail: '请确认 libraryRoot 填的是 Emby 容器内看到的路径，且媒体库确实指向它',
          })
        } else {
          lines.push({ level: 'hint', text: '未填 Emby 媒体库根路径，可点击「探测媒体库」辅助' })
        }
      } catch (e) {
        lines.push({ level: 'bad', text: `Emby 探测失败：${(e as Error).message}` })
      }
    }
    // 3. 视角提示
    lines.push({ level: 'hint', text: '提示：两个路径字段是同一目录在不同容器里的名字；本机直跑则填宿主机真实路径。Docker 部署参照 docker-compose.example.yml。' })
    return lines
  }


  // ===== 日志 =====
  // 按级别/关键字过滤（数据源 = 落盘文件，重启不丢）
  r.get('/logs', (req, res) => {
    const level = String(req.query.level ?? '')
    const q = String(req.query.q ?? '')
    const limit = Math.min(2000, Math.max(50, Number(req.query.limit) || 400))
    const rows = logger.list({ limit, level, q })
    res.json({ rows, count: rows.length })
  })

  // ===== 通用设置 =====
  

  // ===== 高级设置（默认关闭） =====
  

  // ===== 批量下载保护 =====
  /**
   * 表单 → 通知配置（保存与"发送测试"共用一份解析，避免两处走样）。
   * 注意：**不含 enabled** —— 启用状态由「保存启用 / 停用」按钮的 enable/disable 参数决定，
   * 总开关则由"有没有任何一个渠道启用"自动推导（界面上不再有全局开关）。
   */
  const notifyFromBody = (b: Record<string, unknown>): NotifyConfig => {
    const eventsOf = (type: string) =>
      NOTIFY_EVENTS.map((e) => e.key).filter((k) => bool(b[`${type}_ev_${k}`]))
    const s = (k: string) => String(b[k] ?? '').trim()
    const prev = cfg.notify.channels
    return {
      enabled: cfg.notify.enabled,
      channels: {
        feishu: { enabled: prev.feishu.enabled, events: eventsOf('feishu'), webhook: s('feishu_webhook'), secret: s('feishu_secret') },
        wecom: { enabled: prev.wecom.enabled, events: eventsOf('wecom'), webhook: s('wecom_webhook') },
        dingtalk: { enabled: prev.dingtalk.enabled, events: eventsOf('dingtalk'), webhook: s('dingtalk_webhook'), secret: s('dingtalk_secret') },
        bark: { enabled: prev.bark.enabled, events: eventsOf('bark'), server: s('bark_server') || 'https://api.day.app', key: s('bark_key') },
        serverchan: { enabled: prev.serverchan.enabled, events: eventsOf('serverchan'), sendKey: s('serverchan_key') },
        telegram: {
          enabled: prev.telegram.enabled,
          events: eventsOf('telegram'),
          token: s('telegram_token'),
          chatId: s('telegram_chat'),
          apiBase: s('telegram_base') || 'https://api.telegram.org',
        },
        webhook: {
          enabled: prev.webhook.enabled,
          events: eventsOf('webhook'),
          url: s('webhook_url'),
          method: s('webhook_method') === 'GET' ? 'GET' : 'POST',
          headers: s('webhook_headers'),
          bodyTemplate: s('webhook_body'),
        },
      },
    }
  }

  

  /** 发送测试：用表单里**当前填写**的值发（不必先保存） */
  

  

  // ===== 下载选项 / 批量下载保护（JSON 版，React SPA 用）=====
  // 显式列出字段而非直接返回 cfg.download：把 API 契约钉死，避免内部结构变动泄漏到前端
  r.get('/options', (_req, res) => {
    res.json({
      qualityOrder: QUALITY_ORDER,
      qualityLabels: QUALITY_LABELS,
      download: {
        qualities: cfg.download.qualities,
        filenameTemplate: cfg.download.filenameTemplate,
        embedLyric: cfg.download.embedLyric,
        cacheLyric: cfg.download.cacheLyric,
      },
      protection: {
        enabled: cfg.download.protection.enabled,
        downloadIntervalSec: cfg.download.protection.downloadIntervalSec,
        resolveIntervalSec: cfg.download.protection.resolveIntervalSec,
      },
    })
  })

  r.post('/options/download', (req, res) => {
    const r = saveDownloadOptions((req.body ?? {}) as Record<string, unknown>)
    res.status(r.ok ? 200 : 400).json(r)
  })

  r.post('/options/protection', (req, res) => {
    res.json(saveProtection((req.body ?? {}) as Record<string, unknown>))
  })

  // ===== 监听同步配置(单监听器+模式互斥;新模型,见 docs/sync-redesign-spec.md)=====
  function parseStrArray(v: unknown): string[] {
    if (Array.isArray(v)) return v.map(String)
    if (typeof v === 'string') return v.split(/[,，\s]+/).filter(Boolean)
    return []
  }
  function applyListenParams(dst: ListenParams, src: Record<string, unknown>): void {
    dst.createSameNamePlaylist = boolV(src.createSameNamePlaylist)
    const ids = Array.isArray(src.embyTarget) ? src.embyTarget : src.embyTarget ? [src.embyTarget] : undefined
    if (ids !== undefined) dst.embyTargetPlaylistIds = ids.map(String)
    if (src.taskMode === 'mirror' || src.taskMode === 'incremental') dst.taskMode = src.taskMode
    if (['keep', 'delete', 'archive'].includes(String(src.delPolicy))) dst.delPolicy = src.delPolicy as ListenParams['delPolicy']
    if (src.archivePlaylist !== undefined) dst.archivePlaylist = String(src.archivePlaylist ?? '').trim() || DEFAULT_ARCHIVE_PLAYLIST
    if (src.taskCron !== undefined) dst.taskCron = String(src.taskCron ?? '').trim()
    dst.dedupCheck = boolV(src.dedupCheck)
    if (src.dedupMinQuality !== undefined) dst.dedupMinQuality = String(src.dedupMinQuality ?? '').trim() || null
  }
  /** 监听设置保存（新旧端点共用；body 形状一致：{enabled, activeMode, checkCron, includeExisting, all:{}, filtered:{params,rules}}） */
  const saveListen = async (b: Record<string, unknown>): Promise<{ ok: boolean; message: string }> => {
    const L = cfg.general.listen
    L.enabled = boolV(b.enabled)
    if (b.activeMode === 'all' || b.activeMode === 'filtered') L.activeMode = b.activeMode
    if (b.checkCron !== undefined) L.checkCron = String(b.checkCron ?? '').trim()
    // 「包含现有歌单」开关：勾选=忽略基线(现有+今后全部纳入)，取消=把当前歌单重新快照成基线
    const wasInclude = L.includeExisting
    L.includeExisting = boolV(b.includeExisting)
    let note = ''
    if (!wasInclude && L.includeExisting) {
      L.baselineKeys = []
      note = '；已纳入现有歌单'
    } else if (wasInclude && !L.includeExisting) {
      try {
        L.baselineKeys = (await lx.listPlaylists()).map((p) => p.key)
        note = `；已重新记录基线（现有 ${L.baselineKeys.length} 个歌单不再自动纳入）`
      } catch {
        note = '；LX 未连接，基线未能重记（下次启用监听时会补记）'
      }
    }
    if (b.all) applyListenParams(L.all, b.all as Record<string, unknown>)
    const f = b.filtered as Record<string, unknown> | undefined
    if (f) {
      if (f.params) applyListenParams(L.filtered.params, f.params as Record<string, unknown>)
      const ru = f.rules as Record<string, unknown> | undefined
      if (ru) {
        for (const g of ['exclude', 'match'] as const) {
          const grp = ru[g] as Record<string, unknown> | undefined
          if (!grp) continue
          const dst = L.filtered.rules[g]
          dst.enabled = boolV(grp.enabled)
          if (grp.playlists !== undefined) dst.playlists = parseStrArray(grp.playlists)
          if (grp.keywords !== undefined) dst.keywords = parseStrArray(grp.keywords)
        }
      }
    }
    // 归档目标：配置期创建（统一目标；含 [歌单名] 占位符的按来源目标在任务创建时逐个建）
    for (const tn of new Set([L.all, L.filtered.params].filter((p) => p.delPolicy === 'archive').map((p) => p.archivePlaylist))) {
      if (isArchiveTemplate(tn)) continue
      const ar = await engine.ensureArchiveTarget(tn)
      if (ar.created) note += `；已创建归档歌单「${tn}」`
      else if (!ar.ok) note += `；归档歌单「${tn}」创建失败：${ar.error}`
    }
    saveConfig(cfg)
    scheduler.reload()
    // 刚勾上「包含现有歌单」且监听已启用 → 后台立即为这批歌单建任务并同步（不阻塞保存响应）
    if (!wasInclude && L.includeExisting && L.enabled) {
      note += '；正在后台为现有歌单创建任务并同步，进度见「任务进度」'
      void listenScan(cfg, lx, engine).catch((e) => logger.warn(`[listen] 纳入现有歌单失败: ${(e as Error).message}`))
    }
    return { ok: true, message: '监听设置已保存' + note }
  }

  

  // ===== 监听同步（JSON 版，React SPA 用）=====
  r.get('/listen', async (_req, res) => {
    const L = cfg.general.listen
    const keyToName = await lxKeyToName()
    let existingCount = 0
    try {
      existingCount = (await lx.listPlaylists()).length
    } catch { /* LX 未连接时按 0 计 */ }
    res.json({
      enabled: L.enabled,
      activeMode: L.activeMode,
      checkCron: L.checkCron,
      includeExisting: L.includeExisting,
      baselineCount: L.baselineKeys.length,
      existingCount,
      all: L.all,
      filtered: L.filtered,
      ignored: L.ignoredKeys.map((k) => ({ key: k, name: keyToName[k] ?? k })),
      watchOn: autoWatchOn(),
    })
  })

  r.post('/listen', async (req, res) => {
    const r = await saveListen((req.body ?? {}) as Record<string, unknown>)
    res.json(r)
  })

  r.post('/listen/scan-now', async (_req, res) => {
    if (!cfg.general.listen.enabled) return res.json({ ok: false, message: '请先启用监听（标签2）' })
    try {
      const rr = await listenScan(cfg, lx, engine)
      res.json({
        ok: true,
        message:
          rr.created > 0
            ? `监听检测完成：自动创建 ${rr.created} 个任务并同步（${rr.names.join('、')}）${rr.skipped ? `；规则跳过 ${rr.skipped} 个` : ''}`
            : `监听检测完成：无新增歌单${rr.skipped ? `（规则跳过 ${rr.skipped} 个）` : ''}`,
      })
    } catch (e) {
      res.json({ ok: false, message: `监听检测失败：${(e as Error).message}` })
    }
  })

  r.post('/listen/pause', (req, res) => {
    const mode = String((req.body ?? {}).mode ?? '')
    if (mode !== 'all' && mode !== 'filtered') return res.status(400).json({ ok: false, message: 'mode 必须为 all|filtered' })
    const n = repo.setTasksEnabledByOrigin(originOfMode(mode), false)
    saveConfig(cfg)
    scheduler.reload()
    res.json({ ok: true, message: `已暂停 ${n} 个自动任务（可恢复）` })
  })

  r.post('/listen/resume-now', (req, res) => {
    const mode = String((req.body ?? {}).mode ?? '')
    if (mode !== 'all' && mode !== 'filtered') return res.status(400).json({ ok: false, message: 'mode 必须为 all|filtered' })
    const n = repo.setTasksEnabledByOrigin(originOfMode(mode), true)
    saveConfig(cfg)
    scheduler.reload()
    res.json({ ok: true, message: `已恢复 ${n} 个任务` })
  })

  r.post('/listen/unignore-json', async (req, res) => {
    const key = String((req.body ?? {}).key ?? '').trim()
    const L = cfg.general.listen
    if (key && L.ignoredKeys.includes(key)) {
      L.ignoredKeys = L.ignoredKeys.filter((k) => k !== key)
      saveConfig(cfg)
    }
    const keyToName = await lxKeyToName()
    res.json({ ok: true, message: '已取消忽略', ignored: L.ignoredKeys.map((k) => ({ key: k, name: keyToName[k] ?? k })) })
  })

  // ===== 监听同步(新模型)=====
  

  

  // 恢复被暂停的 origin 组
  


  // ===== 账号安全 =====
  /** 账号设置保存（新旧端点共用） */
  const saveAuth = (b: Record<string, unknown>): { ok: boolean; message: string } => {
    const a = cfg.auth
    const wantEnabled = bool(b.enabled)
    const username = String(b.username ?? '').trim()
    const current = String(b.currentPassword ?? '')
    const next = String(b.newPassword ?? '')

    if (!a.enabled) {
      // 未启用 → 启用需用户名 + 新密码
      if (!wantEnabled) return { ok: true, message: '认证保持未启用' }
      if (!username || !next) return { ok: false, message: '启用认证需填写用户名和新密码' }
      a.enabled = true
      a.username = username
      a.passwordHash = hashPassword(next)
      saveConfig(cfg)
      return { ok: true, message: `账号认证已启用（用户 ${username}）` }
    }
    // 已启用：必须验证当前密码
    if (!verifyPassword(current, a.passwordHash)) return { ok: false, message: '当前密码不正确' }
    if (!wantEnabled) {
      a.enabled = false
      saveConfig(cfg)
      return { ok: true, message: '账号认证已停用' }
    }
    if (username) a.username = username
    if (next) a.passwordHash = hashPassword(next)
    saveConfig(cfg)
    return { ok: true, message: '账号设置已保存' }
  }

  

  // ===== 设置页（JSON 版，React SPA 用）=====
  r.get('/settings', (_req, res) => {
    res.json({
      general: { logRetentionDays: cfg.general.logRetentionDays },
      auth: { enabled: cfg.auth.enabled, username: cfg.auth.username },
    })
  })

  r.post('/settings/general', (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    // 已从界面移除的开关：表单缺席时保持原值，避免保存时被悄悄重置
    if (b.pauseAll !== undefined) cfg.general.pauseAll = bool(b.pauseAll)
    cfg.general.logRetentionDays = Math.min(365, Math.max(1, Number(b.logRetentionDays) || 30))
    saveConfig(cfg)
    logger.info(`[config] 通用设置：暂停全部=${cfg.general.pauseAll ? '开' : '关'} 日志保留=${cfg.general.logRetentionDays}天`)
    res.json({ ok: true, message: '设置已保存' })
  })

  r.post('/settings/auth', (req, res) => {
    const r = saveAuth((req.body ?? {}) as Record<string, unknown>)
    res.status(r.ok ? 200 : 400).json(r)
  })

  // ===== 通知（JSON 版，React SPA 用）=====
  // 字段规格：k = 表单键（notifyFromBody 读的就是它），cfgKey = 配置里的键名（两者不总同名）
  type NotifyField = { k: string; cfgKey: string; label: string; ph?: string; password?: boolean; wide?: boolean; hint?: string; options?: { value: string; label: string }[] }
  const NOTIFY_FIELDS: Record<string, NotifyField[]> = {
    feishu: [
      { k: 'feishu_webhook', cfgKey: 'webhook', label: '群机器人 Webhook', ph: 'https://open.feishu.cn/open-apis/bot/v2/hook/…', wide: true },
      { k: 'feishu_secret', cfgKey: 'secret', label: '签名密钥（可选）', password: true, hint: '机器人开了「签名校验」才需要' },
    ],
    wecom: [
      { k: 'wecom_webhook', cfgKey: 'webhook', label: '群机器人 Webhook', ph: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…', wide: true, hint: '企业微信内容上限 2048 字节，超长会自动截断' },
    ],
    dingtalk: [
      { k: 'dingtalk_webhook', cfgKey: 'webhook', label: '群机器人 Webhook', ph: 'https://oapi.dingtalk.com/robot/send?access_token=…', wide: true },
      { k: 'dingtalk_secret', cfgKey: 'secret', label: '加签密钥（可选）', password: true, hint: '机器人开了「加签」才需要' },
    ],
    bark: [
      { k: 'bark_server', cfgKey: 'server', label: 'Bark 服务器', ph: 'https://api.day.app' },
      { k: 'bark_key', cfgKey: 'key', label: 'Key', password: true },
    ],
    serverchan: [{ k: 'serverchan_key', cfgKey: 'sendKey', label: 'SendKey', password: true, wide: true }],
    telegram: [
      { k: 'telegram_token', cfgKey: 'token', label: 'Bot Token', password: true },
      { k: 'telegram_chat', cfgKey: 'chatId', label: 'chat_id' },
      { k: 'telegram_base', cfgKey: 'apiBase', label: 'API 地址', ph: 'https://api.telegram.org', wide: true, hint: '国内直连不通时填自建反代' },
    ],
    webhook: [
      { k: 'webhook_url', cfgKey: 'url', label: 'URL', ph: 'https://…', wide: true },
      { k: 'webhook_method', cfgKey: 'method', label: '方法', options: [{ value: 'POST', label: 'POST' }, { value: 'GET', label: 'GET' }] },
      { k: 'webhook_headers', cfgKey: 'headers', label: '自定义请求头（JSON 文本，可留空）', wide: true },
      { k: 'webhook_body', cfgKey: 'bodyTemplate', label: 'POST body 模板', ph: '{"text":"{title}\\n{text}"}', wide: true, hint: '占位 {title} {text}；留空用默认 JSON' },
    ],
  }

  r.get('/settings/notify', (_req, res) => {
    const ch = cfg.notify.channels as unknown as Record<string, Record<string, unknown>>
    const values: Record<string, string> = {}
    for (const [type, fields] of Object.entries(NOTIFY_FIELDS)) {
      for (const f of fields) values[f.k] = String(ch[type]?.[f.cfgKey] ?? '')
    }
    res.json({
      enabled: cfg.notify.enabled,
      channels: Object.fromEntries(
        Object.entries(ch).map(([t, c]) => [t, { enabled: !!c.enabled, events: (c.events as string[]) ?? [] }]),
      ),
      values,
      fields: NOTIFY_FIELDS,
      groups: CHANNEL_GROUPS,
      labels: CHANNEL_LABEL,
      events: NOTIFY_EVENTS,
    })
  })

  r.post('/settings/notify', (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    const next = notifyFromBody(b)
    // 「保存启用」/「停用」：指定目标渠道；不传则保持原状态
    for (const [t, c] of Object.entries(b.channels as Record<string, { enabled?: boolean }> ?? {})) {
      if (t in next.channels) next.channels[t as NotifyChannelType].enabled = !!c.enabled
    }
    next.enabled = Object.values(next.channels).some((c) => c.enabled)
    cfg.notify = { ...cfg.notify, ...next }
    saveConfig(cfg)
    const on = Object.entries(next.channels)
      .filter(([, c]) => c.enabled)
      .map(([t]) => CHANNEL_LABEL[t as NotifyChannelType])
    const msg = next.enabled ? `通知已开启（启用中：${on.join('、')}）` : '通知已全部停用'
    logger.info(`[config] ${msg}`)
    res.json({ ok: true, message: msg })
  })

  r.post('/notify/test-json/:type', async (req, res) => {
    const type = String(req.params.type) as NotifyChannelType
    if (!CHANNEL_LABEL[type]) return res.json({ ok: false, message: '未知渠道' })
    try {
      const draft = notifyFromBody((req.body ?? {}) as Record<string, unknown>)
      const r = await testChannel(type, draft.channels)
      res.json(r.ok ? { ok: true, message: `${r.channel} 测试消息已发出，去看看` } : { ok: false, message: `${r.channel} 发送失败：${r.error}` })
    } catch (e) {
      res.json({ ok: false, message: `测试出错：${(e as Error).message}` })
    }
  })

  // ===== 回收站 / 重试（JSON 版，React SPA 用）=====
  r.get('/trash', (_req, res) => {
    const { batches, files } = listTrash(cfg)
    res.json({
      batches,
      files: files.map((f) => ({ rel: f.rel, size: f.size, batch: f.batch })),
    })
  })

  r.post('/trash/restore-json', (req, res) => {
    const rel = String((req.body ?? {}).rel ?? '')
    try {
      res.json({ ok: true, message: `已恢复：${restoreFromTrash(cfg, rel)}` })
    } catch (e) {
      res.json({ ok: false, message: (e as Error).message })
    }
  })

  r.post('/trash/purge-json', (req, res) => {
    const full = String((req.body ?? {}).full ?? '')
    try {
      purgePath(full)
      res.json({ ok: true, message: '已彻底删除' })
    } catch (e) {
      res.json({ ok: false, message: (e as Error).message })
    }
  })

  r.post('/history/item/:id/retry-json', async (req, res) => {
    const item = dbGet('SELECT * FROM history_item WHERE id = ?', [Number(req.params.id)]) as
      | { taskId: number; songKey: string }
      | undefined
    if (!item) return res.status(404).json({ ok: false, message: '记录不存在' })
    if (engine.isRunning) return res.json({ ok: false, message: '已有任务在运行，稍后再试' })
    try {
      const r = await engine.retrySong(item.taskId, item.songKey)
      res.json(
        r === 'success'
          ? { ok: true, message: '重试成功，已补入库+入歌单' }
          : { ok: false, message: `重试未成功（${r === 'song-not-in-source' ? '这首歌已不在源歌单/榜单里' : r}）` },
      )
    } catch (e) {
      logger.warn(`[retry] 重试失败: ${(e as Error).message}`)
      res.json({ ok: false, message: `重试出错：${(e as Error).message}` })
    }
  })

  return r
}

function dbAll(sql: string, params: unknown[]): any[] {
  return getDb().prepare(sql).all(...params) as any[]
}
function dbGet(sql: string, params: unknown[]): any {
  return getDb().prepare(sql).get(...params) as any
}
