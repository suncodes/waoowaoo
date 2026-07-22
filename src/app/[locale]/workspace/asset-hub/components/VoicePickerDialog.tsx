'use client'
import { logError as _ulogError } from '@/lib/logging/core'

import { useState, useRef, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useGlobalVoices } from '@/lib/query/hooks'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import { resolveTaskPresentationState } from '@/lib/task/presentation'
import { AppIcon } from '@/components/ui/icons'
import ProductModalShell from '@/components/product/ProductModalShell'

interface Voice {
    id: string
    name: string
    description: string | null
    voiceId: string | null
    voiceType: string
    customVoiceUrl: string | null
    voicePrompt: string | null
    gender: string | null
    language: string
    folderId: string | null
}

interface VoicePickerDialogProps {
    isOpen: boolean
    onClose: () => void
    onSelect: (voice: Voice) => void
}

export default function VoicePickerDialog({ isOpen, onClose, onSelect }: VoicePickerDialogProps) {
    const t = useTranslations('assetHub')
    const tv = useTranslations('voice.voiceDesign')
    const voicesQuery = useGlobalVoices()
    const [selectedVoice, setSelectedVoice] = useState<Voice | null>(null)
    const [playingId, setPlayingId] = useState<string | null>(null)
    const audioRef = useRef<HTMLAudioElement | null>(null)
    const voices = (voicesQuery.data || []) as Voice[]
    const loading = isOpen ? voicesQuery.isFetching : false
    const loadingState = loading
        ? resolveTaskPresentationState({
            phase: 'processing',
            intent: 'process',
            resource: 'audio',
            hasOutput: false,
        })
        : null

    const refetchVoices = voicesQuery.refetch

    useEffect(() => {
        if (!isOpen) return
        refetchVoices().catch((error) => {
            _ulogError('加载音色失败:', error)
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen])

    // 播放预览
    const handlePlay = (voice: Voice) => {
        if (!voice.customVoiceUrl) return

        if (playingId === voice.id && audioRef.current) {
            audioRef.current.pause()
            setPlayingId(null)
            return
        }

        if (audioRef.current) {
            audioRef.current.pause()
        }

        const audio = new Audio(voice.customVoiceUrl)
        audioRef.current = audio
        audio.onended = () => setPlayingId(null)
        audio.onerror = () => setPlayingId(null)
        audio.play()
        setPlayingId(voice.id)
    }

    // 确认选择
    const handleConfirm = () => {
        if (selectedVoice) {
            onSelect(selectedVoice)
            onClose()
        }
    }

    // 关闭时清理
    const handleClose = () => {
        if (audioRef.current) {
            audioRef.current.pause()
        }
        setSelectedVoice(null)
        setPlayingId(null)
        onClose()
    }

    if (!isOpen) return null
    return (
        <ProductModalShell
            open
            onClose={handleClose}
            size="lg"
            eyebrow="个人资产库"
            title={t('voicePickerTitle')}
            description="选择一个已保存音色并试听确认。"
            footer={(
                <div className="flex justify-end gap-2">
                    <button type="button" onClick={handleClose} className="h-9 rounded-md border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-stone-200 hover:bg-white/[0.08]">{t('cancel')}</button>
                    <button type="button" onClick={handleConfirm} disabled={!selectedVoice} className="h-9 rounded-md bg-[#f3e9cf] px-4 text-xs font-semibold text-[#161512] hover:bg-[#fff5d9] disabled:cursor-not-allowed disabled:opacity-50">{t('voicePickerConfirm')}</button>
                </div>
            )}
        >
                <div>
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <TaskStatusInline state={loadingState} />
                        </div>
                    ) : voices.length === 0 ? (
                        <div className="py-12 text-center text-stone-500">
                            <AppIcon name="mic" className="mx-auto mb-4 h-16 w-16 text-stone-600" />
                            <p>{t('voicePickerEmpty')}</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                            {voices.map(voice => {
                                const isSelected = selectedVoice?.id === voice.id
                                const isPlaying = playingId === voice.id
                                const genderIcon = voice.gender === 'male' ? 'M' : voice.gender === 'female' ? 'F' : ''

                                return (
                                    <div
                                        role="button"
                                        tabIndex={0}
                                        key={voice.id}
                                        onClick={() => setSelectedVoice(voice)}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter' || event.key === ' ') setSelectedVoice(voice)
                                        }}
                                        className={`relative cursor-pointer rounded-md border-2 p-4 text-left transition-colors ${isSelected
                                            ? 'border-[#e8d18a] bg-[#e8d18a]/10'
                                            : 'border-white/10 bg-white/[0.03] hover:border-white/30'
                                            }`}
                                    >
                                        {/* 选中标记 */}
                                        {isSelected && (
                                            <div className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#e8d18a] text-[#161512]">
                                                <AppIcon name="checkSolid" className="h-3 w-3" />
                                            </div>
                                        )}

                                        {/* 音色信息 */}
                                        <div className="flex items-center gap-3">
                                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-cyan-400/10">
                                                <AppIcon name="mic" className="h-5 w-5 text-cyan-100" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-1">
                                                    <span className="truncate text-sm font-semibold text-stone-100">{voice.name}</span>
                                                    {genderIcon && <span className="rounded bg-white/[0.06] px-1.5 py-0 text-[10px] text-stone-400">{genderIcon}</span>}
                                                </div>
                                                {voice.description && (
                                                    <p className="truncate text-xs text-stone-500">{voice.description}</p>
                                                )}
                                            </div>
                                        </div>

                                        {/* 试听按钮 */}
                                        {voice.customVoiceUrl && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handlePlay(voice) }}
                                                className={`mt-2 flex w-full items-center justify-center gap-1 rounded-md border py-1.5 text-xs font-semibold transition-colors ${isPlaying
                                                    ? 'border-cyan-400/30 bg-cyan-400/10 text-cyan-100'
                                                    : 'border-white/10 bg-white/[0.04] text-stone-300 hover:bg-white/[0.08]'
                                                    }`}
                                            >
                                                {isPlaying ? (
                                                    <>
                                                        <AppIcon name="pause" className="w-3 h-3" />
                                                        {tv('playing')}
                                                    </>
                                                ) : (
                                                    <>
                                                        <AppIcon name="play" className="w-3 h-3" />
                                                        {tv('preview')}
                                                    </>
                                                )}
                                            </button>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
        </ProductModalShell>
    )
}
