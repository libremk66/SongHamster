import cron, { type ScheduledTask } from 'node-cron'
import { CronExpressionParser } from 'cron-parser'
import type { AppConfig } from '../config.js'
import type { SyncEngine } from '../core/sync-engine.js'
import type { LxServerAdapter } from '../adapters/lxserver.js'
import * as repo from '../store/repo.js'
import { listenScan } from '../core/listen.js'
import { logger } from '../core/logger.js'

/**
 * 调度器：任务 cron + 自动新增检测 cron
 * - sync_task.cronExpr 非空且 enabled 的任务 → 到点 engine.runTask(id, 'cron')
 * - general.listen 开启且有 checkCron → 到点 listenScan
 * 配置变更后调用 reload() 重建计划
 */
export class Scheduler {
  private jobs: ScheduledTask[] = []
  private initialized = false

  constructor(
    private cfg: () => AppConfig,
    private engine: SyncEngine,
    private lx: LxServerAdapter,
  ) {}

  init(): void {
    if (this.initialized) return
    this.initialized = true
    this.reload()
    logger.info('[scheduler] 调度器已启动')
  }

  reload(): void {
    for (const j of this.jobs) {
      try {
        j.destroy()
      } catch { /* 忽略 */ }
    }
    this.jobs = []
    const cfg = this.cfg()

    // 任务定时同步
    for (const t of repo.listTasks()) {
      if (!t.enabled || !t.cronExpr?.trim()) continue
      try {
        const job = cron.schedule(t.cronExpr.trim(), () => {
          void this.engine.runTask(t.id, 'cron')
        })
        this.jobs.push(job)
        logger.info(`[scheduler] 任务#${t.id}「${t.lxPlaylistName}」定时: ${t.cronExpr}`)
      } catch (e) {
        logger.warn(`[scheduler] 任务#${t.id} cron 无效: ${t.cronExpr}（${(e as Error).message}）`)
      }
    }

    // 监听检测（旧 autoadd 已删除，2026-09-23 全量切到 listen）
    const L = cfg.general.listen
    if (L.enabled && L.checkCron?.trim()) {
      try {
        const job = cron.schedule(L.checkCron.trim(), () => {
          void listenScan(cfg, this.lx, this.engine)
        })
        this.jobs.push(job)
        logger.info(`[scheduler] 监听检测定时(${L.activeMode}): ${L.checkCron}`)
      } catch (e) {
        logger.warn(`[scheduler] listen cron 无效: ${L.checkCron}(${(e as Error).message})`)
      }
    }
  }

  /** cron 表达式的下次执行时间（界面预览用）；无效返回 null */
  nextRun(expr: string): string | null {
    try {
      return CronExpressionParser.parse(expr.trim()).next().toISOString()
    } catch {
      return null
    }
  }
}
