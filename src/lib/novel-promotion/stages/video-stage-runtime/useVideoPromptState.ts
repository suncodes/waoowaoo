'use client'

import { useCallback, useEffect, useState } from 'react'
import { logError as _ulogError } from '@/lib/logging/core'
import type { VideoPanel } from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video'

export type PromptField = 'videoPrompt' | 'firstLastFramePrompt'

export interface DirtyPromptEntry {
  storyboardId: string
  panelIndex: number
  panelKey: string
  field: PromptField
  value: string
}

interface SavePromptOptions {
  throwOnError?: boolean
}

interface UseVideoPromptStateParams {
  allPanels: VideoPanel[]
  onUpdateVideoPrompt: (
    storyboardId: string,
    panelIndex: number,
    value: string,
    field?: PromptField,
  ) => Promise<void>
}

function buildPromptStateKey(panelKey: string, field: PromptField): string {
  return `${field}:${panelKey}`
}

function parsePromptStateKey(stateKey: string): { field: PromptField; panelKey: string } | null {
  const separatorIndex = stateKey.indexOf(':')
  if (separatorIndex <= 0) return null
  const field = stateKey.slice(0, separatorIndex)
  if (field !== 'videoPrompt' && field !== 'firstLastFramePrompt') return null
  return {
    field,
    panelKey: stateKey.slice(separatorIndex + 1),
  }
}

export function useVideoPromptState({
  allPanels,
  onUpdateVideoPrompt,
}: UseVideoPromptStateParams) {
  const [panelPrompts, setPanelPrompts] = useState<Map<string, string>>(new Map())
  const [savingPrompts, setSavingPrompts] = useState<Set<string>>(new Set())
  const [dirtyPrompts, setDirtyPrompts] = useState<Set<string>>(new Set())

  useEffect(() => {
    const panelKeySet = new Set<string>()
    for (const panel of allPanels) {
      panelKeySet.add(`${panel.storyboardId}-${panel.panelIndex}`)
    }

    setPanelPrompts((prev) => {
      const next = new Map(prev)
      for (const panel of allPanels) {
        const panelKey = `${panel.storyboardId}-${panel.panelIndex}`
        const promptEntries: Array<[PromptField, string]> = [
          ['videoPrompt', panel.textPanel?.video_prompt || ''],
          ['firstLastFramePrompt', panel.firstLastFramePrompt || ''],
        ]
        for (const [field, value] of promptEntries) {
          const stateKey = buildPromptStateKey(panelKey, field)
          if (dirtyPrompts.has(stateKey)) continue
          next.set(stateKey, value)
        }
      }
      for (const key of next.keys()) {
        const separatorIndex = key.indexOf(':')
        const panelKey = separatorIndex >= 0 ? key.slice(separatorIndex + 1) : key
        if (!panelKeySet.has(panelKey)) {
          next.delete(key)
        }
      }
      return next
    })
  }, [allPanels, dirtyPrompts])

  useEffect(() => {
    setDirtyPrompts((prev) => {
      if (prev.size === 0) return prev
      const next = new Set<string>()
      for (const key of prev) {
        if (panelPrompts.has(key)) next.add(key)
      }
      return next.size === prev.size ? prev : next
    })
  }, [panelPrompts])

  useEffect(() => {
    setDirtyPrompts((prev) => {
      if (prev.size === 0) return prev
      const externalPromptMap = new Map<string, string>()
      for (const panel of allPanels) {
        const panelKey = `${panel.storyboardId}-${panel.panelIndex}`
        externalPromptMap.set(
          buildPromptStateKey(panelKey, 'videoPrompt'),
          panel.textPanel?.video_prompt || '',
        )
        externalPromptMap.set(
          buildPromptStateKey(panelKey, 'firstLastFramePrompt'),
          panel.firstLastFramePrompt || '',
        )
      }
      const next = new Set(prev)
      for (const key of prev) {
        const externalPrompt = externalPromptMap.get(key)
        const localPrompt = panelPrompts.get(key)
        if (externalPrompt === undefined || localPrompt === undefined || externalPrompt === localPrompt) {
          next.delete(key)
        }
      }
      return next.size === prev.size ? prev : next
    })
  }, [allPanels, panelPrompts])

  const getLocalPrompt = useCallback((
    panelKey: string,
    externalPrompt?: string,
    field: PromptField = 'videoPrompt',
  ): string => {
    const stateKey = buildPromptStateKey(panelKey, field)
    if (panelPrompts.has(stateKey)) {
      return panelPrompts.get(stateKey) || ''
    }
    return externalPrompt || ''
  }, [panelPrompts])

  const updateLocalPrompt = useCallback((
    panelKey: string,
    value: string,
    field: PromptField = 'videoPrompt',
  ) => {
    const stateKey = buildPromptStateKey(panelKey, field)
    setPanelPrompts((prev) => {
      const next = new Map(prev)
      next.set(stateKey, value)
      return next
    })
    setDirtyPrompts((prev) => new Set(prev).add(stateKey))
  }, [])

  const savePrompt = useCallback(async (
    storyboardId: string,
    panelIndex: number,
    panelKey: string,
    value: string,
    field: PromptField = 'videoPrompt',
    options: SavePromptOptions = {},
  ) => {
    const stateKey = buildPromptStateKey(panelKey, field)
    setSavingPrompts((prev) => new Set(prev).add(stateKey))
    try {
      await onUpdateVideoPrompt(storyboardId, panelIndex, value, field)
    } catch (error) {
      _ulogError('保存视频提示词失败:', error)
      if (options.throwOnError) throw error
    } finally {
      setSavingPrompts((prev) => {
        const next = new Set(prev)
        next.delete(stateKey)
        return next
      })
    }
  }, [onUpdateVideoPrompt])

  const isPromptDirty = useCallback((
    panelKey: string,
    field: PromptField = 'videoPrompt',
  ): boolean => dirtyPrompts.has(buildPromptStateKey(panelKey, field)), [dirtyPrompts])

  const getDirtyPromptEntries = useCallback((
    predicate?: (entry: DirtyPromptEntry) => boolean,
  ): DirtyPromptEntry[] => {
    const panelsByKey = new Map(allPanels.map((panel) => [
      `${panel.storyboardId}-${panel.panelIndex}`,
      panel,
    ]))
    const entries: DirtyPromptEntry[] = []
    for (const stateKey of dirtyPrompts) {
      const parsed = parsePromptStateKey(stateKey)
      if (!parsed) continue
      const panel = panelsByKey.get(parsed.panelKey)
      if (!panel) continue
      const value = panelPrompts.get(stateKey)
      if (value === undefined) continue
      const entry: DirtyPromptEntry = {
        storyboardId: panel.storyboardId,
        panelIndex: panel.panelIndex,
        panelKey: parsed.panelKey,
        field: parsed.field,
        value,
      }
      if (!predicate || predicate(entry)) entries.push(entry)
    }
    return entries
  }, [allPanels, dirtyPrompts, panelPrompts])

  const saveDirtyPrompts = useCallback(async (
    predicate?: (entry: DirtyPromptEntry) => boolean,
  ): Promise<number> => {
    const entries = getDirtyPromptEntries(predicate)
    await Promise.all(entries.map((entry) => savePrompt(
      entry.storyboardId,
      entry.panelIndex,
      entry.panelKey,
      entry.value,
      entry.field,
      { throwOnError: true },
    )))
    return entries.length
  }, [getDirtyPromptEntries, savePrompt])

  return {
    dirtyPrompts,
    savingPrompts,
    getLocalPrompt,
    updateLocalPrompt,
    savePrompt,
    isPromptDirty,
    getDirtyPromptEntries,
    saveDirtyPrompts,
  }
}
