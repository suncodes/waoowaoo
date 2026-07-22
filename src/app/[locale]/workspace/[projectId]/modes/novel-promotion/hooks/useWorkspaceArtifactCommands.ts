'use client'

import { useCallback } from 'react'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import type {
  WorkspaceArtifactCommand,
  WorkspaceArtifactCommandResult,
} from '@/lib/creation-workspace/commands'

interface UseWorkspaceArtifactCommandsParams {
  projectId: string
  episodeId?: string
  onRefresh: (options?: { scope?: string; mode?: string }) => Promise<void>
}

export function useWorkspaceArtifactCommands({
  projectId,
  episodeId,
  onRefresh,
}: UseWorkspaceArtifactCommandsParams) {
  const execute = useCallback(async (command: WorkspaceArtifactCommand) => {
    if (!episodeId) throw new Error('Episode is required')
    const response = await apiFetch(`/api/novel-promotion/${projectId}/episodes/${episodeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceCommand: command }),
    })
    if (!response.ok) {
      throw new Error(await readApiErrorMessage(response, 'Workspace command failed'))
    }
    const result = await response.json() as WorkspaceArtifactCommandResult
    await onRefresh()
    return result
  }, [episodeId, onRefresh, projectId])

  return {
    execute,
    saveGuidePlan: (command: Extract<WorkspaceArtifactCommand, { type: 'save_guide_plan' }>) => execute(command),
    saveVisualPlan: (command: Extract<WorkspaceArtifactCommand, { type: 'save_visual_plan' }>) => execute(command),
    toggleContentLock: (unitId: string, locked: boolean) => execute({
      type: 'toggle_content_lock',
      unitId,
      locked,
    }),
    approveStage: (stageId: 'content' | 'visual-design') => execute({
      type: 'approve_stage',
      stageId,
    }),
    approveAssetRequirements: () => execute({
      type: 'approve_asset_requirements',
    }),
    acceptContentCandidate: (unitId: string) => execute({
      type: 'accept_content_candidate',
      unitId,
    }),
    discardContentCandidate: (unitId: string) => execute({
      type: 'discard_content_candidate',
      unitId,
    }),
    restoreContentUnit: (unitId: string) => execute({
      type: 'restore_content_unit',
      unitId,
    }),
    materializeGuideStoryboard: () => execute({ type: 'materialize_guide_storyboard' }),
  }
}
