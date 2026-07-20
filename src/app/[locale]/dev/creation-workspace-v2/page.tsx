'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { resolveVideoProfile, VIDEO_PROFILE_PRESET } from '@/lib/video-profile'
import { CREATION_STAGE_REGISTRY, type CreationStageId } from '@/lib/creation-workspace/stages'
import CreationWorkspaceShell from '../../workspace/[projectId]/modes/novel-promotion/components/workspace-v2/CreationWorkspaceShell'
import type { WorkspaceRunStreamState } from '../../workspace/[projectId]/modes/novel-promotion/components/workspace-run-types'
import type { CreationStageNavItem } from '../../workspace/[projectId]/modes/novel-promotion/hooks/useCreationStageNavigation'

function createPreviewStream(): WorkspaceRunStreamState {
  return {
    runState: null,
    runId: 'preview-run',
    status: 'completed',
    isRunning: false,
    isRecoveredRunning: false,
    isVisible: true,
    errorMessage: '',
    summary: null,
    payload: null,
    stages: [
      { id: 'prepare', title: '准备创作材料', subtitle: '已读取视频类型和来源内容', status: 'completed', progress: 100, retryable: false },
      { id: 'generate', title: '形成阶段结果', subtitle: '已生成可供确认的内容', status: 'completed', progress: 100, retryable: false },
    ],
    orderedSteps: [],
    activeStepId: null,
    selectedStep: null,
    outputText: '【最终结果】阶段结果已经生成，可以在中央制作区查看。',
    overallProgress: 100,
    activeMessage: '阶段结果已生成',
    run: async () => ({ runId: 'preview-run', status: 'completed', summary: null, payload: null, errorMessage: '' }),
    retryStep: async () => ({ runId: 'preview-run', status: 'running', summary: null, payload: null, errorMessage: '' }),
    stop: () => undefined,
    reset: () => undefined,
    selectStep: () => undefined,
  }
}

function PreviewStageBody({ stageId }: { stageId: CreationStageId }) {
  const contentByStage: Record<CreationStageId, { title: string; rows: string[] }> = {
    setup: {
      title: '《海底两万里》导读视频',
      rows: ['视频类型：书籍导读', '目标时长：3 分钟', '画面比例：16:9'],
    },
    content: {
      title: '内容文稿',
      rows: ['开场：为什么这艘潜水艇影响了后来一百年的想象', '主体：尼摩船长、鹦鹉螺号与海底世界', '结尾：这本书今天仍值得阅读的原因'],
    },
    'visual-design': {
      title: '核心画面元素',
      rows: ['鹦鹉螺号：需要保持一致', '尼摩船长：重复出现时保持一致', '科学图解模板：统一版式'],
    },
    'storyboard-preview': {
      title: '分镜预演',
      rows: ['镜头 01 · 海面与潜水艇轮廓 · 8 秒', '镜头 02 · 鹦鹉螺号内部 · 12 秒', '镜头 03 · 海底探索 · 10 秒'],
    },
    production: {
      title: '镜头制作',
      rows: ['12 个镜头已完成', '2 个镜头正在生成', '1 个镜头需要确认'],
    },
    edit: {
      title: '剪辑成片',
      rows: ['总时长：02:56', '字幕：已生成', '导出规格：1080p · 16:9'],
    },
  }
  const content = contentByStage[stageId]

  return (
    <section className="glass-surface overflow-hidden">
      <div className="border-b border-[var(--glass-stroke-base)] px-5 py-4">
        <h2 className="text-base font-semibold text-[var(--glass-text-primary)]">{content.title}</h2>
      </div>
      <div className="divide-y divide-[var(--glass-stroke-soft)] px-5">
        {content.rows.map((row, index) => (
          <div key={row} className="flex min-h-14 items-center gap-3 py-3 text-sm text-[var(--glass-text-secondary)]">
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--glass-bg-muted)] text-xs font-semibold text-[var(--glass-text-primary)]">
              {index + 1}
            </span>
            <span>{row}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

export default function CreationWorkspaceV2PreviewPage() {
  const t = useTranslations('novelPromotion.workspaceFlow.v2')
  const [currentStage, setCurrentStage] = useState<CreationStageId>('content')
  const items = useMemo<CreationStageNavItem[]>(() => CREATION_STAGE_REGISTRY.map((stage, index) => ({
    id: stage.id,
    icon: stage.icon,
    label: t(stage.labelKey),
    description: t(stage.descriptionKey),
    status: index <= 2 ? 'completed' : index === 3 ? 'ready' : 'not_started',
    issueCount: 0,
  })), [t])
  const completedStream = useMemo(createPreviewStream, [])
  const idleStream = useMemo<WorkspaceRunStreamState>(() => ({
    ...createPreviewStream(),
    runId: '',
    status: 'idle',
    isVisible: false,
    stages: [],
    outputText: '',
    overallProgress: 0,
    activeMessage: '',
  }), [])

  return (
    <div className="glass-page min-h-screen px-4 py-6">
      <div className="mx-auto mb-5 flex w-full max-w-[1800px] items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-[var(--glass-text-primary)]">WR-0 + WR-1 界面基线</h1>
          <p className="mt-1 text-sm text-[var(--glass-text-tertiary)]">六阶段工作台开发预览</p>
        </div>
        <span className="glass-chip glass-chip-info">
          <AppIcon name="monitor" className="h-3.5 w-3.5" />
          Preview
        </span>
      </div>
      <div className="mx-auto w-full max-w-[1800px]">
        <CreationWorkspaceShell
          items={items}
          currentStage={currentStage}
          projectId="preview"
          episodeId="preview-episode"
          videoProfile={resolveVideoProfile({ preset: VIDEO_PROFILE_PRESET.BOOK_GUIDE })}
          onStageChange={(stage) => {
            if (CREATION_STAGE_REGISTRY.some((item) => item.id === stage)) {
              setCurrentStage(stage as CreationStageId)
            }
          }}
          contentPlanStream={completedStream}
          storyToScriptStream={idleStream}
          visualPlanStream={completedStream}
          scriptToStoryboardStream={idleStream}
        >
          <PreviewStageBody stageId={currentStage} />
        </CreationWorkspaceShell>
      </div>
    </div>
  )
}
