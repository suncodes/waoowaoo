'use client'

import { useMemo, useState } from 'react'

import { ART_STYLES } from '@/lib/constants'

type ProviderMode = 'openai-compatible' | 'ark'
type PromptVersion = 'old' | 'new'
type ReferenceMode = 'text-only' | 'with-reference'
type PromptLocale = 'zh' | 'en'
type ResponseFormat = 'b64_json' | 'url' | 'omit'

interface VariantOption {
  key: string
  label: string
  promptVersion: PromptVersion
  referenceMode: ReferenceMode
}

interface ResultItem {
  id: string
  styleValue: string
  styleLabel: string
  variantKey: string
  variantLabel: string
  imageUrl?: string
  prompt?: string
  error?: string
  startedAt: string
  finishedAt?: string
}

const VARIANTS: VariantOption[] = [
  {
    key: 'old-text-only',
    label: '旧提示词 / 纯文本',
    promptVersion: 'old',
    referenceMode: 'text-only',
  },
  {
    key: 'new-text-only',
    label: '新提示词 / 纯文本',
    promptVersion: 'new',
    referenceMode: 'text-only',
  },
  {
    key: 'new-with-reference',
    label: '新提示词 / 风格参考图',
    promptVersion: 'new',
    referenceMode: 'with-reference',
  },
]

const PROMPT_PRESETS = [
  {
    label: '人物设定',
    value: '一个18岁少年探险家，站在神秘海底城市入口，手持旧地图，脸上带着惊讶和好奇，电影级构图，画面中不得出现文字。',
  },
  {
    label: '海底奇观',
    value: '鹦鹉螺号潜艇穿越发光珊瑚海底峡谷，远处有巨大的鲸影和神秘遗迹，广角镜头，画面中不得出现文字。',
  },
  {
    label: '室内对话',
    value: '一位沉稳的船长站在复古潜艇控制室内，身后是复杂仪表和圆形舷窗，侧光照亮面部，画面中不得出现文字。',
  },
]

const DEFAULT_STYLES = new Set(['american-comic', 'chinese-comic', 'realistic', '3d-animation', 'cinematic-cg'])

const PROVIDER_DEFAULTS: Record<ProviderMode, {
  baseUrl: string
  model: string
  size: string
  responseFormat: ResponseFormat
}> = {
  ark: {
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seedream-4-5-251128',
    size: '2560x1440',
    responseFormat: 'url',
  },
  'openai-compatible': {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-image-1',
    size: '1024x1024',
    responseFormat: 'b64_json',
  },
}

function buildRunId(styleValue: string, variantKey: string): string {
  return `${styleValue}:${variantKey}:${Date.now()}`
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export default function ArtStyleAbClient() {
  const [provider, setProvider] = useState<ProviderMode>('ark')
  const [baseUrl, setBaseUrl] = useState(PROVIDER_DEFAULTS.ark.baseUrl)
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(PROVIDER_DEFAULTS.ark.model)
  const [size, setSize] = useState(PROVIDER_DEFAULTS.ark.size)
  const [responseFormat, setResponseFormat] = useState<ResponseFormat>(PROVIDER_DEFAULTS.ark.responseFormat)
  const [outputFormat, setOutputFormat] = useState('')
  const [quality, setQuality] = useState('')
  const [promptLocale, setPromptLocale] = useState<PromptLocale>('zh')
  const [contentPrompt, setContentPrompt] = useState(PROMPT_PRESETS[1].value)
  const [selectedStyles, setSelectedStyles] = useState<Set<string>>(() => new Set(DEFAULT_STYLES))
  const [selectedVariants, setSelectedVariants] = useState<Set<string>>(
    () => new Set(VARIANTS.map((variant) => variant.key)),
  )
  const [results, setResults] = useState<ResultItem[]>([])
  const [running, setRunning] = useState(false)
  const [currentTask, setCurrentTask] = useState('')

  const selectedStyleList = useMemo(
    () => ART_STYLES.filter((style) => selectedStyles.has(style.value)),
    [selectedStyles],
  )
  const selectedVariantList = useMemo(
    () => VARIANTS.filter((variant) => selectedVariants.has(variant.key)),
    [selectedVariants],
  )
  const totalTasks = selectedStyleList.length * selectedVariantList.length

  const changeProvider = (value: ProviderMode) => {
    const defaults = PROVIDER_DEFAULTS[value]
    setProvider(value)
    setBaseUrl(defaults.baseUrl)
    setModel(defaults.model)
    setSize(defaults.size)
    setResponseFormat(defaults.responseFormat)
  }

  const toggleStyle = (value: string) => {
    setSelectedStyles((previous) => {
      const next = new Set(previous)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
  }

  const toggleVariant = (value: string) => {
    setSelectedVariants((previous) => {
      const next = new Set(previous)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
  }

  const runTests = async () => {
    if (running) return
    if ((provider === 'openai-compatible' && !baseUrl.trim()) || !apiKey.trim() || !model.trim() || !contentPrompt.trim()) {
      alert('请填写 provider、apiKey、model 和测试 Prompt；OpenAI-compatible 还需要 baseUrl。')
      return
    }
    if (totalTasks === 0) {
      alert('请至少选择一个风格和一个测试变体。')
      return
    }

    setRunning(true)
    setCurrentTask('')
    setResults([])

    const nextResults: ResultItem[] = []
    for (const style of selectedStyleList) {
      for (const variant of selectedVariantList) {
        const id = buildRunId(style.value, variant.key)
        const startedAt = new Date().toISOString()
        setCurrentTask(`${style.label} · ${variant.label}`)

        try {
          const response = await fetch('/api/dev/art-style-ab/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              provider,
              baseUrl,
              apiKey,
              model,
              contentPrompt,
              styleValue: style.value,
              promptVersion: variant.promptVersion,
              referenceMode: variant.referenceMode,
              promptLocale,
              size,
              responseFormat,
              outputFormat,
              quality,
            }),
          })
          const payload = await response.json().catch(() => ({}))
          if (!response.ok) {
            throw new Error(typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`)
          }

          nextResults.push({
            id,
            styleValue: style.value,
            styleLabel: style.label,
            variantKey: variant.key,
            variantLabel: variant.label,
            imageUrl: typeof payload.imageUrl === 'string' ? payload.imageUrl : undefined,
            prompt: typeof payload.prompt === 'string' ? payload.prompt : undefined,
            startedAt,
            finishedAt: new Date().toISOString(),
          })
        } catch (error) {
          nextResults.push({
            id,
            styleValue: style.value,
            styleLabel: style.label,
            variantKey: variant.key,
            variantLabel: variant.label,
            error: error instanceof Error ? error.message : String(error),
            startedAt,
            finishedAt: new Date().toISOString(),
          })
        }
        setResults([...nextResults])
      }
    }

    setCurrentTask('')
    setRunning(false)
  }

  const exportManifest = () => {
    downloadJson(`art-style-ab-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, {
      generatedAt: new Date().toISOString(),
      config: {
        provider,
        baseUrl,
        model,
        size,
        responseFormat,
        outputFormat: outputFormat || null,
        quality: quality || null,
        promptLocale,
        contentPrompt,
        selectedStyles: selectedStyleList.map((style) => ({
          value: style.value,
          label: style.label,
          referenceImage: style.referenceImage || null,
        })),
        selectedVariants: selectedVariantList,
      },
      results,
    })
  }

  return (
    <div className="min-h-screen bg-[var(--glass-bg-canvas)] text-[var(--glass-text-primary)]">
      <div className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 rounded-2xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] p-5 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h1 className="text-2xl font-bold">画面风格 A/B 测试</h1>
              <p className="mt-2 max-w-3xl text-sm text-[var(--glass-text-secondary)]">
                开发专用页面：直接调用图片模型接口，对比旧提示词、新提示词、以及“新提示词 + 风格参考图”的效果。不走项目、数据库、任务队列或对象存储。
              </p>
            </div>
            <div className="rounded-xl border border-[var(--glass-stroke-warning)] bg-[var(--glass-tone-warning-bg)] px-3 py-2 text-xs text-[var(--glass-tone-warning-fg)]">
              Key 仅随本次请求发送到服务端 API，不保存到数据库或 localStorage。
            </div>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[420px_minmax(0,1fr)]">
          <aside className="space-y-5">
            <section className="rounded-2xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] p-4">
              <h2 className="mb-3 text-sm font-semibold">模型配置</h2>
              <div className="space-y-3">
                <label className="block text-xs font-medium text-[var(--glass-text-secondary)]">
                  Provider
                  <select
                    value={provider}
                    onChange={(event) => changeProvider(event.target.value as ProviderMode)}
                    className="mt-1 w-full rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)] px-3 py-2 text-sm outline-none focus:border-[var(--glass-stroke-focus)]"
                  >
                    <option value="ark">火山引擎 Ark</option>
                    <option value="openai-compatible">OpenAI-compatible</option>
                  </select>
                </label>
                <label className="block text-xs font-medium text-[var(--glass-text-secondary)]">
                  Base URL
                  <input
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.target.value)}
                    placeholder="https://api.openai.com/v1"
                    className="mt-1 w-full rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)] px-3 py-2 text-sm outline-none focus:border-[var(--glass-stroke-focus)]"
                  />
                </label>
                <label className="block text-xs font-medium text-[var(--glass-text-secondary)]">
                  API Key
                  <input
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    type="password"
                    placeholder="sk-..."
                    autoComplete="off"
                    className="mt-1 w-full rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)] px-3 py-2 text-sm outline-none focus:border-[var(--glass-stroke-focus)]"
                  />
                </label>
                <label className="block text-xs font-medium text-[var(--glass-text-secondary)]">
                  Model
                  <input
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    placeholder="gpt-image-1"
                    className="mt-1 w-full rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)] px-3 py-2 text-sm outline-none focus:border-[var(--glass-stroke-focus)]"
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-xs font-medium text-[var(--glass-text-secondary)]">
                    Size
                    <input
                      value={size}
                      onChange={(event) => setSize(event.target.value)}
                      placeholder="1024x1024"
                      className="mt-1 w-full rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)] px-3 py-2 text-sm outline-none focus:border-[var(--glass-stroke-focus)]"
                    />
                  </label>
                  <label className="block text-xs font-medium text-[var(--glass-text-secondary)]">
                    Prompt 语言
                    <select
                      value={promptLocale}
                      onChange={(event) => setPromptLocale(event.target.value as PromptLocale)}
                      className="mt-1 w-full rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)] px-3 py-2 text-sm outline-none focus:border-[var(--glass-stroke-focus)]"
                    >
                      <option value="zh">中文</option>
                      <option value="en">English</option>
                    </select>
                  </label>
                  <label className="block text-xs font-medium text-[var(--glass-text-secondary)]">
                    Response Format
                    <select
                      value={responseFormat}
                      onChange={(event) => setResponseFormat(event.target.value as ResponseFormat)}
                      className="mt-1 w-full rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)] px-3 py-2 text-sm outline-none focus:border-[var(--glass-stroke-focus)]"
                    >
                      <option value="b64_json">b64_json</option>
                      <option value="url">url</option>
                      <option value="omit">不传</option>
                    </select>
                  </label>
                  <label className="block text-xs font-medium text-[var(--glass-text-secondary)]">
                    Output Format
                    <input
                      value={outputFormat}
                      onChange={(event) => setOutputFormat(event.target.value)}
                      placeholder="png / jpeg / webp"
                      className="mt-1 w-full rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)] px-3 py-2 text-sm outline-none focus:border-[var(--glass-stroke-focus)]"
                    />
                  </label>
                  <label className="col-span-2 block text-xs font-medium text-[var(--glass-text-secondary)]">
                    Quality
                    <input
                      value={quality}
                      onChange={(event) => setQuality(event.target.value)}
                      placeholder="low / medium / high / auto，可留空"
                      className="mt-1 w-full rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)] px-3 py-2 text-sm outline-none focus:border-[var(--glass-stroke-focus)]"
                    />
                  </label>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] p-4">
              <h2 className="mb-3 text-sm font-semibold">测试 Prompt</h2>
              <div className="mb-3 flex flex-wrap gap-2">
                {PROMPT_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setContentPrompt(preset.value)}
                    className="rounded-full border border-[var(--glass-stroke-base)] px-3 py-1 text-xs text-[var(--glass-text-secondary)] hover:border-[var(--glass-stroke-focus)] hover:text-[var(--glass-text-primary)]"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <textarea
                value={contentPrompt}
                onChange={(event) => setContentPrompt(event.target.value)}
                rows={7}
                className="w-full resize-y rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)] px-3 py-2 text-sm outline-none focus:border-[var(--glass-stroke-focus)]"
              />
            </section>

            <section className="rounded-2xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] p-4">
              <h2 className="mb-3 text-sm font-semibold">测试变体</h2>
              <div className="space-y-2">
                {VARIANTS.map((variant) => (
                  <label key={variant.key} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedVariants.has(variant.key)}
                      onChange={() => toggleVariant(variant.key)}
                    />
                    <span>{variant.label}</span>
                  </label>
                ))}
              </div>
            </section>
          </aside>

          <main className="space-y-5">
            <section className="rounded-2xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] p-4">
              <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-sm font-semibold">选择风格</h2>
                  <p className="mt-1 text-xs text-[var(--glass-text-tertiary)]">
                    已选 {selectedStyleList.length} 个风格，预计生成 {totalTasks} 张图。
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedStyles(new Set(ART_STYLES.map((style) => style.value)))}
                    className="rounded-lg border border-[var(--glass-stroke-base)] px-3 py-1.5 text-xs hover:border-[var(--glass-stroke-focus)]"
                  >
                    全选
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedStyles(new Set())}
                    className="rounded-lg border border-[var(--glass-stroke-base)] px-3 py-1.5 text-xs hover:border-[var(--glass-stroke-focus)]"
                  >
                    清空
                  </button>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {ART_STYLES.map((style) => (
                  <button
                    key={style.value}
                    type="button"
                    onClick={() => toggleStyle(style.value)}
                    className={`overflow-hidden rounded-xl border text-left transition ${
                      selectedStyles.has(style.value)
                        ? 'border-[var(--glass-stroke-focus)] bg-[var(--glass-tone-info-bg)]'
                        : 'border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)] hover:border-[var(--glass-stroke-focus)]'
                    }`}
                  >
                    {style.previewImage && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={style.previewImage} alt={style.label} className="h-28 w-full object-cover" />
                    )}
                    <div className="p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{style.label}</span>
                        <span className="rounded-full bg-[var(--glass-bg-surface)] px-2 py-0.5 text-xs text-[var(--glass-text-tertiary)]">
                          {style.preview}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-[var(--glass-text-secondary)]">
                        {style.promptZh}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </section>

            <section className="sticky top-0 z-10 rounded-2xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] p-4 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-sm font-semibold">运行</h2>
                  <p className="mt-1 text-xs text-[var(--glass-text-tertiary)]">
                    {running ? `正在生成：${currentTask}` : '结果只保留在当前页面内，可导出 manifest。'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={exportManifest}
                    disabled={results.length === 0}
                    className="rounded-lg border border-[var(--glass-stroke-base)] px-4 py-2 text-sm disabled:opacity-50"
                  >
                    导出 manifest
                  </button>
                  <button
                    type="button"
                    onClick={runTests}
                    disabled={running}
                    className="rounded-lg bg-[var(--glass-accent-from)] px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {running ? '生成中...' : `开始测试 ${totalTasks || ''}`}
                  </button>
                </div>
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
              {results.map((item) => (
                <article key={item.id} className="overflow-hidden rounded-2xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)]">
                  <div className="border-b border-[var(--glass-stroke-base)] p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-semibold">{item.styleLabel}</h3>
                        <p className="text-xs text-[var(--glass-text-tertiary)]">{item.variantLabel}</p>
                      </div>
                      <span className="rounded-full bg-[var(--glass-bg-muted)] px-2 py-0.5 text-[10px] text-[var(--glass-text-tertiary)]">
                        {item.finishedAt ? 'done' : 'running'}
                      </span>
                    </div>
                  </div>
                  {item.error ? (
                    <div className="p-4 text-sm text-[var(--glass-tone-danger-fg)]">
                      {item.error}
                    </div>
                  ) : item.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.imageUrl} alt={`${item.styleLabel} ${item.variantLabel}`} className="aspect-square w-full bg-[var(--glass-bg-muted)] object-contain" />
                  ) : (
                    <div className="flex aspect-square items-center justify-center text-sm text-[var(--glass-text-tertiary)]">
                      等待结果
                    </div>
                  )}
                  {item.prompt && (
                    <details className="border-t border-[var(--glass-stroke-base)] p-3">
                      <summary className="cursor-pointer text-xs font-medium text-[var(--glass-text-secondary)]">查看实际 Prompt</summary>
                      <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--glass-bg-muted)] p-2 text-[11px] text-[var(--glass-text-secondary)]">
                        {item.prompt}
                      </pre>
                    </details>
                  )}
                </article>
              ))}
            </section>
          </main>
        </div>
      </div>
    </div>
  )
}
