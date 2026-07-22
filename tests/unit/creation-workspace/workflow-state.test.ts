import { describe, expect, it } from 'vitest'
import { buildCreationWorkflowState } from '@/lib/creation-workspace/workflow-state'
import { resolveVideoProfile, VIDEO_PROFILE_PRESET } from '@/lib/video-profile'

const idleStream = {
  runId: '',
  status: 'idle',
  isRunning: false,
  isRecoveredRunning: false,
}

const emptyArtifacts = {
  hasStory: true,
  hasContentPlan: false,
  hasScript: false,
  hasVisualPlan: false,
  hasStoryboard: false,
  hasVideo: false,
  hasVoice: false,
}

function approvedContentPlan() {
  return {
    _workspace: {
      schemaVersion: 1,
      status: 'approved',
      revision: 2,
      approvedRevision: 2,
      updatedAt: '2026-07-20T00:00:00.000Z',
      updatedBy: 'user',
      units: {},
      assetRequirements: {
        status: 'approved',
        analyzedRevision: 2,
        analyzedAt: '2026-07-20T00:01:00.000Z',
        approvedAt: '2026-07-20T00:02:00.000Z',
        assetIds: [],
      },
      latestImpact: null,
      downstream: { visualDesign: false, storyboard: false, production: false },
    },
  }
}

function reviewContentPlan() {
  return {
    _workspace: {
      ...approvedContentPlan()._workspace,
      status: 'needs_review',
      approvedRevision: null,
      assetRequirements: {
        status: 'not_started',
        analyzedRevision: null,
        analyzedAt: null,
        approvedAt: null,
        assetIds: [],
      },
    },
  }
}

function approvedProductionBible() {
  return {
    _workspace: {
      schemaVersion: 1,
      status: 'approved',
      revision: 1,
      approvedRevision: 1,
      updatedAt: '2026-07-20T00:00:00.000Z',
      updatedBy: 'user',
      anchors: [],
      plan: { shotPlan: {}, visualUnits: [] },
      latestImpact: null,
      downstream: { storyboard: false, production: false },
    },
  }
}

function createState(overrides: Partial<Parameters<typeof buildCreationWorkflowState>[0]> = {}) {
  return buildCreationWorkflowState({
    stageArtifacts: emptyArtifacts,
    videoProfile: resolveVideoProfile({ preset: VIDEO_PROFILE_PRESET.AI_COMIC }),
    contentPlanStream: idleStream,
    storyToScriptStream: idleStream,
    visualPlanStream: idleStream,
    scriptToStoryboardStream: idleStream,
    ...overrides,
  })
}

describe('creation workflow state', () => {
  it('keeps downstream stages locked while content planning is running', () => {
    const state = createState({
      contentPlanStream: {
        ...idleStream,
        runId: 'plan-1',
        status: 'running',
        isRunning: true,
        overallProgress: 35,
        activeMessage: '正在整理章节结构',
      },
    })

    expect(state.stages.content.status).toBe('running')
    expect(state.contentSteps.plan.status).toBe('running')
    expect(state.contentSteps.script).toMatchObject({ status: 'not_started', locked: true, blockedById: 'plan' })
    expect(state.stages['visual-design']).toMatchObject({ status: 'not_started', locked: true, blockedById: 'content' })
    expect(state.stages['storyboard-preview']).toMatchObject({ status: 'not_started', locked: true, blockedById: 'visual-design' })
    expect(state.activeTarget).toMatchObject({
      stageId: 'content',
      view: 'plan',
      route: 'content-plan',
      progress: 35,
    })
  })

  it('routes visual-plan generation to the storyboard stage', () => {
    const state = createState({
      visualPlanStream: {
        ...idleStream,
        runId: 'visual-plan-1',
        status: 'running',
        isRunning: true,
        overallProgress: 42,
        activeMessage: '正在生成镜头规划初稿',
      },
    })

    expect(state.stages['storyboard-preview'].status).toBe('running')
    expect(state.stages['visual-design'].status).not.toBe('running')
    expect(state.activeTarget).toMatchObject({
      stageId: 'storyboard-preview',
      route: 'storyboard',
      kind: 'visual_plan',
      progress: 42,
    })
  })

  it('does not unlock visual preparation for an unconfirmed legacy script', () => {
    const state = createState({
      stageArtifacts: {
        ...emptyArtifacts,
        hasContentPlan: true,
        hasScript: true,
      },
      contentPlan: reviewContentPlan(),
    })

    expect(state.stages.content.status).toBe('attention')
    expect(state.contentSteps.script.status).toBe('attention')
    expect(state.contentSteps.assets).toMatchObject({ status: 'not_started', locked: true, blockedById: 'script' })
    expect(state.stages['visual-design']).toMatchObject({ locked: true, blockedById: 'content' })
  })

  it('unlocks visual preparation only after all content steps are confirmed', () => {
    const state = createState({
      stageArtifacts: {
        ...emptyArtifacts,
        hasContentPlan: true,
        hasScript: true,
      },
      contentPlan: approvedContentPlan(),
    })

    expect(state.stages.content.status).toBe('completed')
    expect(state.stages['visual-design']).toMatchObject({ status: 'ready', locked: false })
    expect(state.stages['storyboard-preview']).toMatchObject({
      status: 'not_started',
      locked: true,
      blockedById: 'visual-design',
    })
  })

  it('unlocks storyboard preview after visual preparation is confirmed', () => {
    const state = createState({
      stageArtifacts: {
        ...emptyArtifacts,
        hasContentPlan: true,
        hasScript: true,
        hasVisualPlan: true,
      },
      contentPlan: approvedContentPlan(),
      productionBible: approvedProductionBible(),
    })

    expect(state.stages['visual-design'].status).toBe('completed')
    expect(state.stages['storyboard-preview']).toMatchObject({ status: 'ready', locked: false })
  })

  it('marks existing downstream results stale and locked during an upstream rebuild', () => {
    const state = createState({
      stageArtifacts: {
        ...emptyArtifacts,
        hasContentPlan: true,
        hasScript: true,
        hasVisualPlan: true,
        hasStoryboard: true,
        hasVideo: true,
      },
      contentPlan: approvedContentPlan(),
      productionBible: approvedProductionBible(),
      contentPlanStream: {
        ...idleStream,
        runId: 'plan-rebuild',
        status: 'running',
        isRecoveredRunning: true,
      },
    })

    expect(state.stages.content.status).toBe('running')
    expect(state.stages['visual-design']).toMatchObject({ status: 'stale', locked: true, blockedById: 'content' })
    expect(state.stages['storyboard-preview']).toMatchObject({ status: 'stale', locked: true, blockedById: 'visual-design' })
    expect(state.stages.production).toMatchObject({ status: 'stale', locked: true, blockedById: 'storyboard-preview' })
  })

  it('treats a generated book-guide plan as narration awaiting confirmation', () => {
    const state = createState({
      stageArtifacts: {
        ...emptyArtifacts,
        hasContentPlan: true,
      },
      videoProfile: resolveVideoProfile({ preset: VIDEO_PROFILE_PRESET.BOOK_GUIDE }),
      contentPlanStream: { ...idleStream, status: 'completed' },
    })

    expect(state.contentSteps.plan.status).toBe('completed')
    expect(state.contentSteps.script).toMatchObject({ status: 'attention', locked: false })
    expect(state.contentSteps.assets).toMatchObject({ status: 'not_started', locked: true, blockedById: 'script' })
    expect(state.stages.content.status).toBe('attention')
  })

  it('ignores narrative-only active streams for book guides', () => {
    const state = createState({
      videoProfile: resolveVideoProfile({ preset: VIDEO_PROFILE_PRESET.BOOK_GUIDE }),
      storyToScriptStream: {
        ...idleStream,
        runId: 'legacy-script',
        status: 'running',
        isRecoveredRunning: true,
      },
      scriptToStoryboardStream: {
        ...idleStream,
        runId: 'legacy-storyboard',
        status: 'running',
        isRecoveredRunning: true,
      },
    })

    expect(state.stages.content.status).toBe('ready')
    expect(state.stages['storyboard-preview'].status).toBe('not_started')
    expect(state.activeTarget).toBeNull()
  })
})
