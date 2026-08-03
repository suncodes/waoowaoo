import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  scriptToStoryboardRunMock,
  useCallbackMock,
  useEffectMock,
  useMemoMock,
  useRefMock,
  useStateMock,
} = vi.hoisted(() => ({
  scriptToStoryboardRunMock: vi.fn(),
  useCallbackMock: vi.fn((callback: unknown) => callback),
  useEffectMock: vi.fn(),
  useMemoMock: vi.fn((factory: () => unknown) => factory()),
  useRefMock: vi.fn((value: unknown) => ({ current: value })),
  useStateMock: vi.fn((value: unknown) => [value, vi.fn()]),
}))

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    useCallback: useCallbackMock,
    useEffect: useEffectMock,
    useMemo: useMemoMock,
    useRef: useRefMock,
    useState: useStateMock,
  }
})

vi.mock('@/lib/query/hooks', () => ({
  useAnalyzeProjectAssets: () => ({ mutateAsync: vi.fn() }),
  useScriptToStoryboardRunStream: () => ({
    isRecoveredRunning: false,
    isRunning: false,
    run: scriptToStoryboardRunMock,
    runId: '',
    status: 'idle',
  }),
  useStoryToScriptRunStream: () => ({
    isRecoveredRunning: false,
    isRunning: false,
    runId: '',
    status: 'idle',
  }),
}))

vi.mock('@/app/[locale]/workspace/[projectId]/modes/novel-promotion/hooks/useWorkspacePlanningFlows', () => ({
  useWorkspacePlanningFlows: () => ({
    contentPlanStream: { isRecoveredRunning: false, isRunning: false, runId: '', status: 'idle' },
    isPlanning: false,
    runContentPlan: vi.fn(),
    runContentUnitRewrite: vi.fn(),
    runVisualPlan: vi.fn(),
    visualPlanStream: { isRecoveredRunning: false, isRunning: false, runId: '', status: 'idle' },
  }),
}))

import { useWorkspaceExecution } from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/hooks/useWorkspaceExecution'

function createWorkspaceExecutionParams(onStageChange: ReturnType<typeof vi.fn>, onRefresh: ReturnType<typeof vi.fn>) {
  return {
    analysisModel: 'analysis-model',
    contentPlan: {},
    currentStage: 'storyboard',
    episodeId: 'episode-1',
    novelText: '故事正文',
    onOpenAssetLibrary: vi.fn(),
    onRefresh,
    onStageChange,
    onUpdateConfig: vi.fn(async () => undefined),
    productionBible: {
      _workspace: { status: 'approved' },
    },
    projectId: 'project-1',
    t: (key: string) => key,
    videoProfile: { preset: 'ai_comic' },
    workspaceV2Enabled: true,
  }
}

describe('useWorkspaceExecution storyboard completion', () => {
  beforeEach(() => {
    scriptToStoryboardRunMock.mockReset()
    useCallbackMock.mockClear()
    useEffectMock.mockClear()
    useMemoMock.mockClear()
    useRefMock.mockClear()
    useStateMock.mockClear()
  })

  it('刷新完成后按请求切换到台词阶段', async () => {
    scriptToStoryboardRunMock.mockResolvedValue({ runId: 'run-voice', status: 'completed' })
    const onRefresh = vi.fn(async () => undefined)
    const onStageChange = vi.fn()
    const execution = useWorkspaceExecution(createWorkspaceExecutionParams(onStageChange, onRefresh))

    await execution.runScriptToStoryboardFlow({
      visualApprovalConfirmed: true,
      completionStage: 'voice',
    })

    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(onStageChange).toHaveBeenCalledWith('voice')
  })

  it('未指定目标阶段时保持分镜阶段', async () => {
    scriptToStoryboardRunMock.mockResolvedValue({ runId: 'run-storyboard', status: 'completed' })
    const onRefresh = vi.fn(async () => undefined)
    const onStageChange = vi.fn()
    const execution = useWorkspaceExecution(createWorkspaceExecutionParams(onStageChange, onRefresh))

    await execution.runScriptToStoryboardFlow({ visualApprovalConfirmed: true })

    expect(onStageChange).toHaveBeenCalledWith('storyboard')
  })
})
