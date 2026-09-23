import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Save } from 'lucide-react'

import { DelayedLoading } from '@/components/loading'
import { FormMessage } from '@/components/form-message'
import { InfoTip } from '@/components/info-tip'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { FieldLabel, Label } from '@/components/ui/label'
import { api } from '@/lib/api'

type Quality = string
type OptionsData = {
  qualityOrder: Quality[]
  qualityLabels: Record<Quality, string>
  download: {
    qualities: Quality[]
    filenameTemplate: string
    embedLyric: boolean
    cacheLyric: boolean
  }
  protection: {
    enabled: boolean
    downloadIntervalSec: number
    resolveIntervalSec: number
  }
}

type SaveResult = { ok: boolean; message: string }
type Msg = { ok: boolean; text: string }

export function OptionsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['options'],
    queryFn: () => api.get<OptionsData>('/options'),
  })

  return (
    <div className="space-y-4">
      {/* 手机端不显示页面名：顶栏已经写着（见 app-shell），这块地方留给内容 */}
      <header className="max-md:hidden">
        <h1 className="text-lg font-bold tracking-tight">下载选项</h1>
      </header>

      {isLoading || !data ? (
        <DelayedLoading loading className="py-10 text-center text-sm text-muted-foreground" />
      ) : (
        <>
          <DownloadForm data={data} />
          <ProtectionForm protection={data.protection} />
        </>
      )}
    </div>
  )
}

function SaveMsg({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null
  return <FormMessage ok={msg.ok}>{msg.text}</FormMessage>
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-muted-foreground">{children}</h3>
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>
}

/* ── 表单一：下载选项 ───────────────────────────── */
function DownloadForm({ data }: { data: OptionsData }) {
  const qc = useQueryClient()
  const [qualities, setQualities] = useState<string[]>(data.download.qualities)
  const [filenameTemplate, setFilenameTemplate] = useState(data.download.filenameTemplate)
  const [embedLyric, setEmbedLyric] = useState(data.download.embedLyric)
  const [cacheLyric, setCacheLyric] = useState(data.download.cacheLyric)
  const [msg, setMsg] = useState<Msg | null>(null)

  const save = useMutation({
    mutationFn: () =>
      api.post<SaveResult>('/options/download', {
        qualities,
        filenameTemplate,
        embedLyric,
        cacheLyric,
      }),
    onSuccess: (r) => {
      setMsg({ ok: r.ok, text: r.message })
      if (r.ok) void qc.invalidateQueries({ queryKey: ['options'] })
    },
    onError: (e) => setMsg({ ok: false, text: e instanceof Error ? e.message : '保存失败' }),
  })

  const toggle = (q: string, on: boolean) =>
    setQualities((prev) => (on ? [...prev, q] : prev.filter((x) => x !== q)))

  return (
    <Card>
      <CardContent className="space-y-5">
        {/* 音质偏好 */}
        <section>
          <SectionTitle>
            音质偏好
            <InfoTip>
              <p>按高→低依次尝试，未勾选绝不使用。实际能拿到哪一档取决于音源支持（按 LX 搜索结果自动识别）；勾选范围均拿不到的歌会标记「未满足」。Atmos 系为多声道沉浸式，体积较大。</p>
              <p className="mt-1.5">
                <b>已下载过的歌不会重复下载</b>（按「歌 + 音质」判定，与这里的勾选无关）。
                想换更高音质：<b>删掉那个文件</b>，下次同步会重新下载。
                ⚠️ 调低音质偏好后重跑，对「原档位已不在勾选里」的歌会补一份低档文件（库里会多一份）。
              </p>
            </InfoTip>
          </SectionTitle>
          <div className="grid gap-x-5 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
            {data.qualityOrder.map((q) => (
              <Label key={q} className="min-h-11 cursor-pointer md:min-h-0">
                <Checkbox
                  checked={qualities.includes(q)}
                  onChange={(e) => toggle(q, e.target.checked)}
                />
                <span>{data.qualityLabels[q] ?? q}</span>
              </Label>
            ))}
          </div>
        </section>

        <hr className="border-border" />

        {/* 文件命名 */}
        <section>
          <SectionTitle>文件命名</SectionTitle>
          <Label htmlFor="filenameTemplate" className="mb-1 flex items-center gap-1.5 text-sm">
            命名模板
            <InfoTip>
              可用占位符：[歌手] [专辑名] [歌曲名] [音质]。示例：后海大鲨鱼 - 心要野 (flac24bit).flac
            </InfoTip>
          </Label>
          <Input
            id="filenameTemplate"
            value={filenameTemplate}
            onChange={(e) => setFilenameTemplate(e.target.value)}
            className="w-full font-mono"
          />
        </section>

        <hr className="border-border" />

        {/* 写入文件信息 */}
        <section>
          <SectionTitle>
            写入文件信息
            <InfoTip>
              ID3 标签（标题/歌手/专辑）和封面由 LX 服务端下载时<b>始终写入</b>，没有开关 ——
              下面两项置灰仅作说明。
              <p className="mt-1.5">
                外置歌词只管落盘时留不留 .lrc；<b>LX 网页播放器</b>写的 .lrc 是另一回事，要去它的「设置 → 缓存歌词文件」关。
              </p>
            </InfoTip>
          </SectionTitle>
          <div className="grid gap-x-5 gap-y-1 sm:grid-cols-2">
            <Label className="min-h-11 cursor-not-allowed opacity-60 md:min-h-0">
              <Checkbox checked disabled />
              <span>ID3 标签（标题/歌手/专辑）</span>
            </Label>
            <Label className="min-h-11 cursor-not-allowed opacity-60 md:min-h-0">
              <Checkbox checked disabled />
              <span>封面</span>
            </Label>
            <Label className="min-h-11 cursor-pointer md:min-h-0">
              <Checkbox checked={embedLyric} onChange={(e) => setEmbedLyric(e.target.checked)} />
              <span>内嵌歌词</span>
            </Label>
            <Label className="min-h-11 cursor-pointer md:min-h-0">
              <Checkbox checked={cacheLyric} onChange={(e) => setCacheLyric(e.target.checked)} />
              <span>外置歌词 (.lrc)</span>
            </Label>
          </div>
        </section>

        {/* 操作区 */}
        <div className="flex flex-wrap items-center gap-3 border-t pt-4">
          <Button type="button" onClick={() => save.mutate()} disabled={save.isPending}>
            <Save />
            保存全部设置
          </Button>
          <SaveMsg msg={msg} />
        </div>
      </CardContent>
    </Card>
  )
}

/* ── 表单二：批量下载保护 ───────────────────────── */
function ProtectionForm({ protection }: { protection: OptionsData['protection'] }) {
  const qc = useQueryClient()
  const [enabled, setEnabled] = useState(protection.enabled)
  const [downloadIntervalSec, setDownloadIntervalSec] = useState(protection.downloadIntervalSec)
  const [resolveIntervalSec, setResolveIntervalSec] = useState(protection.resolveIntervalSec)
  const [msg, setMsg] = useState<Msg | null>(null)

  const save = useMutation({
    mutationFn: () =>
      api.post<SaveResult>('/options/protection', {
        enabled,
        downloadIntervalSec,
        resolveIntervalSec,
      }),
    onSuccess: (r) => {
      setMsg({ ok: r.ok, text: r.message })
      if (r.ok) void qc.invalidateQueries({ queryKey: ['options'] })
    },
    onError: (e) => setMsg({ ok: false, text: e instanceof Error ? e.message : '保存失败' }),
  })

  return (
    <Card>
      <CardContent className="space-y-4">
        <SectionTitle>
          批量下载保护
          <InfoTip>
            下载始终<b>单任务串行、不并发</b>；失败也<b>不自动重试</b>（失败/「未满足」的歌下次同步会自动再试，急用可在历史记录页点「重试」）。
            <p className="mt-1.5">
              每首成功或失败后会等待一段时间，同时限制直链解析的请求节奏，降低音源限流或封禁 IP 的风险。<b>已下载跳过（复用本地文件）的歌不请求音源，因此不占用这个等待</b> ——
              换过同步目标后的首轮同步不会因为几百首「已下过」的歌而白等。
            </p>
          </InfoTip>
        </SectionTitle>

        <Label className="min-h-11 cursor-pointer md:min-h-0">
          <Checkbox checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>批量下载保护（推荐开启）</span>
        </Label>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="downloadIntervalSec">
              <FieldLabel className="mb-0 flex items-center gap-1.5">
                下载间隔（秒）
                <InfoTip>范围 2~60 秒，默认 5 秒；真正去音源下载的歌都会等待（含失败重试）</InfoTip>
              </FieldLabel>
            </Label>
            <Input
              id="downloadIntervalSec"
              type="number"
              min={2}
              max={60}
              value={downloadIntervalSec}
              onChange={(e) => setDownloadIntervalSec(Number(e.target.value))}
              className="w-28"
            />
          </div>
          <div>
            <Label htmlFor="resolveIntervalSec">
              <FieldLabel className="mb-0 flex items-center gap-1.5">
                直链解析间隔（秒）
                <InfoTip>范围 1~30 秒，默认 2 秒；只限制新的直链解析请求</InfoTip>
              </FieldLabel>
            </Label>
            <Input
              id="resolveIntervalSec"
              type="number"
              min={1}
              max={30}
              value={resolveIntervalSec}
              onChange={(e) => setResolveIntervalSec(Number(e.target.value))}
              className="w-28"
            />
          </div>
        </div>

        <Hint>
          当前已
          {protection.enabled
            ? `开启：下载间隔 ${protection.downloadIntervalSec} 秒，直链解析间隔 ${protection.resolveIntervalSec} 秒`
            : '关闭'}
        </Hint>

        <div className="flex flex-wrap items-center gap-3 border-t pt-4">
          <Button type="button" onClick={() => save.mutate()} disabled={save.isPending}>
            <Save />
            保存保护设置
          </Button>
          <SaveMsg msg={msg} />
        </div>

        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer select-none text-xs font-semibold">
            批量下载保护说明
          </summary>
          <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-muted-foreground">
            <li>下载任务始终按队列逐个执行，不会并发请求多个音源。</li>
            <li>间隔从上一首下载完成或失败后开始计算，等待期间下一首不会发起请求。</li>
            <li>直链解析间隔会错开连续的解析请求（换音质档位或自动重试时同样受控），避免短时间快速连发。</li>
            <li>关闭保护会取消两个间隔，但下载仍保持串行；频繁请求可能触发音源平台限流或封禁 IP。</li>
            <li>保存后影响后续请求，不会中断当前正在下载的任务。</li>
          </ul>
        </details>
      </CardContent>
    </Card>
  )
}
