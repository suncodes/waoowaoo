'use client'

import { useEffect, useState } from 'react'
import type { AIDataPromptSnapshotSet } from '../AIDataPromptPreview'

function normalizeSnapshot(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const compiledPrompt = typeof record.compiledPrompt === 'string' ? record.compiledPrompt : ''
  if (!compiledPrompt.trim()) return null
  return {
    artifactType: typeof record.artifactType === 'string' ? record.artifactType : '',
    modelKey: typeof record.modelKey === 'string' ? record.modelKey : '',
    promptHash: typeof record.promptHash === 'string' ? record.promptHash : '',
    compiledPrompt,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : '',
  }
}

function normalizeSnapshots(value: unknown): AIDataPromptSnapshotSet | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const snapshots = record.snapshots
  if (!snapshots || typeof snapshots !== 'object' || Array.isArray(snapshots)) return null
  const snapshotRecord = snapshots as Record<string, unknown>
  return {
    image: normalizeSnapshot(snapshotRecord.image),
    video: normalizeSnapshot(snapshotRecord.video),
  }
}

export function usePanelPromptSnapshots(params: {
  isOpen: boolean
  projectId: string
  panelId: string
}) {
  const [snapshots, setSnapshots] = useState<AIDataPromptSnapshotSet | null>(null)

  useEffect(() => {
    if (!params.isOpen || !params.projectId || !params.panelId) {
      setSnapshots(null)
      return
    }

    const controller = new AbortController()
    setSnapshots(null)
    const url = `/api/novel-promotion/${encodeURIComponent(params.projectId)}/panel-prompt-snapshot?panelId=${encodeURIComponent(params.panelId)}`

    fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return null
        return normalizeSnapshots(await response.json())
      })
      .then((nextSnapshots) => {
        if (!controller.signal.aborted) setSnapshots(nextSnapshots)
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        if (!controller.signal.aborted) setSnapshots(null)
      })

    return () => controller.abort()
  }, [params.isOpen, params.panelId, params.projectId])

  return snapshots
}
