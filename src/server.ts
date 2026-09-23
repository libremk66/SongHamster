import express from 'express'
import cookieParser from 'cookie-parser'
import fs from 'node:fs'
import path from 'node:path'
import { loadConfig, DB_PATH, VERSION } from './config.js'
import { getDb } from './store/db.js'
import * as repo from './store/repo.js'
import { LxServerAdapter } from './adapters/lxserver.js'
import { EmbyAdapter } from './adapters/emby.js'
import { NavidromeAdapter } from './adapters/navidrome.js'
import { DaoliyuAdapter } from './adapters/daoliyu.js'
import { SubsonicAdapter } from './adapters/subsonic.js'
import type { MediaServerAdapter } from './adapters/media-server.js'
import { SyncEngine } from './core/sync-engine.js'
import { Scheduler } from './scheduler/index.js'
import { apiRouter } from './routes/api.js'
import { authRequired, createSession, destroySession, initAuthFromEnv, isSessionValid, verifyPassword, COOKIE_NAME, SESSION_DAYS } from './auth.js'
import { logger } from './core/logger.js'

const config = loadConfig()
// 改名兼容提示：仍沿用改名前的数据库/回收站文件名时，明确告诉用户（不静默、不擅自改名）
if (DB_PATH.endsWith('songferry.db')) {
  logger.info('[config] 仍在使用改名前的数据库 songferry.db（数据完整，无需处理）；想换成新名字，把 songferry.db / songferry.db-wal / songferry.db-shm 三个文件一起改名为 songhamster.db* 即可，程序下次启动会自动改用新文件')
}
getDb() // 初始化 SQLite（含迁移）
// 上次进程被中断（崩溃/重启）留下的"没跑完"批次，启动时收尾成"中断"，
// 否则它们在进度历史里会一直显示 result=null
const stale = repo.finalizeStaleBatches()
if (stale) logger.info(`[history] 已收尾 ${stale} 条上次中断的批次记录（标记为"被中断"）`)
initAuthFromEnv(config) // docker env 注入初始账号（SONGHAMSTER_AUTH_USER/PASSWORD）

/** 按 cfg.target 实例化媒体服务器适配器 */
function makeServer(): MediaServerAdapter {
  if (config.target === 'navidrome') return new NavidromeAdapter(() => config)
  if (config.target === 'daoliyu') return new DaoliyuAdapter(() => config)
  if (config.target === 'subsonic') return new SubsonicAdapter(() => config)
  if (config.target === 'jellyfin') return new EmbyAdapter(() => config, 'jellyfin')
  return new EmbyAdapter(() => config)
}

/*
  媒体服务器适配器：**跟着 cfg.target 自动换实例**。

  ⚠️ 为什么要在"每次取属性"时自查，而不是切换时显式重建一次：
     适配器在**构造时**就绑死了配置段（EmbyAdapter 的 segment='emby'|'jellyfin'、
     NavidromeAdapter 读 cfg().navidrome），构造完再改 cfg.target 它不会跟着变。
     而切目标的入口不止一条（旧 htmx 端点、React 的 /connect/apply-json），
     之前只有其中一条会重建 —— 结果从界面切了目标、提示写着"已设为同步目标"，
     实际同步仍旧打在旧服务器上，直到重启进程才生效。
     改成"取属性时自查"就不可能再漏：任何路径改了 target，下次调用自动生效。
*/
let cachedTarget = config.target
let serverImpl: MediaServerAdapter = makeServer()
const server: MediaServerAdapter = new Proxy({} as MediaServerAdapter, {
  get: (_t, p) => {
    if (cachedTarget !== config.target) {
      cachedTarget = config.target
      serverImpl = makeServer()
      logger.info(`[server] 同步目标已切到 ${cachedTarget}，适配器已重建`)
    }
    const v = (serverImpl as any)[p]
    return typeof v === 'function' ? v.bind(serverImpl) : v
  },
})

const lx = new LxServerAdapter(() => config)
const engine = new SyncEngine(() => config, lx, server)
const scheduler = new Scheduler(() => config, engine, lx)
scheduler.init() // 任务 cron + 自动新增检测 cron

const app = express()
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())
app.use('/static', express.static(path.join(process.cwd(), 'static')))

app.use((req, res, next) => {
  if (!req.path.includes('.')) res.set('Cache-Control', 'no-store')
  next()
})

app.get('/healthz', (_req, res) => {
  // 版本取自 package.json（曾写死 '0.1.0'，导致冒烟/监控永远看到错误的版本号）
  res.json({ ok: true, version: VERSION, time: new Date().toISOString() })
})

// ===== 登录页（认证白名单） =====
// 旧登录页已删（2026-09-23 全量切到 React SPA）
app.get('/login', (_req, res) => res.redirect('/app/login'))

app.post('/api/auth/login', (req, res) => {
  const b = req.body ?? {}
  const u = String(b.username ?? '')
  const p = String(b.password ?? '')
  if (!config.auth.enabled) return res.status(400).json({ ok: false, error: '认证未启用' })
  if (u === config.auth.username && verifyPassword(p, config.auth.passwordHash)) {
    const token = createSession(u)
    // 「保持登录」默认开：不勾就不带 maxAge → 浏览器**会话 Cookie**，关掉浏览器即失效。
    // 服务端那条会话记录仍是 SESSION_DAYS 天，只是 Cookie 没了就够不着。
    const raw = b.remember
    const remember = !(raw === false || raw === 0 || raw === '0' || raw === 'false')
    const cookie: { httpOnly: boolean; sameSite: 'lax'; path: string; maxAge?: number } = { httpOnly: true, sameSite: 'lax', path: '/' }
    if (remember) cookie.maxAge = SESSION_DAYS * 86400_000
    res.cookie(COOKIE_NAME, token, cookie)
    res.json({ ok: true })
  } else {
    res.status(401).json({ ok: false, error: '用户名或密码错误' })
  }
})

app.post('/api/auth/logout', (req, res) => {
  const token = (req.cookies as Record<string, string>)?.[COOKIE_NAME]
  if (token) destroySession(token)
  res.clearCookie(COOKIE_NAME, { path: '/' })
  // 表单直投（旧登录页遗留的调用方式）给 302，fetch 给 JSON —— 只认 Accept，不看 UA。
  if (req.get('accept')?.includes('application/json')) {
    res.json({ ok: true })
    return
  }
  res.redirect('/app/login')
})

app.get('/api/auth/status', (req, res) => {
  res.json({ enabled: config.auth.enabled, username: config.auth.username, authed: isSessionValid((req.cookies as Record<string, string>)?.[COOKIE_NAME]) })
})

// ===== 其余页面与 API 均需认证（开启时） =====
app.use(authRequired(() => config))

app.use('/api', apiRouter(config, lx, server, engine, scheduler))

// ===== React SPA（唯一界面；旧 Eta 页面已于 2026-09-23 全部删除）=====
const WEB_DIST = path.join(process.cwd(), 'web', 'dist')
const SPA_INDEX = path.join(WEB_DIST, 'index.html')
if (fs.existsSync(SPA_INDEX)) {
  app.use('/app', express.static(WEB_DIST, { index: false }))
  // SPA 路由回退：/app 下非静态文件的路径一律交给前端路由
  app.get(/^\/app(?:\/.*)?$/, (_req, res) => res.sendFile(SPA_INDEX))
  logger.info('[web] React SPA 已挂载于 /app')
} else {
  logger.info('[web] 未找到 web/dist —— /app 暂不可用。构建后再试：npm run build:web')
}

app.get('/', (_req, res) => res.redirect('/app'))

logger.info(`[auth] 账号认证: ${config.auth.enabled ? `已启用（${config.auth.username}）` : '未启用（设置页可开启）'}`)
{
  // 日志落盘目录就绪后清理过期文件（保留天数见 设置 → 通用）
  const removed = logger.cleanup(config.general.logRetentionDays)
  if (removed) logger.info(`[logger] 已清理 ${removed} 个超过 ${config.general.logRetentionDays} 天的日志文件`)
}

app.listen(config.server.port, () => {
  console.log(`[songhamster] listening on http://127.0.0.1:${config.server.port}`)
  console.log(`[songhamster] config: ${process.env.SONGHAMSTER_CONFIG || 'data/config.yaml'}`)
})
