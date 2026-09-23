import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { LogIn } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { FieldLabel, Label } from '@/components/ui/label'
import { api } from '@/lib/api'

type AuthStatus = { enabled: boolean; username: string; authed: boolean }

export function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  /** 「保持登录」默认开（与 MoviePilot 一致）：不勾则用浏览器会话 Cookie，关掉浏览器即失效 */
  const [remember, setRemember] = useState(true)

  const status = useQuery({
    queryKey: ['auth-status'],
    queryFn: () => api.get<AuthStatus>('/auth/status'),
    retry: false,
  })

  const login = useMutation({
    mutationFn: () => api.post<{ ok: boolean }>('/auth/login', { username, password, remember }),
    onSuccess: () => {
      // 回跳到登录前想去的地方（缺省回首页）
      const params = new URLSearchParams(window.location.search)
      const to = params.get('redirect') || '/'
      window.location.href = to.startsWith('/app') ? to : `/app${to}`
    },
    onError: (e) => setError(e instanceof Error ? e.message : '登录失败'),
  })

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="space-y-4">
          <div className="space-y-2 text-center">
            {/* 用真 logo（和侧栏同一个文件），别再用 🎵 占位 */}
            <img src="/static/icon.png" alt="" className="mx-auto size-16 rounded-2xl object-cover shadow-sm" />
            <h1 className="text-xl font-bold">音乐仓鼠</h1>
            <p className="text-sm text-muted-foreground">欢迎回来</p>
          </div>

          {status.data && !status.data.enabled ? (
            <div className="space-y-3 text-center">
              <p className="text-sm text-muted-foreground">当前未启用账号认证，可直接进入。</p>
              <Button asChild className="w-full">
                <a href="/app/">进入</a>
              </Button>
            </div>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                setError('')
                login.mutate()
              }}
            >
              <div>
                <Label htmlFor="login-user">
                  <FieldLabel className="mb-0">用户名</FieldLabel>
                </Label>
                <Input
                  id="login-user"
                  autoComplete="username"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="login-pass">
                  <FieldLabel className="mb-0">密码</FieldLabel>
                </Label>
                <Input
                  id="login-pass"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              <Label className="min-h-11 cursor-pointer py-0.5 md:min-h-0">
                <Checkbox checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                <span className="text-sm">保持登录</span>
              </Label>

              {(error || login.isError) && (
                <p className="text-sm text-destructive" role="alert">
                  ❌ {error}
                </p>
              )}

              <Button type="submit" className="w-full" disabled={login.isPending}>
                <LogIn />
                {login.isPending ? '登录中…' : '登录'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
