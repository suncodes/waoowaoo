'use client'

import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-fetch'
import { resolveTaskResponse } from '@/lib/task/client'
import { queryKeys } from '@/lib/query/keys'
import { useTaskTargetStateMap, type TaskTargetState } from '@/lib/query/hooks/useTaskTargetStateMap'
import {
  clearTaskTargetOverlay,
  upsertTaskTargetOverlay,
} from '@/lib/query/task-target-overlay'
import type {
  AssetKind,
  AssetQueryInput,
  AssetRenderSummary,
  AssetSummary,
  AssetTaskRef,
  AssetTaskState,
  AssetVariantSummary,
  CharacterAssetSummary,
  LocationAssetSummary,
  PropAssetSummary,
  ReadAssetsResponse,
  VoiceAssetSummary,
} from '@/lib/assets/contracts'
import { createIdleTaskState } from '@/lib/assets/contracts'

function flattenTaskRefs(assets: AssetSummary[]): AssetTaskRef[] {
  const refs: AssetTaskRef[] = []
  for (const asset of assets) {
    refs.push(...asset.taskRefs)
    if (asset.kind === 'voice') {
      continue
    }
    if (asset.kind === 'character') {
      refs.push(...asset.profileTaskRefs)
    }
    for (const variant of asset.variants) {
      refs.push(...variant.taskRefs)
      for (const render of variant.renders) {
        refs.push(...render.taskRefs)
      }
    }
  }
  return refs
}

function taskStateRank(state: TaskTargetState): number {
  if (state.phase === 'processing') return 5
  if (state.phase === 'queued') return 4
  if (state.phase === 'failed') return 3
  if (state.phase === 'completed') return 2
  return 1
}

function isNewerState(current: TaskTargetState, candidate: TaskTargetState) {
  const currentTs = current.updatedAt ? Date.parse(current.updatedAt) : 0
  const candidateTs = candidate.updatedAt ? Date.parse(candidate.updatedAt) : 0
  return candidateTs > currentTs
}

function shouldUseTaskState(current: TaskTargetState | null, candidate: TaskTargetState) {
  if (!current) return true
  const currentRank = taskStateRank(current)
  const candidateRank = taskStateRank(candidate)
  if (candidateRank !== currentRank) return candidateRank > currentRank
  return isNewerState(current, candidate)
}

function resolveTaskState(refs: AssetTaskRef[], byKey: Map<string, TaskTargetState>): AssetTaskState {
  let selected: TaskTargetState | null = null
  let lastError: { code: string; message: string } | null = null
  for (const ref of refs) {
    const state = byKey.get(`${ref.targetType}:${ref.targetId}`)
    if (!state) continue
    if (!lastError && state.lastError) {
      lastError = state.lastError
    }
    if (shouldUseTaskState(selected, state)) {
      selected = state
    }
  }
  if (!selected) return createIdleTaskState()
  return {
    isRunning: selected.phase === 'queued' || selected.phase === 'processing',
    phase: selected.phase,
    taskType: selected.runningTaskType,
    progress: selected.progress,
    stage: selected.stage,
    stageLabel: selected.stageLabel,
    attempt: selected.attempt,
    maxAttempts: selected.maxAttempts,
    updatedAt: selected.updatedAt,
    lastError,
  }
}

function withTaskState(render: AssetRenderSummary, byKey: Map<string, TaskTargetState>): AssetRenderSummary {
  return {
    ...render,
    taskState: resolveTaskState(render.taskRefs, byKey),
  }
}

function withTaskStateVariant(variant: AssetVariantSummary, byKey: Map<string, TaskTargetState>): AssetVariantSummary {
  return {
    ...variant,
    renders: variant.renders.map((render) => withTaskState(render, byKey)),
    taskState: resolveTaskState(variant.taskRefs, byKey),
  }
}

function withTaskStateAsset(asset: AssetSummary, byKey: Map<string, TaskTargetState>): AssetSummary {
  if (asset.kind === 'voice') {
    const voiceAsset: VoiceAssetSummary = {
      ...asset,
      taskState: resolveTaskState(asset.taskRefs, byKey),
    }
    return voiceAsset
  }

  const variants = asset.variants.map((variant) => withTaskStateVariant(variant, byKey))
  if (asset.kind === 'character') {
    const characterAsset: CharacterAssetSummary = {
      ...asset,
      variants,
      taskState: resolveTaskState(asset.taskRefs, byKey),
      profileTaskState: resolveTaskState(asset.profileTaskRefs, byKey),
    }
    return characterAsset
  }

  if (asset.kind === 'location') {
    const locationAsset: LocationAssetSummary = {
      ...asset,
      variants,
      taskState: resolveTaskState(asset.taskRefs, byKey),
    }
    return locationAsset
  }

  const propAsset: PropAssetSummary = {
    ...asset,
    variants,
    taskState: resolveTaskState(asset.taskRefs, byKey),
  }
  return propAsset
}

function buildQueryPath(input: AssetQueryInput): string {
  const searchParams = new URLSearchParams({
    scope: input.scope,
  })
  if (input.projectId) {
    searchParams.set('projectId', input.projectId)
  }
  if (input.folderId) {
    searchParams.set('folderId', input.folderId)
  }
  if (input.kind) {
    searchParams.set('kind', input.kind)
  }
  return `/api/assets?${searchParams.toString()}`
}

export function useAssets(input: AssetQueryInput) {
  const assetsQuery = useQuery({
    queryKey: queryKeys.assets.list(input),
    queryFn: async () => {
      const response = await apiFetch(buildQueryPath(input))
      if (!response.ok) {
        throw new Error('Failed to fetch assets')
      }
      const data = await response.json() as ReadAssetsResponse
      return data.assets
    },
    enabled: input.scope === 'global' || !!input.projectId,
    staleTime: 5_000,
  })

  const taskProjectId = input.scope === 'global' ? 'global-asset-hub' : input.projectId ?? ''
  const taskRefs = useMemo(() => flattenTaskRefs(assetsQuery.data ?? []), [assetsQuery.data])
  const taskTargets = useMemo(() => taskRefs.map((ref) => ({
    targetType: ref.targetType,
    targetId: ref.targetId,
    types: ref.types,
  })), [taskRefs])
  const taskStatesQuery = useTaskTargetStateMap(taskProjectId, taskTargets, {
    enabled: taskProjectId.length > 0 && taskTargets.length > 0,
  })

  const data = useMemo(() => {
    const assets = assetsQuery.data ?? []
    return assets.map((asset) => withTaskStateAsset(asset, taskStatesQuery.byKey))
  }, [assetsQuery.data, taskStatesQuery.byKey])

  return {
    ...assetsQuery,
    data,
    isFetching: assetsQuery.isFetching || taskStatesQuery.isFetching,
  }
}

type AssetActionScopeInput = {
  scope: 'global' | 'project'
  projectId?: string | null
  kind: AssetKind
}

type GenerateOverlayTarget = {
  projectId: string
  targetType: string
  targetId: string
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeAppearanceTargetId(value: unknown): string | null {
  const normalized = normalizeOptionalString(value)
  if (!normalized) return null
  const lower = normalized.toLowerCase()
  if (lower === 'nan' || lower === 'null' || lower === 'undefined') return null
  return normalized
}

function resolveGenerateOverlayTarget(
  input: AssetActionScopeInput,
  payload: Record<string, unknown>,
): GenerateOverlayTarget | null {
  const assetId = normalizeOptionalString(payload.id)
    ?? normalizeOptionalString(payload.characterId)
    ?? normalizeOptionalString(payload.locationId)
  if (!assetId) {
    return null
  }

  if (input.scope === 'global') {
    return {
      projectId: 'global-asset-hub',
      targetType: input.kind === 'character' ? 'GlobalCharacter' : 'GlobalLocation',
      targetId: assetId,
    }
  }

  const projectId = normalizeOptionalString(input.projectId)
  if (!projectId) {
    return null
  }

  if (input.kind === 'character') {
    const appearanceId = normalizeAppearanceTargetId(payload.appearanceId)
    if (!appearanceId) {
      return null
    }
    return {
      projectId,
      targetType: 'CharacterAppearance',
      targetId: appearanceId,
    }
  }

  return {
    projectId,
    targetType: 'LocationImage',
    targetId: assetId,
  }
}

function invalidateScopeQueries(queryClient: ReturnType<typeof useQueryClient>, input: AssetActionScopeInput) {
  queryClient.invalidateQueries({
    queryKey: queryKeys.assets.all(input.scope, input.projectId),
  })
  if (input.scope === 'global') {
    queryClient.invalidateQueries({ queryKey: queryKeys.globalAssets.all() })
  } else if (input.projectId) {
    queryClient.invalidateQueries({ queryKey: queryKeys.projectAssets.all(input.projectId) })
    queryClient.invalidateQueries({ queryKey: queryKeys.projectData(input.projectId) })
    queryClient.invalidateQueries({ queryKey: ['episode-data', input.projectId] })
  }
}

export function useRefreshAssets(input: { scope: 'global' | 'project'; projectId?: string | null }) {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({
      queryKey: queryKeys.assets.all(input.scope, input.projectId),
    })
    if (input.scope === 'global') {
      queryClient.invalidateQueries({ queryKey: queryKeys.globalAssets.all() })
    } else if (input.projectId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.projectAssets.all(input.projectId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.projectData(input.projectId) })
      queryClient.invalidateQueries({ queryKey: ['episode-data', input.projectId] })
    }
  }
}

export function useAssetActions(input: AssetActionScopeInput) {
  const queryClient = useQueryClient()

  const create = async (payload: Record<string, unknown>) => {
    const response = await apiFetch('/api/assets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: input.scope,
        kind: input.kind,
        projectId: input.projectId,
        ...payload,
      }),
    })
    if (!response.ok) {
      throw new Error('Failed to create asset')
    }
    invalidateScopeQueries(queryClient, input)
    return response.json()
  }

  const remove = async (assetId: string) => {
    const response = await apiFetch(`/api/assets/${assetId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: input.scope,
        kind: input.kind,
        projectId: input.projectId,
      }),
    })
    if (!response.ok) {
      throw new Error('Failed to delete asset')
    }
    invalidateScopeQueries(queryClient, input)
    return response.json()
  }

  const update = async (assetId: string, payload: Record<string, unknown>) => {
    const response = await apiFetch(`/api/assets/${assetId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: input.scope,
        kind: input.kind,
        projectId: input.projectId,
        ...payload,
      }),
    })
    if (!response.ok) {
      throw new Error('Failed to update asset')
    }
    invalidateScopeQueries(queryClient, input)
    return response.json()
  }

  const generate = async (payload: Record<string, unknown>) => {
    const assetId = String(payload.id)
    const overlayTarget = resolveGenerateOverlayTarget(input, payload)
    if (overlayTarget) {
      upsertTaskTargetOverlay(queryClient, {
        ...overlayTarget,
        intent: 'generate',
        runningTaskType: input.kind === 'character' ? 'image_character' : 'image_location',
        stage: 'asset_image_submit',
        stageLabel: '提交中',
      })
    }

    try {
      const response = await apiFetch(`/api/assets/${assetId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: input.scope,
          kind: input.kind,
          projectId: input.projectId,
          ...payload,
        }),
      })
      if (!response.ok) {
        throw new Error('Failed to generate asset render')
      }
      invalidateScopeQueries(queryClient, input)
      return response.json()
    } catch (error) {
      if (overlayTarget) {
        clearTaskTargetOverlay(queryClient, overlayTarget)
      }
      throw error
    }
  }

  const prepareGenerationPrompt = async (payload: Record<string, unknown>) => {
    const assetId = String(payload.id)
    const response = await apiFetch(`/api/assets/${assetId}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: input.scope,
        kind: input.kind,
        projectId: input.projectId,
        ...payload,
        prepareOnly: true,
      }),
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(typeof body?.message === 'string' ? body.message : 'Failed to prepare asset prompt')
    }
    return await response.json() as {
      success: boolean
      preparedPrompts: Array<{
        artifactId: string
        refId: string
        targetId: string
        preparedAt: string
      }>
    }
  }

  const selectRender = async (payload: Record<string, unknown>) => {
    const response = await apiFetch(`/api/assets/${String(payload.id ?? payload.characterId ?? payload.locationId)}/select-render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: input.scope,
        kind: input.kind,
        projectId: input.projectId,
        ...payload,
      }),
    })
    if (!response.ok) {
      throw new Error('Failed to select asset render')
    }
    invalidateScopeQueries(queryClient, input)
    return response.json()
  }

  const revertRender = async (payload: Record<string, unknown>) => {
    const response = await apiFetch(`/api/assets/${String(payload.id ?? payload.characterId ?? payload.locationId)}/revert-render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: input.scope,
        kind: input.kind,
        projectId: input.projectId,
        ...payload,
      }),
    })
    if (!response.ok) {
      throw new Error('Failed to revert asset render')
    }
    invalidateScopeQueries(queryClient, input)
    return response.json()
  }

  const modifyRender = async (payload: Record<string, unknown>) => {
    const response = await apiFetch(`/api/assets/${String(payload.id ?? payload.characterId ?? payload.locationId)}/modify-render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: input.scope,
        kind: input.kind,
        projectId: input.projectId,
        ...payload,
      }),
    })
    if (!response.ok) {
      throw new Error('Failed to modify asset render')
    }
    const result = await resolveTaskResponse(response)
    invalidateScopeQueries(queryClient, input)
    return result
  }

  const copyFromGlobal = async (payload: { targetId: string; globalAssetId: string }) => {
    if (input.scope !== 'project' || !input.projectId) {
      throw new Error('copyFromGlobal is only available for project asset scope')
    }
    const response = await apiFetch(`/api/assets/${payload.targetId}/copy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: input.kind,
        projectId: input.projectId,
        globalAssetId: payload.globalAssetId,
      }),
    })
    if (!response.ok) {
      throw new Error('Failed to copy asset from global library')
    }
    invalidateScopeQueries(queryClient, input)
    return response.json()
  }

  const bindVoice = async (payload: Record<string, unknown>) => {
    const characterId = String(payload.characterId)
    const response = await apiFetch(`/api/assets/${characterId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: input.scope,
        kind: 'character',
        projectId: input.projectId,
        ...payload,
      }),
    })
    if (!response.ok) {
      throw new Error('Failed to bind voice')
    }
    invalidateScopeQueries(queryClient, input)
    return response.json()
  }

  const updateLabel = async (assetId: string, payload: { newName: string }) => {
    const response = await apiFetch(`/api/assets/${assetId}/update-label`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: input.scope,
        kind: input.kind,
        projectId: input.projectId,
        newName: payload.newName,
      }),
    })
    if (!response.ok) {
      throw new Error('Failed to update asset label')
    }
    invalidateScopeQueries(queryClient, input)
    return response.json()
  }

  const updateVariant = async (assetId: string, variantId: string, payload: Record<string, unknown>) => {
    const response = await apiFetch(`/api/assets/${assetId}/variants/${variantId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: input.scope,
        kind: input.kind,
        projectId: input.projectId,
        ...payload,
      }),
    })
    if (!response.ok) {
      throw new Error('Failed to update asset variant')
    }
    invalidateScopeQueries(queryClient, input)
    return response.json()
  }

  return {
    create,
    update,
    updateVariant,
    remove,
    generate,
    prepareGenerationPrompt,
    selectRender,
    revertRender,
    modifyRender,
    copyFromGlobal,
    bindVoice,
    updateLabel,
  }
}
