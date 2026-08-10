'use client'

import { type ChangeEvent, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
    ART_STYLES,
    DEFAULT_ART_STYLE,
    DEFAULT_VIDEO_RATIO,
    VIDEO_RATIOS,
} from '@/lib/constants'
import type {
    CapabilitySelections,
    CapabilityValue,
    ModelCapabilities,
} from '@/lib/model-config-contract'
import { filterNormalVideoModelOptions } from '@/lib/model-capabilities/video-model-options'
import { RatioSelector, StyleSelector } from './config-modal-selectors'
import { ModelCapabilityDropdown } from './ModelCapabilityDropdown'
import { AppIcon } from '@/components/ui/icons'
import ProductModalShell from '@/components/product/ProductModalShell'

interface ModelOption {
    value: string
    label: string
    provider?: string
    providerName?: string
    capabilities?: ModelCapabilities
}

interface UserModels {
    llm: ModelOption[]
    image: ModelOption[]
    video: ModelOption[]
    audio: ModelOption[]
}

interface CapabilityFieldDefinition {
    field: string
    options: CapabilityValue[]
    label: string
}

interface SettingsModalProps {
    isOpen: boolean
    onClose: () => void
    availableModels?: Partial<UserModels>
    modelsLoaded?: boolean
    artStyle?: string
    artStyleMode?: string
    artStylePrompt?: string | null
    artStyleReferenceEnabled?: boolean
    customArtStyleReferenceImage?: string | null
    customArtStyleReferenceImageUrl?: string | null
    analysisModel?: string
    characterModel?: string
    locationModel?: string
    imageModel?: string
    editModel?: string

    videoModel?: string
    audioModel?: string
    videoRatio?: string
    capabilityOverrides?: CapabilitySelections
    ttsRate?: string
    onArtStyleChange?: (value: string) => void
    onArtStyleModeChange?: (value: 'preset' | 'custom') => void
    onArtStylePromptChange?: (value: string | null) => void
    onArtStyleReferenceEnabledChange?: (value: boolean) => void
    onCustomArtStyleReferenceImageChange?: (value: string | null) => void
    onAnalysisModelChange?: (value: string) => void
    onCharacterModelChange?: (value: string) => void
    onLocationModelChange?: (value: string) => void
    onImageModelChange?: (value: string) => void
    onEditModelChange?: (value: string) => void

    onVideoModelChange?: (value: string) => void
    onAudioModelChange?: (value: string) => void
    onVideoRatioChange?: (value: string) => void
    onCapabilityOverridesChange?: (value: CapabilitySelections) => void
    onTTSRateChange?: (value: string) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isCapabilityValue(value: unknown): value is CapabilityValue {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function toFieldLabel(field: string): string {
    return field.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase())
}

function parseBySample(input: string, sample: CapabilityValue): CapabilityValue {
    if (typeof sample === 'number') return Number(input)
    if (typeof sample === 'boolean') return input === 'true'
    return input
}

function extractCapabilityFields(
    capabilities: ModelCapabilities | undefined,
    namespace: 'llm' | 'image' | 'video' | 'audio',
): CapabilityFieldDefinition[] {
    const rawNamespace = capabilities?.[namespace]
    if (!isRecord(rawNamespace)) return []

    return Object.entries(rawNamespace)
        .filter(([key, value]) => key.endsWith('Options') && Array.isArray(value) && value.every(isCapabilityValue) && value.length > 0)
        .map(([key, value]) => {
            const field = key.slice(0, -'Options'.length)
            return {
                field,
                options: value as CapabilityValue[],
                label: toFieldLabel(field),
            }
        })
}

function readCapabilitySelectionForModel(
    overrides: CapabilitySelections | undefined,
    modelKey: string | undefined,
): Record<string, CapabilityValue> {
    if (!modelKey || !overrides) return {}
    const raw = overrides[modelKey]
    if (!isRecord(raw)) return {}

    const normalized: Record<string, CapabilityValue> = {}
    for (const [field, value] of Object.entries(raw)) {
        if (isCapabilityValue(value)) {
            normalized[field] = value
        }
    }
    return normalized
}

export function SettingsModal({
    isOpen,
    onClose,
    availableModels,
    modelsLoaded = false,
    artStyle = DEFAULT_ART_STYLE,
    artStyleMode = 'preset',
    artStylePrompt = '',
    artStyleReferenceEnabled = false,
    customArtStyleReferenceImage = '',
    customArtStyleReferenceImageUrl = '',
    analysisModel,
    characterModel,
    locationModel,
    imageModel,
    editModel,
    videoModel,
    audioModel,
    videoRatio = DEFAULT_VIDEO_RATIO,
    capabilityOverrides,
    ttsRate,
    onArtStyleChange,
    onArtStyleModeChange,
    onArtStylePromptChange,
    onArtStyleReferenceEnabledChange,
    onCustomArtStyleReferenceImageChange,
    onAnalysisModelChange,
    onCharacterModelChange,
    onLocationModelChange,
    onImageModelChange,
    onEditModelChange,
    onVideoModelChange,
    onAudioModelChange,
    onVideoRatioChange,
    onCapabilityOverridesChange,
    onTTSRateChange,
}: SettingsModalProps) {
    const t = useTranslations('configModal')
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle')
    const [customPromptDraft, setCustomPromptDraft] = useState(artStylePrompt || '')
    const [customReferencePreviewUrl, setCustomReferencePreviewUrl] = useState<string | null>(customArtStyleReferenceImageUrl || null)
    const [isUploadingCustomStyleImage, setIsUploadingCustomStyleImage] = useState(false)
    const userModels = useMemo<UserModels>(() => ({
        llm: Array.isArray(availableModels?.llm) ? availableModels.llm : [],
        image: Array.isArray(availableModels?.image) ? availableModels.image : [],
        video: Array.isArray(availableModels?.video) ? availableModels.video : [],
        audio: Array.isArray(availableModels?.audio) ? availableModels.audio : [],
    }), [availableModels])
    const normalVideoModels = useMemo<ModelOption[]>(
        () => filterNormalVideoModelOptions(userModels.video),
        [userModels.video],
    )

    const selectedVideoModelOption = useMemo(
        () => normalVideoModels.find((model) => model.value === videoModel) || null,
        [normalVideoModels, videoModel],
    )
    const selectedAnalysisModelOption = useMemo(
        () => userModels.llm.find((model) => model.value === analysisModel) || null,
        [userModels.llm, analysisModel],
    )
    const selectedAudioModelOption = useMemo(
        () => userModels.audio.find((model) => model.value === audioModel) || null,
        [userModels.audio, audioModel],
    )

    const videoCapabilityFields = useMemo(
        () => extractCapabilityFields(selectedVideoModelOption?.capabilities, 'video'),
        [selectedVideoModelOption],
    )
    const analysisCapabilityFields = useMemo(
        () => extractCapabilityFields(selectedAnalysisModelOption?.capabilities, 'llm'),
        [selectedAnalysisModelOption],
    )
    const audioCapabilityFields = useMemo(
        () => extractCapabilityFields(selectedAudioModelOption?.capabilities, 'audio'),
        [selectedAudioModelOption],
    )
    const selectedCharacterModelOption = useMemo(
        () => userModels.image.find((model) => model.value === characterModel) || null,
        [userModels.image, characterModel],
    )
    const selectedLocationModelOption = useMemo(
        () => userModels.image.find((model) => model.value === locationModel) || null,
        [userModels.image, locationModel],
    )
    const selectedStoryboardModelOption = useMemo(
        () => userModels.image.find((model) => model.value === imageModel) || null,
        [userModels.image, imageModel],
    )
    const selectedEditModelOption = useMemo(
        () => userModels.image.find((model) => model.value === editModel) || null,
        [userModels.image, editModel],
    )
    const characterCapabilityFields = useMemo(
        () => extractCapabilityFields(selectedCharacterModelOption?.capabilities, 'image'),
        [selectedCharacterModelOption],
    )
    const locationCapabilityFields = useMemo(
        () => extractCapabilityFields(selectedLocationModelOption?.capabilities, 'image'),
        [selectedLocationModelOption],
    )
    const storyboardCapabilityFields = useMemo(
        () => extractCapabilityFields(selectedStoryboardModelOption?.capabilities, 'image'),
        [selectedStoryboardModelOption],
    )
    const editCapabilityFields = useMemo(
        () => extractCapabilityFields(selectedEditModelOption?.capabilities, 'image'),
        [selectedEditModelOption],
    )

    const selectedVideoOverrides = useMemo<Record<string, CapabilityValue>>(() => {
        return readCapabilitySelectionForModel(capabilityOverrides, videoModel)
    }, [capabilityOverrides, videoModel])
    const selectedAnalysisOverrides = useMemo<Record<string, CapabilityValue>>(() => {
        return readCapabilitySelectionForModel(capabilityOverrides, analysisModel)
    }, [capabilityOverrides, analysisModel])
    const selectedAudioOverrides = useMemo<Record<string, CapabilityValue>>(() => {
        return readCapabilitySelectionForModel(capabilityOverrides, audioModel)
    }, [capabilityOverrides, audioModel])
    const selectedCharacterOverrides = useMemo<Record<string, CapabilityValue>>(() => {
        return readCapabilitySelectionForModel(capabilityOverrides, characterModel)
    }, [capabilityOverrides, characterModel])
    const selectedLocationOverrides = useMemo<Record<string, CapabilityValue>>(() => {
        return readCapabilitySelectionForModel(capabilityOverrides, locationModel)
    }, [capabilityOverrides, locationModel])
    const selectedStoryboardOverrides = useMemo<Record<string, CapabilityValue>>(() => {
        return readCapabilitySelectionForModel(capabilityOverrides, imageModel)
    }, [capabilityOverrides, imageModel])
    const selectedEditOverrides = useMemo<Record<string, CapabilityValue>>(() => {
        return readCapabilitySelectionForModel(capabilityOverrides, editModel)
    }, [capabilityOverrides, editModel])
    const resolvedArtStyleMode: 'preset' | 'custom' = artStyleMode === 'custom' ? 'custom' : 'preset'

    const applyCapabilityOverride = (modelKey: string | undefined, field: string, value: string, sample: CapabilityValue) => {
        if (!modelKey || !onCapabilityOverridesChange) return

        const nextOverrides: CapabilitySelections = {
            ...(capabilityOverrides || {}),
        }
        const currentSelection = isRecord(nextOverrides[modelKey])
            ? { ...(nextOverrides[modelKey] as Record<string, CapabilityValue>) }
            : {}

        if (!value) {
            delete currentSelection[field]
        } else {
            currentSelection[field] = parseBySample(value, sample)
        }

        if (Object.keys(currentSelection).length === 0) {
            delete nextOverrides[modelKey]
        } else {
            nextOverrides[modelKey] = currentSelection
        }

        onCapabilityOverridesChange(nextOverrides)
        showSaved()
    }

    /**
     * 切换模型时，自动将该模型所有 capability fields 的第一个 option 写入 overrides
     * 解决 UI 视觉上显示默认选中（第一项高亮）但 DB 实际为空，导致 requireAllFields 报错的问题
     */
    const handleModelChange = (
        modelKey: string,
        modelOptions: ModelOption[],
        namespace: 'llm' | 'image' | 'video' | 'audio',
        onModelChangeFn?: (v: string) => void,
    ) => {
        onModelChangeFn?.(modelKey)
        showSaved()
        if (!onCapabilityOverridesChange) return
        // 用新选中的模型的 capabilities 计算 fields，而不是旧模型的
        const newModel = modelOptions.find((m) => m.value === modelKey)
        const capabilityFieldsForModel = extractCapabilityFields(newModel?.capabilities, namespace)
        if (capabilityFieldsForModel.length === 0) return
        const nextOverrides: CapabilitySelections = { ...(capabilityOverrides || {}) }
        const existing = isRecord(nextOverrides[modelKey])
            ? { ...(nextOverrides[modelKey] as Record<string, CapabilityValue>) }
            : {}
        // 只对尚未配置的 field 设置默认值（不覆盖已有配置）
        let changed = false
        for (const def of capabilityFieldsForModel) {
            if (existing[def.field] === undefined && def.options.length > 0) {
                existing[def.field] = def.options[0]
                changed = true
            }
        }
        if (changed) {
            nextOverrides[modelKey] = existing
            onCapabilityOverridesChange(nextOverrides)
        }
    }

    void ttsRate
    void onTTSRateChange

    useEffect(() => {
        if (!isOpen) return
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose()
        }
        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [isOpen, onClose])

    const showSaved = () => {
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 2000)
    }

    const handleChange = (callback?: (value: string) => void) => (value: string) => {
        callback?.(value)
        showSaved()
    }

    const handleArtStyleChange = (value: string) => {
        if (resolvedArtStyleMode !== 'preset') {
            onArtStyleModeChange?.('preset')
        }
        onArtStyleChange?.(value)
        showSaved()
    }

    const handleArtStyleModeChange = (value: 'preset' | 'custom') => {
        onArtStyleModeChange?.(value)
        showSaved()
    }

    const commitCustomPrompt = () => {
        const trimmed = customPromptDraft.trim()
        const current = (artStylePrompt || '').trim()
        if (trimmed === current) return
        onArtStylePromptChange?.(trimmed || null)
        showSaved()
    }

    const readFileAsDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
            if (typeof reader.result === 'string') {
                resolve(reader.result)
            } else {
                reject(new Error('Invalid file result'))
            }
        }
        reader.onerror = () => reject(reader.error || new Error('Failed to read file'))
        reader.readAsDataURL(file)
    })

    const handleCustomStyleImageUpload = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return
        if (!file.type.startsWith('image/')) {
            window.alert(t('customArtStyleUploadInvalidType'))
            return
        }
        if (file.size > 10 * 1024 * 1024) {
            window.alert(t('customArtStyleUploadTooLarge'))
            return
        }

        setIsUploadingCustomStyleImage(true)
        try {
            const imageBase64 = await readFileAsDataUrl(file)
            const response = await fetch('/api/asset-hub/upload-temp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageBase64 }),
            })
            if (!response.ok) {
                throw new Error(`Upload failed: ${response.status}`)
            }
            const data = await response.json() as { key?: string; url?: string }
            if (!data.key) {
                throw new Error('Upload response missing key')
            }
            setCustomReferencePreviewUrl(data.url || imageBase64)
            onCustomArtStyleReferenceImageChange?.(data.key)
            showSaved()
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Upload failed'
            window.alert(message)
        } finally {
            setIsUploadingCustomStyleImage(false)
        }
    }

    const handleClearCustomStyleImage = () => {
        setCustomReferencePreviewUrl(null)
        onCustomArtStyleReferenceImageChange?.(null)
        showSaved()
    }

    useEffect(() => {
        setCustomPromptDraft(artStylePrompt || '')
    }, [artStylePrompt])

    useEffect(() => {
        setCustomReferencePreviewUrl(customArtStyleReferenceImageUrl || null)
    }, [customArtStyleReferenceImageUrl, customArtStyleReferenceImage])

    if (!isOpen) return null

    return (
        <ProductModalShell
            open={isOpen}
            onClose={onClose}
            size="xl"
            eyebrow="Project Settings"
            title={t('title')}
            description={t('subtitle')}
        >
            <div className="space-y-5">
                <div className="flex justify-end">
                        <div className={`inline-flex items-center gap-2 border px-3 py-1.5 text-xs transition-colors ${saveStatus === 'saved'
                            ? 'border-emerald-300/25 bg-emerald-300/10 text-emerald-200'
                            : 'border-white/10 bg-white/[0.04] text-stone-400'
                            }`}>
                            {saveStatus === 'saved' ? (
                                <>
                                    <AppIcon name="check" className="w-3.5 h-3.5" />
                                    {t('saved')}
                                </>
                            ) : (
                                <>
                                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-300"></span>
                                    {t('autoSave')}
                                </>
                            )}
                        </div>
                </div>
                <div className="space-y-5">
                    <div className="space-y-4 border border-white/10 bg-[#10110f] p-5 sm:p-6">
                        <h3 className="text-sm font-semibold text-[var(--glass-text-tertiary)]">{t('visualSettings')}</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-[var(--glass-text-secondary)]">{t('visualStyle')}</label>
                                <StyleSelector
                                    value={artStyle}
                                    onChange={handleArtStyleChange}
                                    options={ART_STYLES}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-[var(--glass-text-secondary)]">{t('aspectRatio')}</label>
                                <RatioSelector
                                    value={videoRatio}
                                    onChange={(value) => { handleChange(onVideoRatioChange)(value) }}
                                    options={VIDEO_RATIOS}
                                />
                            </div>
                        </div>
                        <div className="rounded-2xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] p-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <div className="text-sm font-medium text-[var(--glass-text-secondary)]">{t('artStyleMode')}</div>
                                    <div className="mt-1 text-xs leading-relaxed text-[var(--glass-text-tertiary)]">{t('artStyleModeHint')}</div>
                                </div>
                                <div className="inline-flex rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)] p-1">
                                    <button
                                        type="button"
                                        onClick={() => handleArtStyleModeChange('preset')}
                                        className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                                            resolvedArtStyleMode === 'preset'
                                                ? 'bg-[var(--glass-accent-from)] text-white'
                                                : 'text-[var(--glass-text-secondary)] hover:bg-[var(--glass-bg-surface-strong)]'
                                        }`}
                                    >
                                        {t('artStyleModePreset')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleArtStyleModeChange('custom')}
                                        className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                                            resolvedArtStyleMode === 'custom'
                                                ? 'bg-[var(--glass-accent-from)] text-white'
                                                : 'text-[var(--glass-text-secondary)] hover:bg-[var(--glass-bg-surface-strong)]'
                                        }`}
                                    >
                                        {t('artStyleModeCustom')}
                                    </button>
                                </div>
                            </div>

                            {resolvedArtStyleMode === 'custom' ? (
                                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-[var(--glass-text-secondary)]">{t('customArtStylePrompt')}</label>
                                        <textarea
                                            value={customPromptDraft}
                                            onChange={(event) => setCustomPromptDraft(event.target.value)}
                                            onBlur={commitCustomPrompt}
                                            rows={5}
                                            maxLength={4000}
                                            placeholder={t('customArtStylePromptPlaceholder')}
                                            className="glass-input-base min-h-[130px] resize-y px-3 py-2 text-sm leading-relaxed"
                                        />
                                        <div className="text-[11px] text-[var(--glass-text-tertiary)]">
                                            {t('customArtStylePromptHint')}
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <div className="text-sm font-medium text-[var(--glass-text-secondary)]">{t('customArtStyleReferenceImage')}</div>
                                        <div className="overflow-hidden rounded-xl border border-[var(--glass-stroke-soft)] bg-[var(--glass-bg-muted)]">
                                            {customReferencePreviewUrl ? (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img
                                                    src={customReferencePreviewUrl}
                                                    alt={t('customArtStyleReferenceImage')}
                                                    className="h-32 w-full object-cover"
                                                />
                                            ) : (
                                                <div className="flex h-32 items-center justify-center px-4 text-center text-xs text-[var(--glass-text-tertiary)]">
                                                    {t('customArtStyleReferenceImageEmpty')}
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            <label className={`glass-btn-base glass-btn-soft cursor-pointer px-3 py-2 text-xs ${isUploadingCustomStyleImage ? 'pointer-events-none opacity-60' : ''}`}>
                                                <input
                                                    type="file"
                                                    accept="image/*"
                                                    className="hidden"
                                                    disabled={isUploadingCustomStyleImage}
                                                    onChange={handleCustomStyleImageUpload}
                                                />
                                                {isUploadingCustomStyleImage ? t('customArtStyleUploading') : t('customArtStyleUpload')}
                                            </label>
                                            {customReferencePreviewUrl || customArtStyleReferenceImage ? (
                                                <button
                                                    type="button"
                                                    onClick={handleClearCustomStyleImage}
                                                    className="glass-btn-base glass-btn-soft px-3 py-2 text-xs text-[var(--glass-tone-danger-fg)]"
                                                >
                                                    {t('customArtStyleClear')}
                                                </button>
                                            ) : null}
                                        </div>
                                        <div className="text-[11px] leading-relaxed text-[var(--glass-text-tertiary)]">
                                            {t('customArtStyleReferenceImageHint')}
                                        </div>
                                    </div>
                                </div>
                            ) : null}
                        </div>
                        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] p-4 transition-colors hover:border-[var(--glass-stroke-focus)]">
                            <input
                                type="checkbox"
                                checked={artStyleReferenceEnabled}
                                onChange={(event) => {
                                    onArtStyleReferenceEnabledChange?.(event.target.checked)
                                    showSaved()
                                }}
                                className="mt-1 h-4 w-4 accent-[var(--glass-tone-info-fg)]"
                            />
                            <span className="min-w-0">
                                <span className="block text-sm font-medium text-[var(--glass-text-secondary)]">{t('artStyleReferenceImage')}</span>
                                <span className="mt-1 block text-xs leading-relaxed text-[var(--glass-text-tertiary)]">{t('artStyleReferenceImageHint')}</span>
                            </span>
                        </label>
                    </div>

                    <div className="space-y-4 border border-white/10 bg-[#10110f] p-5 sm:p-6">
                        <h3 className="text-sm font-semibold text-[var(--glass-text-tertiary)]">{t('modelParams')}</h3>
                        {!modelsLoaded && (
                            <div className="text-xs text-[var(--glass-text-tertiary)]">{t('loadingModels')}</div>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-[var(--glass-text-secondary)]">{t('analysisModel')}</label>
                                <ModelCapabilityDropdown
                                    models={userModels.llm}
                                    value={analysisModel}
                                    onModelChange={(v) => handleChange(onAnalysisModelChange)(v)}
                                    capabilityFields={analysisCapabilityFields}
                                    placementMode="downward"
                                    capabilityOverrides={selectedAnalysisOverrides}
                                    onCapabilityChange={(field, rawValue, sample) => {
                                        applyCapabilityOverride(analysisModel, field, rawValue, sample)
                                    }}
                                    placeholder={t('pleaseSelect')}
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium text-[var(--glass-text-secondary)]">{t('characterModel')}</label>
                                <ModelCapabilityDropdown
                                    models={userModels.image}
                                    value={characterModel}
                                    onModelChange={(v) => handleModelChange(v, userModels.image, 'image', onCharacterModelChange)}
                                    capabilityFields={characterCapabilityFields}
                                    placementMode="downward"
                                    capabilityOverrides={selectedCharacterOverrides}
                                    onCapabilityChange={(field, rawValue, sample) => {
                                        applyCapabilityOverride(characterModel, field, rawValue, sample)
                                    }}
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium text-[var(--glass-text-secondary)]">{t('locationModel')}</label>
                                <ModelCapabilityDropdown
                                    models={userModels.image}
                                    value={locationModel}
                                    onModelChange={(v) => handleModelChange(v, userModels.image, 'image', onLocationModelChange)}
                                    capabilityFields={locationCapabilityFields}
                                    placementMode="downward"
                                    capabilityOverrides={selectedLocationOverrides}
                                    onCapabilityChange={(field, rawValue, sample) => {
                                        applyCapabilityOverride(locationModel, field, rawValue, sample)
                                    }}
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium text-[var(--glass-text-secondary)]">{t('storyboardModel')}</label>
                                <ModelCapabilityDropdown
                                    models={userModels.image}
                                    value={imageModel}
                                    onModelChange={(v) => handleModelChange(v, userModels.image, 'image', onImageModelChange)}
                                    capabilityFields={storyboardCapabilityFields}
                                    placementMode="downward"
                                    capabilityOverrides={selectedStoryboardOverrides}
                                    onCapabilityChange={(field, rawValue, sample) => {
                                        applyCapabilityOverride(imageModel, field, rawValue, sample)
                                    }}
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium text-[var(--glass-text-secondary)]">{t('editModel')}</label>
                                <ModelCapabilityDropdown
                                    models={userModels.image}
                                    value={editModel}
                                    onModelChange={(v) => handleModelChange(v, userModels.image, 'image', onEditModelChange)}
                                    capabilityFields={editCapabilityFields}
                                    placementMode="downward"
                                    capabilityOverrides={selectedEditOverrides}
                                    onCapabilityChange={(field, rawValue, sample) => {
                                        applyCapabilityOverride(editModel, field, rawValue, sample)
                                    }}
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium text-[var(--glass-text-secondary)]">{t('videoModel')}</label>
                                <ModelCapabilityDropdown
                                    models={normalVideoModels}
                                    value={videoModel}
                                    onModelChange={(v) => handleModelChange(v, normalVideoModels, 'video', onVideoModelChange)}
                                    capabilityFields={videoCapabilityFields}
                                    placementMode="downward"
                                    capabilityOverrides={selectedVideoOverrides}
                                    onCapabilityChange={(field, rawValue, sample) => {
                                        applyCapabilityOverride(videoModel, field, rawValue, sample)
                                    }}
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium text-[var(--glass-text-secondary)]">{t('audioModel')}</label>
                                <ModelCapabilityDropdown
                                    models={userModels.audio}
                                    value={audioModel}
                                    onModelChange={(v) => handleModelChange(v, userModels.audio, 'audio', onAudioModelChange)}
                                    capabilityFields={audioCapabilityFields}
                                    placementMode="downward"
                                    capabilityOverrides={selectedAudioOverrides}
                                    onCapabilityChange={(field, rawValue, sample) => {
                                        applyCapabilityOverride(audioModel, field, rawValue, sample)
                                    }}
                                    placeholder={t('pleaseSelect')}
                                />
                            </div>
                        </div>
                    </div>


                </div>
            </div>
        </ProductModalShell>
    )
}

export { SettingsModal as ConfigEditModal }
export { WorldContextModal } from './WorldContextModal'
