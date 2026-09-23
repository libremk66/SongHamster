/**
 * 统一的 API 客户端。
 *
 * 约定（与后端 `src/routes/api.ts` 的 JSON 化目标一致）：
 * - 成功：直接返回数据体
 * - 失败：HTTP 4xx/5xx，body 形如 { message: string }
 * - 401：跳登录页
 */

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    // Accept 不是可选的：后端有几个接口对「表单直投」和「fetch」返回不同的东西
    // （如 /api/auth/logout 给表单 302 回 /login，给 fetch 返回 JSON）
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(init?.headers ?? {}) },
    ...init,
  })

  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      // 非 JSON 响应（理论上不该出现）——原样抛出便于排查
      if (!res.ok) throw new ApiError(res.status, text.slice(0, 200))
    }
  }

  if (res.status === 401) {
    // 会话失效：整体跳登录（保持回跳地址）。
    // ⚠️ 错误消息要透传：登录页本身靠它显示「用户名或密码错误」，
    //    写死成"未登录"会让登录失败永远看不出原因。
    const body401 = data && typeof data === 'object' ? (data as Record<string, unknown>) : null
    const msg401 =
      (body401 && (body401.error ?? body401.message) ? String(body401.error ?? body401.message) : '') || '未登录'
    if (!window.location.pathname.startsWith('/app/login')) {
      const back = encodeURIComponent(window.location.pathname + window.location.search)
      window.location.href = `/app/login?redirect=${back}`
    }
    throw new ApiError(401, msg401)
  }

  if (!res.ok) {
    // 后端错误约定：{ ok: false, error: '…' }（见 src/server.ts 与 routes/api.ts）
    const body = data && typeof data === 'object' ? (data as Record<string, unknown>) : null
    const msg =
      (body && (body.error ?? body.message) ? String(body.error ?? body.message) : '') ||
      `请求失败（HTTP ${res.status}）`
    throw new ApiError(res.status, msg)
  }

  return data as T
}

export const api = {
  get: <T>(path: string, init?: RequestInit) => request<T>(path, init),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
}
