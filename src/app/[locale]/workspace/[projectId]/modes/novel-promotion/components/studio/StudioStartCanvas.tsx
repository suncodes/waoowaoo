'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import AiWriteModal from '@/components/home/AiWriteModal'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { ART_STYLES, VIDEO_RATIOS } from '@/lib/constants'
import { expandHomeStory } from '@/lib/home/ai-story-expand'
import {
  VIDEO_PROFILE_PRESET,
  type VideoProfilePreset,
  type VisualQualityMode,
} from '@/lib/video-profile'
import { useWorkspaceStageRuntime } from '../../WorkspaceStageRuntimeContext'
import {
  StudioButton,
  StudioMetric,
  StudioPanel,
  StudioProcessSteps,
  StudioSectionHeader,
  StudioStageHeader,
} from './StudioPrimitives'
import { type StudioProductStatus, type StudioWorkspaceModel } from './studio-types'

interface StudioStartCanvasProps {
  model: StudioWorkspaceModel
}

const PROFILE_OPTIONS: Array<{
  value: VideoProfilePreset
  label: string
  description: string
  icon: 'film' | 'bookOpen'
}> = [
  {
    value: VIDEO_PROFILE_PRESET.AI_COMIC,
    label: 'AI 漫剧',
    description: '剧情冲突、角色表演、连续镜头和视频化叙事优先。',
    icon: 'film',
  },
  {
    value: VIDEO_PROFILE_PRESET.BOOK_GUIDE,
    label: '书籍导读',
    description: '观点提炼、章节脉络、解说文稿和资料型画面优先。',
    icon: 'bookOpen',
  },
]

const QUALITY_OPTIONS: Array<{
  value: VisualQualityMode
  label: string
  description: string
  icon: 'eye' | 'sparklesAlt'
}> = [
  {
    value: 'shadow',
    label: '仅提醒',
    description: '记录画面问题，不阻断后续镜头生产。',
    icon: 'eye',
  },
  {
    value: 'auto',
    label: '自动修复',
    description: '发现明显画面问题时自动调整提示词并重试。',
    icon: 'sparklesAlt',
  },
]

export default function StudioStartCanvas({ model }: StudioStartCanvasProps) {
  const runtime = useWorkspaceStageRuntime()
  const homeT = useTranslations('home')
  const [text, setText] = useState(model.novelText)
  const [saving, setSaving] = useState(false)
  const [configSaving, setConfigSaving] = useState('')
  const [configError, setConfigError] = useState('')
  const [aiWriteOpen, setAiWriteOpen] = useState(false)
  const [aiWriteLoading, setAiWriteLoading] = useState(false)

  useEffect(() => setText(model.novelText), [model.novelText])

  const saveText = async () => {
    if (text === model.novelText) return
    setSaving(true)
    try {
      await runtime.onNovelTextChange(text)
    } finally {
      setSaving(false)
    }
  }

  const start = async () => {
    await saveText()
    await runtime.onRunStoryToScript()
  }

  const updateConfig = async (key: string, operation: () => Promise<void>) => {
    setConfigSaving(key)
    setConfigError('')
    try {
      await operation()
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : '配置保存失败')
    } finally {
      setConfigSaving('')
    }
  }

  const handleAiWriteStart = async (prompt: string) => {
    if (aiWriteLoading) return
    setAiWriteLoading(true)
    try {
      const result = await expandHomeStory({ apiFetch, prompt })
      setText(result.expandedText)
      await runtime.onNovelTextChange(result.expandedText)
      setAiWriteOpen(false)
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : 'AI 写作失败')
    } finally {
      setAiWriteLoading(false)
    }
  }

  const textLength = text.trim().length
  const hasUnsavedInput = text !== model.novelText
  const isBookGuide = runtime.videoProfile.preset === VIDEO_PROFILE_PRESET.BOOK_GUIDE
  const inputPlaceholder = isBookGuide
    ? '输入书名、作者、章节范围或你的解读角度。例如：《海底两万里》，重点讲尼摩船长与海洋想象。'
    : '输入原文、剧情梗概或分集资料。系统会先整理文稿，再进入视觉资产和分镜制作。'
  const processSteps: Array<{ label: string; helper: string; status: StudioProductStatus }> = [
    {
      label: '简报输入',
      helper: hasUnsavedInput ? '有未保存修改' : textLength > 0 ? `${textLength} 字` : '等待输入',
      status: textLength === 0 ? 'empty' : hasUnsavedInput ? 'drafting' : 'locked',
    },
    {
      label: '文稿初稿',
      helper: model.draftSegments.length > 0 ? `${model.draftSegments.length} 段` : '生成后进入编辑',
      status: runtime.isTransitioning ? 'generating' : model.draftSegments.length > 0 ? 'locked' : 'empty',
    },
    {
      label: '视觉资产',
      helper: model.workflow.hasVisualPlan ? `缺失核心 ${model.summary.missingCoreVisualAssets}` : '从文稿提取',
      status: model.workflow.visualApproved ? 'locked' : model.workflow.hasVisualPlan ? 'needs_review' : 'empty',
    },
    {
      label: '镜头生产',
      helper: model.shots.length > 0 ? `${model.shots.length} 个镜头` : '分镜确认后开始',
      status: model.workflow.hasVideo ? 'locked' : model.shots.length > 0 ? 'drafting' : 'empty',
    },
  ]
  return (
    <div className="space-y-4">
      <StudioPanel padding="none">
        <StudioStageHeader
          eyebrow="项目简报"
          title="制作输入台"
          description="先确定作品类型、画幅和视觉风格，再输入原始材料。后续文稿、视觉资产和分镜会按这里的业务设定承接。"
          actions={(
            <>
              <StudioButton variant="secondary" icon="sparklesAlt" onClick={() => setAiWriteOpen(true)} disabled={runtime.isTransitioning || saving}>
                AI 写作
              </StudioButton>
              <StudioButton icon="sparkles" loading={runtime.isTransitioning || saving} onClick={() => { void start() }} disabled={!text.trim()}>
                {isBookGuide ? '生成导读框架' : '生成文稿初稿'}
              </StudioButton>
            </>
          )}
        />
        <div className="border-b border-white/10 px-6 py-4">
          <StudioProcessSteps steps={processSteps} />
        </div>
      </StudioPanel>

      {configError ? (
        <div className="rounded-md border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
          {configError}
        </div>
      ) : null}

      <div className="grid min-h-[560px] gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
        <StudioPanel padding="none" className="grid min-h-[560px] grid-rows-[auto_1fr_auto]">
          <div className="border-b border-white/10 px-5 py-4">
            <StudioSectionHeader
              title={isBookGuide ? '书籍与解读材料' : '剧情与分集材料'}
              description={isBookGuide ? '可以只输入经典书名，也可以补充章节范围、观点和引用材料。' : '支持完整原文、剧情梗概或制作资料。离开输入框时会自动保存。'}
              actions={(
                <>
                  <StudioButton size="sm" variant="ghost" icon="sparklesAlt" onClick={() => setAiWriteOpen(true)} disabled={saving || runtime.isTransitioning}>
                    AI 扩写
                  </StudioButton>
                  <StudioButton size="sm" variant="secondary" icon="check" loading={saving} onClick={() => { void saveText() }} disabled={!hasUnsavedInput}>
                    保存输入
                  </StudioButton>
                </>
              )}
            />
          </div>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            onBlur={() => { void saveText() }}
            placeholder={inputPlaceholder}
            className="min-h-0 resize-none bg-[#0f100e] p-5 text-base leading-7 text-stone-100 outline-none placeholder:text-stone-600"
          />
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-5 py-3">
            <span className="text-xs text-stone-500">{saving ? '正在保存输入...' : `${textLength} 字`}</span>
            <span className="text-xs text-stone-500">{hasUnsavedInput ? '修改后会先保存再生成' : '输入已同步'}</span>
          </div>
        </StudioPanel>

        <aside className="space-y-4">
          <StudioPanel className="space-y-5">
            <StudioSectionHeader title="作品类型" description="类型会影响内容结构、分镜语言和旁白方式。" />
            <div className="grid gap-2">
              {PROFILE_OPTIONS.map((option) => {
                const selected = runtime.videoProfile.preset === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => { void updateConfig(`profile:${option.value}`, () => runtime.onVideoProfileChange(option.value)) }}
                    disabled={!!configSaving || runtime.isTransitioning}
                    className={`rounded-md border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${selected
                      ? 'border-[#e8d18a]/70 bg-[#e8d18a]/10'
                      : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className={`flex h-9 w-9 items-center justify-center rounded-md ${selected ? 'bg-[#f3e9cf] text-[#15130f]' : 'bg-white/[0.06] text-stone-400'}`}>
                        <AppIcon name={configSaving === `profile:${option.value}` ? 'loader' : option.icon} className={`h-4 w-4 ${configSaving === `profile:${option.value}` ? 'animate-spin' : ''}`} />
                      </span>
                      <span>
                        <span className="block text-sm font-semibold text-stone-50">{option.label}</span>
                        <span className="mt-0.5 block text-xs leading-5 text-stone-500">{option.description}</span>
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          </StudioPanel>

          <StudioPanel className="space-y-4">
            <StudioSectionHeader title="制作规格" description="约束画幅、视觉风格和画面检查策略。" />
            <label className="block">
              <span className="mb-2 block text-xs font-semibold text-stone-500">画幅</span>
              <select
                value={runtime.videoRatio || '9:16'}
                onChange={(event) => { void updateConfig('ratio', () => runtime.onVideoRatioChange(event.target.value)) }}
                disabled={!!configSaving}
                className="h-10 w-full rounded-md border border-white/10 bg-[#0f100e] px-3 text-sm text-stone-100 outline-none focus:border-[#e8d18a]"
              >
                {VIDEO_RATIOS.map((ratio) => (
                  <option key={ratio.value} value={ratio.value}>{ratio.label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-xs font-semibold text-stone-500">画面风格</span>
              <select
                value={runtime.artStyle || 'american-comic'}
                onChange={(event) => { void updateConfig('style', () => runtime.onArtStyleChange(event.target.value)) }}
                disabled={!!configSaving}
                className="h-10 w-full rounded-md border border-white/10 bg-[#0f100e] px-3 text-sm text-stone-100 outline-none focus:border-[#e8d18a]"
              >
                {ART_STYLES.map((style) => (
                  <option key={style.value} value={style.value}>{style.label}</option>
                ))}
              </select>
            </label>
            <div>
              <div className="mb-2 text-xs font-semibold text-stone-500">画面检查</div>
              <div className="grid grid-cols-2 gap-2">
                {QUALITY_OPTIONS.map((option) => {
                  const selected = runtime.videoProfile.qualityPolicy.mode === option.value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => { void updateConfig(`quality:${option.value}`, () => runtime.onVisualQualityModeChange(option.value)) }}
                      disabled={!!configSaving}
                      className={`rounded-md border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${selected
                        ? 'border-[#e8d18a]/70 bg-[#e8d18a]/10'
                        : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'
                      }`}
                    >
                      <span className="flex items-center gap-2 text-sm font-semibold text-stone-100">
                        <AppIcon name={configSaving === `quality:${option.value}` ? 'loader' : option.icon} className={`h-4 w-4 text-[#e8d18a] ${configSaving === `quality:${option.value}` ? 'animate-spin' : ''}`} />
                        {option.label}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-stone-500">{option.description}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </StudioPanel>

          <StudioPanel>
            <StudioSectionHeader title="生成范围" description="第一步只生成文稿初稿，不直接跳过资产和分镜确认。" />
            <div className="mt-4 grid grid-cols-2 gap-3">
              <StudioMetric label="文稿段落" value={model.draftSegments.length || '-'} />
              <StudioMetric label="镜头数量" value={model.shots.length || '-'} />
              <StudioMetric label="核心资产缺口" value={model.summary.missingCoreVisualAssets} />
              <StudioMetric label="完成视频" value={model.summary.completedVideos} />
            </div>
          </StudioPanel>
        </aside>
      </div>
      <AiWriteModal
        open={aiWriteOpen}
        loading={aiWriteLoading}
        onClose={() => setAiWriteOpen(false)}
        onStart={(prompt) => { void handleAiWriteStart(prompt) }}
        t={(key: string) => homeT(`aiWrite.${key}`)}
      />
    </div>
  )
}
