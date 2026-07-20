import { describe, expect, it } from 'vitest'
import { resolveCreationWorkspaceAutoFollowTarget } from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/hooks/useCreationWorkspaceAutoFollow'
import type { CreationWorkflowActiveTarget } from '@/lib/creation-workspace/workflow-state'

describe('creation workspace task auto follow', () => {
  it('uses the active target from the shared workflow state', () => {
    const activeTarget: CreationWorkflowActiveTarget = {
      key: 'content-plan:plan-1',
      stageId: 'content',
      view: 'plan',
      route: 'content-plan',
      kind: 'content_plan',
      progress: 42,
      message: '正在整理内容结构',
    }

    expect(resolveCreationWorkspaceAutoFollowTarget({ activeTarget })).toBe(activeTarget)
  })

  it('does not navigate when the shared workflow has no active task', () => {
    expect(resolveCreationWorkspaceAutoFollowTarget({ activeTarget: null })).toBeNull()
  })
})
