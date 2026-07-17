'use client'

/**
 * 小说推文模式 - 故事输入阶段 (Story View)
 * V3.2 UI: 极简版，专注剧本输入，资产管理移至资产库
 */

import { useTranslations } from 'next-intl'
import { useState, useRef, useEffect, useCallback } from 'react'
import '@/styles/animations.css'
import AiWriteModal from '@/components/home/AiWriteModal'
import LongTextDetectionPrompt from '@/components/story-input/LongTextDetectionPrompt'
import StoryInputComposer from '@/components/story-input/StoryInputComposer'
import { ART_STYLES, VIDEO_RATIOS } from '@/lib/constants'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import { resolveTaskPresentationState } from '@/lib/task/presentation'
import { AppIcon } from '@/components/ui/icons'
import { DEFAULT_STYLE_PRESET_VALUE, STYLE_PRESETS } from '@/lib/style-presets'
import { PROJECT_STORY_INPUT_MIN_ROWS } from '@/lib/ui/textarea-height'
import { apiFetch } from '@/lib/api-fetch'
import { expandHomeStory } from '@/lib/home/ai-story-expand'
import {
  VIDEO_PROFILE_PRESET,
  resolveVideoProfile,
  type VideoProfile,
  type VideoProfilePreset,
  type VisualQualityMode,
} from '@/lib/video-profile'

/** 触发智能分集建议的字数阈值 */
const LONG_TEXT_THRESHOLD = 1000

type MaybePromise = void | Promise<void>

interface NovelInputStageProps {
  // 核心数据
  novelText: string
  // 当前剧集名称
  episodeName?: string
  // 回调函数
  onNovelTextChange: (value: string) => MaybePromise
  onNext: () => void
  /** 触发智能分集流程（携带当前文本） */
  onSmartSplit?: (text: string) => void
  // 状态
  isSubmittingTask?: boolean
  isSwitchingStage?: boolean
  // 旁白开关
  enableNarration?: boolean
  onEnableNarrationChange?: (enabled: boolean) => void
  // 配置项 - 比例与风格
  videoRatio?: string
  videoProfile?: VideoProfile
  artStyle?: string
  artStyleReferenceEnabled?: boolean
  onVideoRatioChange?: (value: string) => MaybePromise
  onVideoProfileChange?: (value: VideoProfilePreset) => MaybePromise
  onVisualQualityModeChange?: (value: VisualQualityMode) => MaybePromise
  onArtStyleChange?: (value: string) => MaybePromise
  onArtStyleReferenceEnabledChange?: (value: boolean) => MaybePromise
}

export default function NovelInputStage({
  novelText,
  episodeName,
  onNovelTextChange,
  onNext,
  onSmartSplit,
  isSubmittingTask = false,
  isSwitchingStage = false,
  enableNarration = false,
  onEnableNarrationChange,
  videoRatio = '9:16',
  videoProfile = resolveVideoProfile(undefined),
  artStyle = 'american-comic',
  artStyleReferenceEnabled = false,
  onVideoRatioChange,
  onVideoProfileChange,
  onVisualQualityModeChange,
  onArtStyleChange,
  onArtStyleReferenceEnabledChange,
}: NovelInputStageProps) {
  const t = useTranslations('novelPromotion')
  const homeT = useTranslations('home')

  // ── IME 组合输入处理 ──
  // 中文/日文/韩文输入法在组合（composing）期间会持续触发 onChange，
  // 如果此时同步到父组件（触发 API 请求 + React Query invalidation），
  // 服务端返回的旧数据会覆盖当前输入，导致拼音跳动。
  // 解决方案：组合期间仅更新本地 state，组合结束后再同步到父组件。
  const isComposingRef = useRef(false)
  const [localText, setLocalText] = useState(novelText)
  const [stylePresetValue, setStylePresetValue] = useState<string>(DEFAULT_STYLE_PRESET_VALUE)
  const [aiWriteOpen, setAiWriteOpen] = useState(false)
  const [aiWriteLoading, setAiWriteLoading] = useState(false)

  // 当父组件的 novelText 变化（非本地编辑触发）时，同步到本地 state
  useEffect(() => {
    if (!isComposingRef.current) {
      setLocalText(novelText)
    }
  }, [novelText])

  const handleCompositionStart = () => {
    isComposingRef.current = true
  }

  const handleCompositionEnd = (e: React.CompositionEvent<HTMLTextAreaElement>) => {
    isComposingRef.current = false
    // 组合结束，将最终文本同步到父组件
    onNovelTextChange(e.currentTarget.value)
  }

  const hasContent = localText.trim().length > 0
  const [showLongTextPrompt, setShowLongTextPrompt] = useState(false)

  /** 点击"开始创作"时，先检测文本长度 */
  const handleStartClick = useCallback(() => {
    const textLength = localText.trim().length
    if (
      videoProfile.preset !== VIDEO_PROFILE_PRESET.BOOK_GUIDE
      && textLength > LONG_TEXT_THRESHOLD
      && onSmartSplit
    ) {
      setShowLongTextPrompt(true)
    } else {
      onNext()
    }
  }, [localText, onNext, onSmartSplit, videoProfile.preset])

  const handleAiWriteStart = useCallback(async (prompt: string) => {
    if (aiWriteLoading) return
    setAiWriteLoading(true)
    try {
      const result = await expandHomeStory({
        apiFetch,
        prompt,
      })

      setLocalText(result.expandedText)
      onNovelTextChange(result.expandedText)
      setAiWriteOpen(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed'
      window.alert(message)
    } finally {
      setAiWriteLoading(false)
    }
  }, [aiWriteLoading, onNovelTextChange])

  // 下拉中使用的简短标签（低信息密度）
  const ratioUsageTagMap: Record<string, string> = {
    '1:1': t('storyInput.ratioUsageTag.1_1'),
    '9:16': t('storyInput.ratioUsageTag.9_16'),
    '16:9': t('storyInput.ratioUsageTag.16_9'),
    '4:3': t('storyInput.ratioUsageTag.4_3'),
    '3:4': t('storyInput.ratioUsageTag.3_4'),
    '2:3': t('storyInput.ratioUsageTag.2_3'),
    '3:2': t('storyInput.ratioUsageTag.3_2'),
    '4:5': t('storyInput.ratioUsageTag.4_5'),
    '5:4': t('storyInput.ratioUsageTag.5_4'),
    '21:9': t('storyInput.ratioUsageTag.21_9'),
  }

  const getRatioUsageTag = (ratio: string): string =>
    ratioUsageTagMap[ratio] ?? ''

  const stageSwitchingState = isSwitchingStage
    ? resolveTaskPresentationState({
      phase: 'processing',
      intent: 'generate',
      resource: 'text',
      hasOutput: false,
    })
    : null
  const configDisabled = isSubmittingTask || isSwitchingStage
  const videoProfileOptions: Array<{
    value: VideoProfilePreset
    label: string
    description: string
    icon: 'film' | 'bookOpen'
  }> = [
    {
      value: VIDEO_PROFILE_PRESET.AI_COMIC,
      label: t('storyInput.videoProfile.aiComic'),
      description: t('storyInput.videoProfile.aiComicDescription'),
      icon: 'film',
    },
    {
      value: VIDEO_PROFILE_PRESET.BOOK_GUIDE,
      label: t('storyInput.videoProfile.bookGuide'),
      description: t('storyInput.videoProfile.bookGuideDescription'),
      icon: 'bookOpen',
    },
  ]
  const qualityModeOptions: Array<{
    value: VisualQualityMode
    label: string
    description: string
    icon: 'eye' | 'sparklesAlt'
  }> = [
    {
      value: 'shadow',
      label: t('storyInput.videoProfile.qualityCheckOnly'),
      description: t('storyInput.videoProfile.qualityCheckOnlyDescription'),
      icon: 'eye',
    },
    {
      value: 'auto',
      label: t('storyInput.videoProfile.qualityAutoOptimize'),
      description: t('storyInput.videoProfile.qualityAutoOptimizeDescription'),
      icon: 'sparklesAlt',
    },
  ]

  return (
    <div className="max-w-5xl mx-auto space-y-5">

      {/* 当前编辑剧集提示 - 顶部居中醒目显示 */}
      {episodeName && (
        <div className="text-center py-1">
          <div className="text-lg font-semibold text-[var(--glass-text-primary)]">
            {t("storyInput.currentEditing", { name: episodeName })}
          </div>
          <div className="text-sm text-[var(--glass-text-tertiary)] mt-1">{t("storyInput.editingTip")}</div>
        </div>
      )}

      <div className="glass-surface p-4 space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-[var(--glass-text-primary)]">
              {t('storyInput.videoProfile.label')}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-[var(--glass-text-tertiary)]">
              {t('storyInput.videoProfile.description')}
            </p>
          </div>
          <div
            className="grid w-full grid-cols-2 gap-1 rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)] p-1 md:w-[360px]"
            role="group"
            aria-label={t('storyInput.videoProfile.label')}
          >
            {videoProfileOptions.map((option) => {
              const selected = videoProfile.preset === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  title={option.description}
                  disabled={configDisabled}
                  onClick={() => onVideoProfileChange?.(option.value)}
                  className={`flex min-h-12 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                    selected
                      ? 'border border-[var(--glass-stroke-focus)] bg-[var(--glass-bg-surface)] text-[var(--glass-text-primary)] shadow-[var(--glass-shadow-sm)]'
                      : 'border border-transparent text-[var(--glass-text-secondary)] hover:bg-[var(--glass-bg-surface-strong)] hover:text-[var(--glass-text-primary)]'
                  }`}
                >
                  <AppIcon name={option.icon} className="h-4 w-4 shrink-0" />
                  <span>{option.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="grid gap-3 border-t border-[var(--glass-stroke-soft)] pt-4 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)] md:items-start">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-[var(--glass-text-primary)]">
              {t('storyInput.videoProfile.qualityAssistLabel')}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-[var(--glass-text-tertiary)]">
              {t('storyInput.videoProfile.qualityAssistDescription')}
            </p>
          </div>
          <div
            className="grid gap-3 sm:grid-cols-2"
            role="radiogroup"
            aria-label={t('storyInput.videoProfile.qualityAssistLabel')}
          >
            {qualityModeOptions.map((option) => {
              const selected = videoProfile.qualityPolicy.mode === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={configDisabled}
                  onClick={() => onVisualQualityModeChange?.(option.value)}
                  className={`min-h-24 rounded-lg border p-3 text-left transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                    selected
                      ? 'border-[var(--glass-stroke-focus)] bg-[var(--glass-tone-info-bg)] shadow-[var(--glass-shadow-sm)]'
                      : 'border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] hover:border-[var(--glass-stroke-focus)] hover:bg-[var(--glass-bg-surface-strong)]'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${
                      selected
                        ? 'bg-[var(--glass-tone-info-fg)] text-white'
                        : 'bg-[var(--glass-bg-muted)] text-[var(--glass-text-secondary)]'
                    }`}>
                      <AppIcon name={selected ? 'check' : option.icon} className="h-4 w-4" />
                    </span>
                    <span className="font-semibold text-[var(--glass-text-primary)]">
                      {option.label}
                    </span>
                  </span>
                  <span className="mt-2 block text-xs leading-relaxed text-[var(--glass-text-tertiary)]">
                    {option.description}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* 主输入区域（含底部工具栏） */}
      <div className="relative z-10">
        <StoryInputComposer
          value={localText}
          onValueChange={(value) => {
            setLocalText(value)
            if (!isComposingRef.current) {
              onNovelTextChange(value)
            }
          }}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          placeholder={`请输入您的剧本或小说内容...\n\nAI 将根据您的文本智能分析：\n• 自动识别场景切换\n• 提取角色对话和动作\n• 生成分镜脚本\n\n例如：\n清晨，阳光透过窗帘洒进房间。小明揉着惺忪的睡眼从床上坐起，看了一眼床头的闹钟——已经八点了！他猛地跳下床，手忙脚乱地开始穿衣服...`}
          minRows={PROJECT_STORY_INPUT_MIN_ROWS}
          maxHeightViewportRatio={0.5}
          disabled={isSubmittingTask || isSwitchingStage}
          videoRatio={videoRatio}
          onVideoRatioChange={(value) => onVideoRatioChange?.(value)}
          ratioOptions={VIDEO_RATIOS.map((option) => ({
            ...option,
            recommended: option.value === '9:16'
          }))}
          getRatioUsage={getRatioUsageTag}
          artStyle={artStyle}
          onArtStyleChange={(value) => onArtStyleChange?.(value)}
          artStyleReferenceEnabled={artStyleReferenceEnabled}
          onArtStyleReferenceEnabledChange={onArtStyleReferenceEnabledChange}
          artStyleReferenceLabel={t('storyInput.artStyleReferenceImage')}
          styleOptions={ART_STYLES.map((option) => ({
            ...option,
            recommended: option.value === 'realistic'
          }))}
          stylePresetValue={stylePresetValue}
          onStylePresetChange={setStylePresetValue}
          stylePresetOptions={STYLE_PRESETS}
          textareaClassName="px-0 pt-0 pb-3 align-top"
          primaryAction={(
            <button
              onClick={handleStartClick}
              disabled={!hasContent || isSubmittingTask || isSwitchingStage}
              className="glass-btn-base glass-btn-primary h-10 flex-shrink-0 px-5 text-sm disabled:opacity-50 flex items-center gap-2"
            >
              {isSwitchingStage ? (
                <TaskStatusInline state={stageSwitchingState} className="text-white [&>span]:text-white [&_svg]:text-white" />
              ) : (
                <>
                  <span>{t("smartImport.manualCreate.button")}</span>
                  <AppIcon name="arrowRight" className="w-4 h-4" />
                </>
              )}
            </button>
          )}
          secondaryActions={(
            <button
              onClick={() => setAiWriteOpen(true)}
              disabled={isSubmittingTask || isSwitchingStage}
              className="glass-btn-base flex h-10 flex-shrink-0 items-center gap-1.5 border border-[var(--glass-stroke-strong)] px-3 text-sm transition-all hover:border-[var(--glass-tone-info-fg)]/40"
            >
              <AppIcon name="sparkles" className="w-4 h-4 text-[#7c3aed]" />
              <span
                className="font-medium"
                style={{
                  background: 'linear-gradient(135deg, #3b82f6, #7c3aed)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                {homeT('aiWrite.trigger')}
              </span>
            </button>
          )}
        />
      </div>
      <AiWriteModal
        open={aiWriteOpen}
        loading={aiWriteLoading}
        onClose={() => setAiWriteOpen(false)}
        onStart={(prompt) => void handleAiWriteStart(prompt)}
        t={(key: string) => homeT(`aiWrite.${key}`)}
      />

      {/* 资产库引导提示 */}
      <div className="glass-surface p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 glass-surface-soft rounded-xl flex items-center justify-center flex-shrink-0">
            <AppIcon name="folderCards" className="w-5 h-5 text-[var(--glass-text-secondary)]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-[var(--glass-text-secondary)] mb-1">{t("storyInput.assetLibraryTip.title")}</div>
            <p className="text-sm text-[var(--glass-text-tertiary)] leading-relaxed">
              {t("storyInput.assetLibraryTip.description")}
            </p>
          </div>
        </div>
      </div>

      {/* 旁白开关 */}
      {onEnableNarrationChange && (
        <div className="glass-surface p-6">
          <div className="glass-surface-soft flex items-center justify-between p-4 rounded-xl">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[var(--glass-tone-info-bg)] text-[var(--glass-tone-info-fg)] font-semibold text-sm">VO</span>
              <div>
                <div className="font-medium text-[var(--glass-text-primary)]">{t("storyInput.narration.title")}</div>
                <div className="text-xs text-[var(--glass-text-tertiary)]">{t("storyInput.narration.description")}</div>
              </div>
            </div>
            <button
              onClick={() => onEnableNarrationChange(!enableNarration)}
              className={`relative w-14 h-8 rounded-full transition-colors ${enableNarration
                ? 'bg-[var(--glass-accent-from)]'
                : 'bg-[var(--glass-stroke-strong)]'
                }`}
            >
              <span
                className={`absolute top-1 left-1 w-6 h-6 bg-[var(--glass-bg-surface)] rounded-full shadow-sm transition-transform ${enableNarration ? 'translate-x-6' : 'translate-x-0'
                  }`}
              />
            </button>
          </div>
        </div>
      )}

      <LongTextDetectionPrompt
        open={showLongTextPrompt}
        copy={{
          title: t('storyInput.longTextDetection.title'),
          description: t('storyInput.longTextDetection.description', {
            count: localText.trim().length.toLocaleString(),
          }),
          strongRecommend: t('storyInput.longTextDetection.strongRecommend'),
          smartSplitLabel: t('storyInput.longTextDetection.smartSplit'),
          smartSplitBadge: t('storyInput.longTextDetection.smartSplitRecommend'),
          continueLabel: t('storyInput.longTextDetection.continueAnyway'),
          continueHint: t('storyInput.longTextDetection.singleEpisodeWarning'),
        }}
        onClose={() => setShowLongTextPrompt(false)}
        onSmartSplit={() => {
          setShowLongTextPrompt(false)
          onSmartSplit?.(localText)
        }}
        onContinue={() => {
          setShowLongTextPrompt(false)
          onNext()
        }}
      />
    </div>
  )
}
