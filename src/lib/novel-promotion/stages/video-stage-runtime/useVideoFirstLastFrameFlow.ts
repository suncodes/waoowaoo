'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  VideoGenerationOptions,
  VideoModelOption,
  VideoPanel,
} from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video'
import {
  normalizeVideoGenerationSelections,
  resolveEffectiveVideoCapabilityDefinitions,
  resolveEffectiveVideoCapabilityFields,
} from '@/lib/model-capabilities/video-effective'
import { supportsFirstLastFrame } from '@/lib/model-capabilities/video-model-options'
import { projectVideoPricingTiersByFixedSelections } from '@/lib/model-pricing/video-tier'
import {
  pickVideoDurationSeconds,
  readPanelTargetDurationMs,
} from '@/lib/video-generation-duration'

interface FirstLastFrameCapabilityField {
  field: string
  label: string
  options: VideoGenerationOptionValue[]
  disabledOptions?: VideoGenerationOptionValue[]
  value: VideoGenerationOptionValue | undefined
}

type VideoGenerationOptionValue = string | number | boolean

function stringMapsEqual(
  left: Map<string, string>,
  right: Map<string, string>,
): boolean {
  if (left.size !== right.size) return false
  for (const [key, value] of left) {
    if (right.get(key) !== value) return false
  }
  return true
}

function parseByOptionType(
  input: string,
  sample: VideoGenerationOptionValue,
): VideoGenerationOptionValue {
  if (typeof sample === 'number') return Number(input)
  if (typeof sample === 'boolean') return input === 'true'
  return input
}

function toFieldLabel(field: string): string {
  return field.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase())
}

function panelKeyFor(panel: Pick<VideoPanel, 'storyboardId' | 'panelIndex'>): string {
  return `${panel.storyboardId}-${panel.panelIndex}`
}

interface UseVideoFirstLastFrameFlowParams {
  allPanels: VideoPanel[]
  linkedPanels: Map<string, boolean>
  videoModelOptions: VideoModelOption[]
  onGenerateVideo: (
    storyboardId: string,
    panelIndex: number,
    videoModel?: string,
    firstLastFrame?: {
      lastFrameStoryboardId: string
      lastFramePanelIndex: number
      flModel: string
      customPrompt?: string
    },
    generationOptions?: VideoGenerationOptions,
    panelId?: string,
  ) => Promise<void>
  t: (key: string) => string
}

export function useVideoFirstLastFrameFlow({
  allPanels,
  linkedPanels,
  videoModelOptions,
  onGenerateVideo,
  t,
}: UseVideoFirstLastFrameFlowParams) {
  const firstLastFrameModelOptions = useMemo(
    () => videoModelOptions.filter((option) => supportsFirstLastFrame(option)),
    [videoModelOptions],
  )
  const [flModel, setFlModel] = useState(firstLastFrameModelOptions[0]?.value || '')
  const [flGenerationOptions, setFlGenerationOptions] = useState<VideoGenerationOptions>({
    generationMode: 'firstlastframe',
  })
  const [flManualCapabilityFields, setFlManualCapabilityFields] = useState<Set<string>>(() => new Set())
  const [flCustomPrompts, setFlCustomPrompts] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    setFlCustomPrompts((previous) => {
      const next = new Map(previous)
      const existingPanelKeys = new Set<string>()

      for (const panel of allPanels) {
        const panelKey = panelKeyFor(panel)
        existingPanelKeys.add(panelKey)
        if (!next.has(panelKey) && panel.firstLastFramePrompt !== undefined) {
          next.set(panelKey, panel.firstLastFramePrompt || '')
        }
      }

      for (const key of next.keys()) {
        if (!existingPanelKeys.has(key)) next.delete(key)
      }

      return stringMapsEqual(previous, next) ? previous : next
    })
  }, [allPanels])

  useEffect(() => {
    if (!flModel && firstLastFrameModelOptions.length > 0) {
      setFlModel(firstLastFrameModelOptions[0].value)
      return
    }
    if (flModel && !firstLastFrameModelOptions.some((option) => option.value === flModel)) {
      setFlModel(firstLastFrameModelOptions[0]?.value || '')
    }
  }, [firstLastFrameModelOptions, flModel])

  const selectedFlModelOption = useMemo(
    () => firstLastFrameModelOptions.find((option) => option.value === flModel),
    [firstLastFrameModelOptions, flModel],
  )
  const flPricingTiers = useMemo(
    () => projectVideoPricingTiersByFixedSelections({
      tiers: selectedFlModelOption?.videoPricingTiers ?? [],
      fixedSelections: {
        generationMode: 'firstlastframe',
      },
    }),
    [selectedFlModelOption?.videoPricingTiers],
  )
  const flCapabilityDefinitions = useMemo(
    () => resolveEffectiveVideoCapabilityDefinitions({
      videoCapabilities: selectedFlModelOption?.capabilities?.video,
      pricingTiers: flPricingTiers,
    }),
    [flPricingTiers, selectedFlModelOption?.capabilities?.video],
  )

  useEffect(() => {
    setFlGenerationOptions((previous) => {
      return {
        ...normalizeVideoGenerationSelections({
          definitions: flCapabilityDefinitions,
          pricingTiers: flPricingTiers,
          selection: {
            ...previous,
            generationMode: 'firstlastframe',
          },
          pinnedFields: ['generationMode'],
        }),
        generationMode: 'firstlastframe',
      }
    })
  }, [flCapabilityDefinitions, flPricingTiers])

  const flEffectiveCapabilityFields = useMemo(
    () => resolveEffectiveVideoCapabilityFields({
      definitions: flCapabilityDefinitions,
      pricingTiers: flPricingTiers,
      selection: flGenerationOptions,
    }),
    [flCapabilityDefinitions, flGenerationOptions, flPricingTiers],
  )
  const flDefinitionFieldMap = useMemo(
    () => new Map(flCapabilityDefinitions.map((definition) => [definition.field, definition])),
    [flCapabilityDefinitions],
  )

  const buildFlCapabilityFields = useCallback((selection: VideoGenerationOptions): FirstLastFrameCapabilityField[] => {
    const effectiveCapabilityFields = resolveEffectiveVideoCapabilityFields({
      definitions: flCapabilityDefinitions,
      pricingTiers: flPricingTiers,
      selection,
    })
    const effectiveFieldMap = new Map(effectiveCapabilityFields.map((field) => [field.field, field]))
    return flCapabilityDefinitions
      .filter((definition) => definition.field !== 'generationMode')
      .map((definition) => {
        const effectiveField = effectiveFieldMap.get(definition.field)
        const enabledOptions = effectiveField?.options ?? []
        return {
          field: definition.field,
          label: toFieldLabel(definition.field),
          options: definition.options as VideoGenerationOptionValue[],
          disabledOptions: (definition.options as VideoGenerationOptionValue[])
            .filter((option) => !enabledOptions.includes(option)),
          value: effectiveField?.value as VideoGenerationOptionValue | undefined,
        }
      })
  }, [flCapabilityDefinitions, flPricingTiers])

  const flCapabilityFields: FirstLastFrameCapabilityField[] = useMemo(
    () => buildFlCapabilityFields(flGenerationOptions),
    [buildFlCapabilityFields, flGenerationOptions],
  )

  const flMissingCapabilityFields = useMemo(
    () => flEffectiveCapabilityFields
      .filter((field) => field.options.length === 0 || field.value === undefined)
      .map((field) => field.field),
    [flEffectiveCapabilityFields],
  )

  const setFlCapabilityValue = useCallback((field: string, rawValue: string) => {
    const definitionField = flDefinitionFieldMap.get(field)
    if (!definitionField || definitionField.options.length === 0) return
    const parsedValue = parseByOptionType(rawValue, definitionField.options[0])
    if (!definitionField.options.includes(parsedValue)) return
    setFlManualCapabilityFields((previous) => {
      if (previous.has(field)) return previous
      return new Set(previous).add(field)
    })
    setFlGenerationOptions((previous) => ({
      ...normalizeVideoGenerationSelections({
        definitions: flCapabilityDefinitions,
        pricingTiers: flPricingTiers,
        selection: {
          ...previous,
          [field]: parsedValue,
          generationMode: 'firstlastframe',
        },
        pinnedFields: [field, 'generationMode'],
      }),
      generationMode: 'firstlastframe',
    }))
  }, [flCapabilityDefinitions, flDefinitionFieldMap, flPricingTiers])

  const getPanelAutoDuration = useCallback((panelKey: string): number | undefined => {
    if (flManualCapabilityFields.has('duration')) return undefined
    const definition = flDefinitionFieldMap.get('duration')
    const supportedDurations = (definition?.options || [])
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    if (supportedDurations.length === 0) return undefined
    const panel = allPanels.find((candidate) => panelKeyFor(candidate) === panelKey)
    if (!panel) return undefined
    return pickVideoDurationSeconds({
      targetDurationMs: readPanelTargetDurationMs({
        targetDurationMs: panel.targetDurationMs,
        duration: panel.textPanel?.duration,
      }),
      supportedDurations,
    })
  }, [allPanels, flDefinitionFieldMap, flManualCapabilityFields])

  const resolveFlGenerationOptionsForPanel = useCallback((
    panelKey: string,
    options?: VideoGenerationOptions,
    mode: 'display' | 'submit' = 'submit',
  ): VideoGenerationOptions => {
    const selection: VideoGenerationOptions = {
      ...(options || flGenerationOptions),
      generationMode: 'firstlastframe',
    }
    const usesManualDuration = flManualCapabilityFields.has('duration')
    const autoDuration = getPanelAutoDuration(panelKey)
    if (!usesManualDuration && autoDuration !== undefined) {
      selection.duration = autoDuration
    }

    const normalized: VideoGenerationOptions = {
      ...normalizeVideoGenerationSelections({
        definitions: flCapabilityDefinitions,
        pricingTiers: flPricingTiers,
        selection,
        pinnedFields: [
          ...(!usesManualDuration && autoDuration !== undefined ? ['duration'] : []),
          'generationMode',
        ],
      }),
      generationMode: 'firstlastframe',
    }

    if (mode === 'submit' && !usesManualDuration && autoDuration === undefined) {
      delete normalized.duration
    }
    return normalized
  }, [flCapabilityDefinitions, flGenerationOptions, flManualCapabilityFields, flPricingTiers, getPanelAutoDuration])

  const getFlGenerationOptionsForPanel = useCallback((panelKey: string, options?: VideoGenerationOptions): VideoGenerationOptions => (
    resolveFlGenerationOptionsForPanel(panelKey, options, 'submit')
  ), [resolveFlGenerationOptionsForPanel])

  const getFlGenerationOptionsForBatch = useCallback((): VideoGenerationOptions => {
    const normalized: VideoGenerationOptions = {
      ...normalizeVideoGenerationSelections({
        definitions: flCapabilityDefinitions,
        pricingTiers: flPricingTiers,
        selection: {
          ...flGenerationOptions,
          generationMode: 'firstlastframe',
        },
        pinnedFields: ['generationMode'],
      }),
      generationMode: 'firstlastframe',
    }
    if (!flManualCapabilityFields.has('duration')) {
      delete normalized.duration
    }
    return normalized
  }, [flCapabilityDefinitions, flGenerationOptions, flManualCapabilityFields, flPricingTiers])

  const getFlCapabilityFields = useCallback((panelKey: string): FirstLastFrameCapabilityField[] => (
    buildFlCapabilityFields(resolveFlGenerationOptionsForPanel(panelKey, undefined, 'display'))
  ), [buildFlCapabilityFields, resolveFlGenerationOptionsForPanel])

  const setFlCustomPrompt = useCallback((panelKey: string, value: string) => {
    setFlCustomPrompts((previous) => new Map(previous).set(panelKey, value))
  }, [])

  const resetFlCustomPrompt = useCallback((panelKey: string) => {
    setFlCustomPrompts((previous) => {
      const next = new Map(previous)
      next.delete(panelKey)
      return next
    })
  }, [])

  const handleGenerateFirstLastFrame = useCallback(async (
    firstStoryboardId: string,
    firstPanelIndex: number,
    lastStoryboardId: string,
    lastPanelIndex: number,
    panelKey: string,
    generationOptions?: VideoGenerationOptions,
    firstPanelId?: string,
  ) => {
    const persistedCustomPrompt = allPanels.find(
      (panel) =>
        panel.storyboardId === firstStoryboardId
        && panel.panelIndex === firstPanelIndex,
    )?.firstLastFramePrompt
    const customPrompt = flCustomPrompts.get(panelKey) ?? persistedCustomPrompt
    await onGenerateVideo(firstStoryboardId, firstPanelIndex, flModel, {
      lastFrameStoryboardId: lastStoryboardId,
      lastFramePanelIndex: lastPanelIndex,
      flModel,
      customPrompt,
    }, getFlGenerationOptionsForPanel(panelKey, generationOptions), firstPanelId)
  }, [allPanels, flCustomPrompts, flModel, getFlGenerationOptionsForPanel, onGenerateVideo])

  const getDefaultFlPrompt = useCallback((firstPrompt?: string, lastPrompt?: string): string => {
    const first = firstPrompt || ''
    const last = lastPrompt || ''
    if (last) {
      return `${first} ${t('firstLastFrame.thenTransitionTo')}: ${last}`
    }
    return first
  }, [t])

  const getNextPanel = useCallback((currentIndex: number): VideoPanel | null => {
    if (currentIndex >= allPanels.length - 1) return null
    return allPanels[currentIndex + 1]
  }, [allPanels])

  const isLinkedAsLastFrame = useCallback((currentIndex: number): boolean => {
    if (currentIndex === 0) return false
    const previousPanel = allPanels[currentIndex - 1]
    const previousKey = `${previousPanel.storyboardId}-${previousPanel.panelIndex}`
    return linkedPanels.get(previousKey) || false
  }, [allPanels, linkedPanels])

  return {
    flModel,
    flModelOptions: firstLastFrameModelOptions,
    flGenerationOptions,
    flCapabilityFields,
    flMissingCapabilityFields,
    flCustomPrompts,
    flManualCapabilityFields,
    setFlModel,
    setFlCapabilityValue,
    setFlCustomPrompt,
    resetFlCustomPrompt,
    handleGenerateFirstLastFrame,
    getFlCapabilityFields,
    getFlGenerationOptionsForPanel,
    getFlGenerationOptionsForBatch,
    getDefaultFlPrompt,
    getNextPanel,
    isLinkedAsLastFrame,
  }
}
