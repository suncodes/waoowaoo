'use client'

import { useState, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import VoicePickerDialog from '@/app/[locale]/workspace/asset-hub/components/VoicePickerDialog'
import VoiceCreationModal from '@/app/[locale]/workspace/asset-hub/components/VoiceCreationModal'
import { AppIcon } from '@/components/ui/icons'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import ProductModalShell from '@/components/product/ProductModalShell'
import type { InlineSpeakerVoiceBinding } from '@/lib/novel-promotion/stages/voice-stage-runtime/types'

type BindingTab = 'select' | 'upload' | 'design'

interface SpeakerVoiceBindingDialogProps {
    isOpen: boolean
    speaker: string
    projectId: string
    episodeId: string
    onClose: () => void
    onBound: (speaker: string, binding: InlineSpeakerVoiceBinding) => void
}

/**
 * 内联音色绑定弹窗
 * 用于不在资产库中的角色/发言人在配音阶段直接绑定音色
 * 提供三种绑定方式：从音色库选择、上传音频、AI设计音色（Tab 切换）
 */
export default function SpeakerVoiceBindingDialog({
    isOpen,
    speaker,
    onClose,
    onBound,
}: SpeakerVoiceBindingDialogProps) {
    const t = useTranslations('voice.inlineBinding')
    const [activeTab, setActiveTab] = useState<BindingTab>('select')
    // 子弹窗打开标记
    const [subDialogOpen, setSubDialogOpen] = useState(false)

    const handleClose = useCallback(() => {
        setActiveTab('select')
        setSubDialogOpen(false)
        onClose()
    }, [onClose])

    const confirmUploadVoice = useCallback(() => {
        return window.confirm(t('uploadQwenHint'))
    }, [t])

    // 从音色库选择后的回调
    const handleVoiceSelected = useCallback((voice: {
        id: string
        customVoiceUrl: string | null
        voiceId: string | null
        voiceType: string
    }) => {
        if (voice.voiceId) {
            onBound(speaker, {
                provider: 'bailian',
                voiceType: voice.voiceType,
                voiceId: voice.voiceId,
                ...(voice.customVoiceUrl ? { previewAudioUrl: voice.customVoiceUrl } : {}),
            })
        } else if (voice.customVoiceUrl) {
            onBound(speaker, {
                provider: 'fal',
                voiceType: voice.voiceType,
                audioUrl: voice.customVoiceUrl,
            })
            alert(t('uploadQwenHint'))
        }
        setSubDialogOpen(false)
        onClose()
    }, [speaker, onBound, onClose, t])

    // AI 设计音色或上传音频后的回调
    const handleCreationSuccess = useCallback(() => {
        // 创建成功后切换到选择模式，让用户从音色库选取刚创建的音色
        setActiveTab('select')
        setSubDialogOpen(true)
    }, [])

    const handleTabClick = useCallback((tab: BindingTab) => {
        if (tab === 'upload' && !confirmUploadVoice()) {
            return
        }
        setActiveTab(tab)
        setSubDialogOpen(true)
    }, [confirmUploadVoice])

    if (!isOpen) return null

    // 音色库选择 — 直接渲染 VoicePickerDialog
    if (activeTab === 'select' && subDialogOpen) {
        return (
            <VoicePickerDialog
                isOpen
                onClose={handleClose}
                onSelect={handleVoiceSelected}
            />
        )
    }

    // 上传/AI设计 — 渲染 VoiceCreationModal
    if ((activeTab === 'upload' || activeTab === 'design') && subDialogOpen) {
        return (
            <VoiceCreationModal
                isOpen
                folderId={null}
                initialVoiceName={speaker}
                onClose={handleClose}
                onSuccess={handleCreationSuccess}
            />
        )
    }

    // 主弹窗：Tab 切换
    return (
        <ProductModalShell open onClose={handleClose} size="md" eyebrow="音色绑定" title={t('title', { speaker })} description={t('description')}>
                <div className="py-1">
                    <SegmentedControl
                        options={[
                            { value: 'select' as const, label: t('selectFromLibrary') },
                            { value: 'upload' as const, label: t('uploadAudio') },
                            { value: 'design' as const, label: t('aiDesign') },
                        ]}
                        value={activeTab}
                        onChange={(val) => handleTabClick(val as BindingTab)}
                    />
                </div>

                {/* Tab 内容区 — 显示描述和进入按钮 */}
                <div className="pt-5">
                    <div className="rounded-md border border-white/10 bg-white/[0.03] px-5 py-8 text-center">
                        <div className={`mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-md ${activeTab === 'select' ? 'bg-cyan-400/10'
                            : activeTab === 'upload' ? 'bg-emerald-400/10'
                                : 'bg-amber-400/10'
                            }`}>
                            <AppIcon
                                name={activeTab === 'select' ? 'mic' : activeTab === 'upload' ? 'cloudUpload' : 'idea'}
                                className={`h-6 w-6 ${activeTab === 'select' ? 'text-cyan-100'
                                    : activeTab === 'upload' ? 'text-emerald-200'
                                        : 'text-amber-200'
                                    }`}
                            />
                        </div>
                        <p className="mb-4 text-sm text-stone-400">
                            {activeTab === 'select' && t('selectFromLibraryDesc')}
                            {activeTab === 'upload' && t('uploadAudioDesc')}
                            {activeTab === 'design' && t('aiDesignDesc')}
                        </p>
                        <button
                            onClick={() => {
                                if (activeTab === 'upload' && !confirmUploadVoice()) return
                                setSubDialogOpen(true)
                            }}
                            className="inline-flex h-10 items-center rounded-md bg-[#f3e9cf] px-6 text-sm font-semibold text-[#161512] hover:bg-[#fff5d9]"
                        >
                            {activeTab === 'select' && t('selectFromLibrary')}
                            {activeTab === 'upload' && t('uploadAudio')}
                            {activeTab === 'design' && t('aiDesign')}
                        </button>
                    </div>
                </div>
        </ProductModalShell>
    )
}
