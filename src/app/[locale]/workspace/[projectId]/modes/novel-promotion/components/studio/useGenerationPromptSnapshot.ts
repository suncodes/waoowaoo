'use client'

import { useEffect, useState } from 'react'
import type { GenerationPromptSnapshotDisplay } from './GenerationPromptSnapshotModal'

function normalizeSnapshot(value: unknown): GenerationPromptSnapshotDisplay | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const compiledPrompt = typeof record.compiledPrompt === 'string' ? record.compiledPrompt.trim() : ''
  if (!compiledPrompt) return null
  return {
    artifactId: typeof record.artifactId === 'string' ? record.artifactId : '',
    artifactType: typeof record.artifactType === 'string' ? record.artifactType : '',
    modelKey: typeof record.modelKey === 'string' ? record.modelKey : '',
    promptTemplateId: typeof record.promptTemplateId === 'string' ? record.promptTemplateId : '',
    promptHash: typeof record.promptHash === 'string' ? record.promptHash : '',
    inputHash: typeof record.inputHash === 'string' ? record.inputHash : '',
    preparationHash: typeof record.preparationHash === 'string' && record.preparationHash.trim()
      ? record.preparationHash
      : null,
    referenceImages: Array.isArray(record.referenceImages)
      ? record.referenceImages.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [],
    promptSpec: record.promptSpec ?? null,
    compiledPrompt,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : '',
  }
}

export function useGenerationPromptSnapshot(params: {
  isOpen: boolean
  projectId: string
  artifactId: string | null
  source: 'panel' | 'asset'
  panelId?: string | null
}) {
  const [snapshot, setSnapshot] = useState<GenerationPromptSnapshotDisplay | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!params.isOpen || !params.projectId || !params.artifactId) {
      setSnapshot(null)
      setErrorMessage(null)
      setLoading(false)
      return
    }
    if (params.source === 'panel' && !params.panelId) {
      setSnapshot(null)
      setErrorMessage('缺少镜头标识，无法读取生成快照。')
      setLoading(false)
      return
    }

    const controller = new AbortController()
    setSnapshot(null)
    setErrorMessage(null)
    setLoading(true)
    const baseUrl = `/api/novel-promotion/${encodeURIComponent(params.projectId)}`
    const url = params.source === 'panel'
      ? `${baseUrl}/panel-prompt-snapshot?panelId=${encodeURIComponent(params.panelId || '')}&artifactId=${encodeURIComponent(params.artifactId)}`
      : `${baseUrl}/asset-prompt-snapshot?artifactId=${encodeURIComponent(params.artifactId)}`

    fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('未找到该候选对应的生成快照。')
        const payload = await response.json() as { snapshot?: unknown }
        const nextSnapshot = normalizeSnapshot(payload.snapshot)
        if (!nextSnapshot) throw new Error('生成快照内容不完整。')
        return nextSnapshot
      })
      .then((nextSnapshot) => {
        if (!controller.signal.aborted) setSnapshot(nextSnapshot)
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        if (!controller.signal.aborted) {
          setErrorMessage(error instanceof Error ? error.message : '读取生成快照失败。')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [params.artifactId, params.isOpen, params.panelId, params.projectId, params.source])

  return { snapshot, errorMessage, loading }
}

export function useLatestPanelGenerationPromptSnapshot(params: {
  isOpen: boolean
  projectId: string
  panelId: string
  kind: 'image' | 'video'
}) {
  const [snapshot, setSnapshot] = useState<GenerationPromptSnapshotDisplay | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!params.isOpen || !params.projectId || !params.panelId) {
      setSnapshot(null)
      setErrorMessage(null)
      setLoading(false)
      return
    }

    const controller = new AbortController()
    setSnapshot(null)
    setErrorMessage(null)
    setLoading(true)
    const url = `/api/novel-promotion/${encodeURIComponent(params.projectId)}/panel-prompt-snapshot?panelId=${encodeURIComponent(params.panelId)}`
    fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('未找到该镜头的生成快照。')
        const payload = await response.json() as { snapshots?: Record<string, unknown> }
        const nextSnapshot = normalizeSnapshot(payload.snapshots?.[params.kind])
        if (!nextSnapshot) throw new Error('尚无可展示的实际生成提示词。')
        return nextSnapshot
      })
      .then((nextSnapshot) => {
        if (!controller.signal.aborted) setSnapshot(nextSnapshot)
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        if (!controller.signal.aborted) {
          setErrorMessage(error instanceof Error ? error.message : '读取生成快照失败。')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [params.isOpen, params.kind, params.panelId, params.projectId])

  return { snapshot, errorMessage, loading }
}
