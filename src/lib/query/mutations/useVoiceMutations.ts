import { useMutation } from '@tanstack/react-query'
import { resolveTaskResponse } from '@/lib/task/client'
import type { SpeakerVoiceEntry, SpeakerVoicePatch } from '@/lib/voice/provider-voice-binding'
import {
    requestBlobWithError,
    requestJsonWithError,
    requestTaskResponseWithError,
    requestVoidWithError,
} from './mutation-shared'

type ProjectVoiceLine = {
    id: string
    lineIndex: number
    speaker: string
    content: string
    deliveryContent?: string | null
    deliveryDurationMs?: number | null
    deliveryReason?: string | null
    deliveryUpdatedAt?: string | null
    emotionPrompt: string | null
    emotionStrength: number | null
    audioUrl: string | null
    updatedAt: string | null
    lineTaskRunning: boolean
    matchedPanelId?: string | null
    matchedStoryboardId?: string | null
    matchedPanelIndex?: number | null
    panelSpans?: Array<{
        panelId: string
        startMs?: number | null
        endMs?: number | null
        voiceStartMs?: number | null
        voiceEndMs?: number | null
        segmentText?: string | null
        panel?: {
            storyboardId?: string | null
            panelIndex?: number | null
        } | null
    }>
}

type GenerateProjectVoiceResponse = {
    success?: boolean
    async?: boolean
    taskId?: string
    taskIds?: string[]
    total?: number
    error?: string
    results?: Array<{ lineId?: string; taskId?: string; audioUrl?: string }>
}

export type ProjectSpeechPlanSummary = {
    total: number
    ready: number
    invalid: number
    withSpeech: number
    silent: number
    missingVoiceSpeakers: string[]
    warningCount: number
}

export type ProjectDeliveryLinesResponse = {
    episodeId: string
    available: true
    updatedCount: number
    skippedCount: number
    totalLines: number
}

export function useDesignProjectVoice(projectId: string) {
    return useMutation({
        mutationFn: async (payload: {
            voicePrompt: string
            previewText: string
            preferredName: string
            language: 'zh'
        }) => {
            const response = await requestTaskResponseWithError(
                `/api/novel-promotion/${projectId}/voice-design`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                },
                'Failed to design voice',
            )
            return await resolveTaskResponse<{
                success?: boolean
                voiceId?: string
                targetModel?: string
                audioBase64?: string
                requestId?: string
            }>(response)
        },
    })
}

/**
 * 分析镜头变体（项目）
 */

export function useFetchProjectVoiceStageData(projectId: string) {
    return useMutation({
        mutationFn: async ({ episodeId }: { episodeId: string }): Promise<{
            voiceLines: ProjectVoiceLine[]
            speakerVoices: Record<string, SpeakerVoiceEntry>
            speakers: string[]
        }> => {
            const [linesData, voicesData, speakersData] = await Promise.all([
                requestJsonWithError<{ voiceLines?: ProjectVoiceLine[] }>(
                    `/api/novel-promotion/${projectId}/voice-lines?episodeId=${episodeId}`,
                    { method: 'GET' },
                    '获取台词失败',
                ),
                requestJsonWithError<{ speakerVoices?: Record<string, SpeakerVoiceEntry> }>(
                    `/api/novel-promotion/${projectId}/speaker-voice?episodeId=${episodeId}`,
                    { method: 'GET' },
                    '获取角色音色失败',
                ),
                requestJsonWithError<{ speakers?: string[] }>(
                    `/api/novel-promotion/${projectId}/voice-lines?speakersOnly=1`,
                    { method: 'GET' },
                    '获取说话人失败',
                ),
            ])

            return {
                voiceLines: linesData.voiceLines || [],
                speakerVoices: voicesData.speakerVoices || {},
                speakers: speakersData.speakers || [],
            }
        },
    })
}

/**
 * 分析配音台词
 */

export function useAnalyzeProjectVoice(projectId: string) {
    return useMutation({
        mutationFn: async ({ episodeId }: { episodeId: string }) => {
            const response = await requestTaskResponseWithError(
                `/api/novel-promotion/${projectId}/voice-analyze`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ episodeId, async: true }),
                },
                'voice analyze failed',
            )
            return resolveTaskResponse(response)
        },
    })
}

/**
 * 重建镜头级台词与声音计划
 */
export function useRebuildProjectSpeechPlans(projectId: string) {
    return useMutation({
        mutationFn: async ({ episodeId, source = 'manual' }: { episodeId: string; source?: string }) => {
            const result = await requestJsonWithError<{
                available: boolean
                plans?: unknown[]
                summary?: ProjectSpeechPlanSummary
                message?: string
            }>(
                `/api/novel-promotion/${projectId}/speech-plans`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ episodeId, source }),
                },
                'rebuild speech plans failed',
            )
            if (!result.available) {
                throw new Error(result.message || '数据库结构不是最新版本，缺少镜头级台词计划表。请先执行数据库迁移。')
            }
            return result
        },
    })
}

/**
 * 生成口播版台词
 */
export function useGenerateProjectDeliveryLines(projectId: string) {
    return useMutation({
        mutationFn: async ({ episodeId }: { episodeId: string }) =>
            await requestJsonWithError<ProjectDeliveryLinesResponse>(
                `/api/novel-promotion/${projectId}/delivery-lines`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ episodeId }),
                },
                'generate delivery lines failed',
            ),
    })
}

/**
 * 生成单条/批量配音
 */

export function useGenerateProjectVoice(projectId: string) {
    return useMutation({
        mutationFn: async ({
            episodeId,
            lineId,
            all,
        }: {
            episodeId: string
            lineId?: string
            all?: boolean
        }) =>
            await requestJsonWithError<GenerateProjectVoiceResponse>(
                `/api/novel-promotion/${projectId}/voice-generate`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(all ? { episodeId, all: true } : { episodeId, lineId }),
                },
                'voice generate failed',
            ),
    })
}

/**
 * 创建台词
 */

export function useCreateProjectVoiceLine(projectId: string) {
    return useMutation({
        mutationFn: async (payload: {
            episodeId: string
            content: string
            speaker: string
            matchedPanelId?: string | null
        }) =>
            await requestJsonWithError<{ voiceLine: ProjectVoiceLine }>(
                `/api/novel-promotion/${projectId}/voice-lines`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                },
                'add failed',
            ),
    })
}

/**
 * 更新台词字段
 */

export function useUpdateProjectVoiceLine(projectId: string) {
    return useMutation({
        mutationFn: async (payload: Record<string, unknown>) =>
            await requestJsonWithError<{ voiceLine: ProjectVoiceLine }>(
                `/api/novel-promotion/${projectId}/voice-lines`,
                {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                },
                'update failed',
            ),
    })
}

/**
 * 删除台词
 */

export function useDeleteProjectVoiceLine(projectId: string) {
    return useMutation({
        mutationFn: async ({ lineId }: { lineId: string }) => {
            await requestVoidWithError(
                `/api/novel-promotion/${projectId}/voice-lines?lineId=${lineId}`,
                { method: 'DELETE' },
                'delete failed',
            )
            return null
        },
    })
}

/**
 * 下载配音 zip
 */

export function useDownloadProjectVoices(projectId: string) {
    return useMutation({
        mutationFn: async ({ episodeId }: { episodeId: string }) =>
            await requestBlobWithError(
                `/api/novel-promotion/${projectId}/download-voices?episodeId=${episodeId}`,
                { method: 'GET' },
                'download failed',
            ),
    })
}

/**
 * 为发言人直接设置音色（写入 episode.speakerVoices）
 * 用于不在资产库中的角色在配音阶段内联绑定音色
 */
export function useUpdateSpeakerVoice(projectId: string) {
    return useMutation({
        mutationFn: async (payload: {
            episodeId: string
            speaker: string
        } & SpeakerVoicePatch) =>
            await requestJsonWithError<{ success: boolean }>(
                `/api/novel-promotion/${projectId}/speaker-voice`,
                {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                },
                'update speaker voice failed',
            ),
    })
}
