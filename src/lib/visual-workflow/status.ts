import { parseVisualQualityState } from '@/lib/quality-workflow'

export type VisualWorkflowPhase =
  | 'idle'
  | 'drafting'
  | 'submitting'
  | 'generating'
  | 'modifying'
  | 'waiting_review'
  | 'reviewing'
  | 'waiting_repair'
  | 'repairing'
  | 'waiting_recheck'
  | 'human_required'
  | 'approved'
  | 'failed'

export type VisualWorkflowStatus =
  | 'empty'
  | 'drafting'
  | 'generating'
  | 'needs_review'
  | 'locked'
  | 'failed'

export type VisualWorkflowTaskPhase = 'idle' | 'queued' | 'processing' | 'completed' | 'failed' | null | undefined

export type VisualWorkflowTaskState = {
  phase?: VisualWorkflowTaskPhase
  taskType?: string | null
  runningTaskType?: string | null
  intent?: string | null
  progress?: number | null
  attempt?: number | null
  maxAttempts?: number | null
  updatedAt?: string | null
  lastError?: {
    code: string
    message: string
  } | null
} | null | undefined

export type VisualWorkflowPresentation = {
  phase: VisualWorkflowPhase
  status: VisualWorkflowStatus
  label: string
  blocksConfirmation: boolean
  progress: number | null
  activeTaskType: string | null
}

export type ResolveVisualWorkflowInput = {
  taskStates?: VisualWorkflowTaskState[]
  visualQualityState?: unknown
  isSubmitting?: boolean
  isModifying?: boolean
  hasCandidates?: boolean
  candidateCount?: number
  hasPrimaryImage?: boolean
  hasDraft?: boolean
  hasError?: boolean
  emptyLabel?: string
  draftLabel?: string
  confirmedLabel?: string
  candidateLabel?: string
  recentHandoffMs?: number
  now?: number
}

const DEFAULT_RECENT_HANDOFF_MS = 30_000

const IMAGE_GENERATION_TASK_TYPES = new Set([
  'image_panel',
  'panel_variant',
  'image_character',
  'image_location',
  'asset_hub_image',
  'regenerate_group',
])

const IMAGE_MODIFY_TASK_TYPES = new Set([
  'modify_asset_image',
  'asset_hub_modify',
])

const VISUAL_QUALITY_TASK_TYPES = new Set([
  'visual_quality_review',
  'visual_auto_repair',
])

function taskTypeOf(state: VisualWorkflowTaskState): string {
  return state?.runningTaskType || state?.taskType || ''
}

function isActiveTask(state: VisualWorkflowTaskState) {
  return state?.phase === 'queued' || state?.phase === 'processing'
}

function taskRank(state: VisualWorkflowTaskState): number {
  if (state?.phase === 'processing') return 5
  if (state?.phase === 'queued') return 4
  if (state?.phase === 'failed') return 3
  if (state?.phase === 'completed') return 2
  return 1
}

function isNewerTaskState(current: VisualWorkflowTaskState, candidate: VisualWorkflowTaskState) {
  const currentTs = current?.updatedAt ? Date.parse(current.updatedAt) : 0
  const candidateTs = candidate?.updatedAt ? Date.parse(candidate.updatedAt) : 0
  return candidateTs > currentTs
}

function selectTaskState(states: VisualWorkflowTaskState[]) {
  return states.reduce<VisualWorkflowTaskState | null>((selected, state) => {
    if (!state) return selected
    if (!selected) return state
    const selectedRank = taskRank(selected)
    const stateRank = taskRank(state)
    if (stateRank !== selectedRank) return stateRank > selectedRank ? state : selected
    return isNewerTaskState(selected, state) ? state : selected
  }, null)
}

function selectActiveTaskState(states: VisualWorkflowTaskState[]) {
  return selectTaskState(states.filter(isActiveTask))
}

function isRecentCompletedTask(
  state: VisualWorkflowTaskState,
  taskTypes: ReadonlySet<string>,
  now: number,
  recentHandoffMs: number,
) {
  if (state?.phase !== 'completed') return false
  const taskType = taskTypeOf(state)
  if (!taskTypes.has(taskType)) return false
  if (!state.updatedAt) return false
  const updatedAt = Date.parse(state.updatedAt)
  return Number.isFinite(updatedAt) && now - updatedAt <= recentHandoffMs
}

function repairRoundLabel(attempt?: number | null, maxAttempts?: number | null) {
  if (!attempt || attempt <= 0) return ''
  if (maxAttempts && maxAttempts > 0) return `（${attempt}/${maxAttempts}）`
  return `（第 ${attempt} 轮）`
}

function statusFromPhase(phase: VisualWorkflowPhase): VisualWorkflowStatus {
  if (phase === 'idle') return 'empty'
  if (phase === 'drafting') return 'drafting'
  if (phase === 'failed') return 'failed'
  if (phase === 'human_required') return 'needs_review'
  if (phase === 'approved') return 'locked'
  return 'generating'
}

function blocksConfirmation(phase: VisualWorkflowPhase) {
  return phase === 'submitting'
    || phase === 'generating'
    || phase === 'modifying'
    || phase === 'waiting_review'
    || phase === 'reviewing'
    || phase === 'waiting_repair'
    || phase === 'repairing'
    || phase === 'waiting_recheck'
}

function labelFromPhase(params: {
  phase: VisualWorkflowPhase
  attempt?: number | null
  maxAttempts?: number | null
  emptyLabel: string
  draftLabel: string
  confirmedLabel: string
  candidateLabel: string
}) {
  const { phase, attempt, maxAttempts } = params
  if (phase === 'idle') return params.emptyLabel
  if (phase === 'drafting') return params.draftLabel
  if (phase === 'submitting') return '提交中'
  if (phase === 'generating') return '生成中'
  if (phase === 'modifying') return '改图中'
  if (phase === 'waiting_review') return '等待检查'
  if (phase === 'reviewing') {
    return attempt && attempt > 0
      ? `复查中${repairRoundLabel(attempt, maxAttempts)}`
      : '检查中'
  }
  if (phase === 'waiting_repair') return `等待修复${repairRoundLabel(attempt, maxAttempts)}`
  if (phase === 'repairing') return `修复中${repairRoundLabel(attempt, maxAttempts)}`
  if (phase === 'waiting_recheck') return `等待复查${repairRoundLabel(attempt, maxAttempts)}`
  if (phase === 'human_required') return params.candidateLabel
  if (phase === 'approved') return params.confirmedLabel
  return '失败'
}

function buildPresentation(params: {
  phase: VisualWorkflowPhase
  label?: string
  progress?: number | null
  activeTaskType?: string | null
  attempt?: number | null
  maxAttempts?: number | null
  emptyLabel: string
  draftLabel: string
  confirmedLabel: string
  candidateLabel: string
}): VisualWorkflowPresentation {
  return {
    phase: params.phase,
    status: statusFromPhase(params.phase),
    label: params.label || labelFromPhase(params),
    blocksConfirmation: blocksConfirmation(params.phase),
    progress: params.progress ?? null,
    activeTaskType: params.activeTaskType ?? null,
  }
}

function presentationFromActiveTask(
  state: NonNullable<VisualWorkflowTaskState>,
  labels: Pick<ResolveVisualWorkflowInput, 'emptyLabel' | 'draftLabel' | 'confirmedLabel' | 'candidateLabel'>,
) {
  const taskType = taskTypeOf(state)
  const attempt = state.attempt ?? 0
  const maxAttempts = state.maxAttempts ?? null
  const base = {
    progress: state.progress ?? null,
    activeTaskType: taskType || null,
    attempt,
    maxAttempts,
    emptyLabel: labels.emptyLabel || '未开始',
    draftLabel: labels.draftLabel || '可编辑',
    confirmedLabel: labels.confirmedLabel || '已确认',
    candidateLabel: labels.candidateLabel || '待确认',
  }

  if (taskType === 'visual_quality_review') {
    return buildPresentation({
      ...base,
      phase: state.phase === 'queued'
        ? attempt > 0 ? 'waiting_recheck' : 'waiting_review'
        : 'reviewing',
    })
  }
  if (taskType === 'visual_auto_repair') {
    return buildPresentation({
      ...base,
      phase: state.phase === 'queued' ? 'waiting_repair' : 'repairing',
    })
  }
  if (IMAGE_MODIFY_TASK_TYPES.has(taskType)) {
    return buildPresentation({ ...base, phase: 'modifying' })
  }
  if (IMAGE_GENERATION_TASK_TYPES.has(taskType)) {
    return buildPresentation({ ...base, phase: 'generating' })
  }
  return buildPresentation({
    ...base,
    phase: 'generating',
    label: state.phase === 'queued' ? '等待处理' : '处理中',
  })
}

export function resolveVisualWorkflowPresentation(input: ResolveVisualWorkflowInput): VisualWorkflowPresentation {
  const emptyLabel = input.emptyLabel || '未开始'
  const draftLabel = input.draftLabel || '可编辑'
  const confirmedLabel = input.confirmedLabel || '已确认'
  const candidateLabel = input.candidateLabel || '待确认'
  const labels = { emptyLabel, draftLabel, confirmedLabel, candidateLabel }

  if (input.isSubmitting) {
    return buildPresentation({ ...labels, phase: 'submitting' })
  }
  if (input.isModifying) {
    return buildPresentation({ ...labels, phase: 'modifying' })
  }

  const qualityState = parseVisualQualityState(input.visualQualityState)
  const candidateCount = input.candidateCount ?? (input.hasCandidates ? 1 : 0)
  const humanConfirmed = !!qualityState?.humanConfirmedAt
  const autoApproved = qualityState?.status === 'approved'
  const confirmed = humanConfirmed || (autoApproved && candidateCount <= 1)
  const terminalQualityState = humanConfirmed || autoApproved
  const taskStates = (input.taskStates || []).filter(Boolean)
  const activeTask = selectActiveTaskState(taskStates)
  if (activeTask) {
    const activeTaskType = taskTypeOf(activeTask)
    if (!terminalQualityState || !VISUAL_QUALITY_TASK_TYPES.has(activeTaskType)) {
      return presentationFromActiveTask(activeTask, labels)
    }
  }

  const selectedTask = selectTaskState(taskStates)
  if (confirmed) {
    return buildPresentation({ ...labels, phase: 'approved', progress: selectedTask?.progress ?? null })
  }

  if (input.hasError || selectedTask?.lastError || selectedTask?.phase === 'failed') {
    return buildPresentation({ ...labels, phase: 'failed', progress: selectedTask?.progress ?? null })
  }

  if (qualityState?.mode === 'auto') {
    if (qualityState.status === 'pending') {
      return buildPresentation({ ...labels, phase: 'waiting_review' })
    }
    if (qualityState.status === 'reviewing') {
      return buildPresentation({
        ...labels,
        phase: 'reviewing',
        attempt: qualityState.attempt,
        maxAttempts: qualityState.maxAttempts,
      })
    }
    if (qualityState.status === 'repairing') {
      const nextAttempt = Math.min(qualityState.maxAttempts, qualityState.attempt + 1)
      return buildPresentation({
        ...labels,
        phase: 'repairing',
        attempt: nextAttempt,
        maxAttempts: qualityState.maxAttempts,
      })
    }
    if (qualityState.status === 'failed' && !input.hasCandidates && !input.hasPrimaryImage) {
      return buildPresentation({ ...labels, phase: 'failed' })
    }
    if (qualityState.status === 'human_required' || qualityState.status === 'failed') {
      return buildPresentation({ ...labels, phase: 'human_required' })
    }
  }

  const now = input.now ?? Date.now()
  const recentHandoffMs = input.recentHandoffMs ?? DEFAULT_RECENT_HANDOFF_MS
  if (!terminalQualityState && isRecentCompletedTask(selectedTask, IMAGE_GENERATION_TASK_TYPES, now, recentHandoffMs)) {
    return buildPresentation({ ...labels, phase: 'waiting_review', progress: selectedTask?.progress ?? null })
  }
  if (!terminalQualityState && isRecentCompletedTask(selectedTask, new Set(['visual_auto_repair']), now, recentHandoffMs)) {
    const attempt = selectedTask?.attempt ?? qualityState?.attempt ?? null
    const maxAttempts = selectedTask?.maxAttempts ?? qualityState?.maxAttempts ?? null
    return buildPresentation({
      ...labels,
      phase: 'waiting_recheck',
      progress: selectedTask?.progress ?? null,
      attempt,
      maxAttempts,
    })
  }

  if (candidateCount > 0 && !confirmed && (!input.hasPrimaryImage || !!qualityState)) {
    return buildPresentation({ ...labels, phase: 'human_required', progress: selectedTask?.progress ?? null })
  }
  if (confirmed || input.hasPrimaryImage) {
    return buildPresentation({ ...labels, phase: 'approved', progress: selectedTask?.progress ?? null })
  }
  if (input.hasDraft) {
    return buildPresentation({ ...labels, phase: 'drafting', progress: selectedTask?.progress ?? null })
  }
  return buildPresentation({ ...labels, phase: 'idle', progress: selectedTask?.progress ?? null })
}
