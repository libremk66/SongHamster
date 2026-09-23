import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Save, Send } from 'lucide-react'

import { FormMessage } from '@/components/form-message'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { FieldLabel, Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

export type NotifyField = {
  k: string
  cfgKey: string
  label: string
  ph?: string
  password?: boolean
  wide?: boolean
  hint?: string
  options?: { value: string; label: string }[]
}
export type NotifyData = {
  enabled: boolean
  channels: Record<string, { enabled: boolean; events: string[] }>
  values: Record<string, string>
  fields: Record<string, NotifyField[]>
  groups: { label: string; types: string[] }[]
  labels: Record<string, string>
  events: { key: string; label: string; hint?: string; defaultOn?: boolean }[]
}
type Result = { ok: boolean; message: string }

export function NotifySection({ data, onMsg }: { data: NotifyData; onMsg: (r: Result) => void }) {
  const qc = useQueryClient()
  const [active, setActive] = useState(data.groups[0]?.types[0] ?? 'feishu')
  // 表单状态：扁平键（与后端 notifyFromBody 读取的键一一对应）+ 每渠道的订阅事件
  const [values, setValues] = useState<Record<string, string>>(data.values)
  const [events, setEvents] = useState<Record<string, string[]>>(
    Object.fromEntries(Object.entries(data.channels).map(([t, c]) => [t, c.events])),
  )
  const [msg, setMsg] = useState<Result | null>(null)

  const save = useMutation({
    mutationFn: ({ enable, disable }: { enable?: string; disable?: string }) => {
      const body: Record<string, unknown> = { ...values }
      for (const [t, evs] of Object.entries(events)) {
        for (const e of data.events) body[`${t}_ev_${e.key}`] = evs.includes(e.key) ? '1' : '0'
        body[`channels`] = {
          ...(body.channels as Record<string, unknown>),
          [t]: { enabled: enable === t ? true : disable === t ? false : data.channels[t]?.enabled },
        }
      }
      if (enable) body.enable = enable
      if (disable) body.disable = disable
      return api.post<Result>('/settings/notify', body)
    },
    onSuccess: (r) => {
      setMsg(r)
      onMsg(r)
      void qc.invalidateQueries({ queryKey: ['notify'] })
    },
    onError: (e) => setMsg({ ok: false, message: e instanceof Error ? e.message : '保存失败' }),
  })

  const test = useMutation({
    mutationFn: (type: string) => {
      const body: Record<string, unknown> = { ...values }
      for (const [t, evs] of Object.entries(events)) for (const e of data.events) body[`${t}_ev_${e.key}`] = evs.includes(e.key) ? '1' : '0'
      return api.post<Result>(`/notify/test-json/${type}`, body)
    },
    onSuccess: (r) => {
      setMsg(r)
      onMsg(r)
    },
    onError: (e) => setMsg({ ok: false, message: e instanceof Error ? e.message : '测试失败' }),
  })

  const activeFields = data.fields[active] ?? []
  const activeEvents = events[active] ?? []
  const isOn = data.channels[active]?.enabled ?? false

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-muted-foreground">
        同步跑完或出错时推一条。<b>每个渠道单独选订阅哪些事件</b>（比如"失败推手机、成功只发群里"）；
        <b>发送失败只记日志，不影响同步</b>。
      </p>

      {/* 分组 + 横向子标签 */}
      <div className="space-y-1.5">
        {data.groups.map((g) => (
          <div key={g.label} className="flex flex-wrap items-center gap-1.5">
            <span className="w-14 shrink-0 text-xs text-muted-foreground">{g.label}</span>
            {g.types.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setActive(t)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors max-md:min-h-11',
                  t === active
                    ? 'border-primary bg-primary font-medium text-primary-foreground'
                    : 'bg-background hover:bg-muted',
                )}
              >
                <span
                  className={cn('size-1.5 rounded-full', data.channels[t]?.enabled ? 'bg-emerald-500' : 'bg-muted-foreground/40')}
                  aria-hidden
                />
                {data.labels[t]}
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* 当前渠道 */}
      <div className="space-y-3 rounded-lg border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="flex-1 text-sm font-bold">{data.labels[active]}</h3>
          <Badge variant={isOn ? 'secondary' : 'outline'}>{isOn ? '已启用' : '未启用'}</Badge>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {activeFields.map((f) => (
            <div key={f.k} className={cn(f.wide && 'md:col-span-2')}>
              <Label htmlFor={`nt-${f.k}`}>
                <FieldLabel className="mb-0">{f.label}</FieldLabel>
              </Label>
              {f.options ? (
                <Select
                  id={`nt-${f.k}`}
                  value={values[f.k] ?? f.options[0].value}
                  onChange={(e) => setValues({ ...values, [f.k]: e.target.value })}
                >
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  id={`nt-${f.k}`}
                  type={f.password ? 'password' : 'text'}
                  autoComplete="off"
                  value={values[f.k] ?? ''}
                  placeholder={f.ph}
                  onChange={(e) => setValues({ ...values, [f.k]: e.target.value })}
                />
              )}
              {f.hint && <div className="mt-1 text-xs text-muted-foreground">{f.hint}</div>}
            </div>
          ))}
        </div>

        {/* 订阅哪些事件 */}
        <div className="border-t pt-3">
          <FieldLabel>订阅哪些事件</FieldLabel>
          <div className="grid gap-x-5 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
            {data.events.map((e) => (
              <Label key={e.key} className="min-h-11 cursor-pointer md:min-h-0">
                <Checkbox
                  checked={activeEvents.includes(e.key)}
                  onChange={(ev) =>
                    setEvents({
                      ...events,
                      [active]: ev.target.checked
                        ? [...activeEvents, e.key]
                        : activeEvents.filter((x) => x !== e.key),
                    })
                  }
                />
                <span className="text-sm">{e.label}</span>
              </Label>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <Button type="button" size="sm" disabled={save.isPending} onClick={() => save.mutate({ enable: active })}>
            <Save />
            保存启用
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={save.isPending} onClick={() => save.mutate({ disable: active })}>
            停用
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={test.isPending} onClick={() => test.mutate(active)}>
            <Send />
            发送测试
          </Button>
        </div>

        {msg && <FormMessage ok={msg.ok}>{msg.message}</FormMessage>}
      </div>
    </div>
  )
}
