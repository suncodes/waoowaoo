import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { executeAiTextStep } from '@/lib/ai-runtime'
import {
  getUserWorkflowConcurrencyConfig,
  resolveProjectModelCapabilityGenerationOptions,
} from '@/lib/config-service'
import { withInternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import { logAIAnalysis } from '@/lib/logging/semantic'
import { onProjectNameAvailable } from '@/lib/logging/file-writer'
import { buildCharactersIntroduction } from '@/lib/constants'
import { TaskTerminatedError } from '@/lib/task/errors'
import { reportTaskProgress } from '@/lib/workers/shared'
import {
  JsonParseError,
  runScriptToStoryboardOrchestrator,
  type ScriptToStoryboardStepMeta,
  type ScriptToStoryboardStepOutput,
  type ScriptToStoryboardOrchestratorResult,
} from '@/lib/novel-promotion/script-to-storyboard/orchestrator'
import { createWorkerLLMStreamCallbacks, createWorkerLLMStreamContext } from './llm-stream'
import type { TaskJobData } from '@/lib/task/types'
import {
  buildVoiceLineRowsFromClipPanels,
  buildStoryboardJsonFromClipPanels,
  parseEffort,
  parseTemperature,
  parseVoiceLinesJson,
  persistStoryboardOutputs,
  type JsonRecord,
} from './script-to-storyboard-helpers'
import { buildPrompt, getPromptTemplate, PROMPT_IDS } from '@/lib/prompt-i18n'
import { resolveAnalysisModel } from './resolve-analysis-model'
import { createArtifact } from '@/lib/run-runtime/service'
import { assertWorkflowRunActive, withWorkflowRunLease } from '@/lib/run-runtime/workflow-lease'
import { createCreativeQualityHash } from '@/lib/creative-quality/contracts'
import { reviewScriptDraftQuality } from '@/lib/creative-quality/script-review'
import {
  parseStoryboardRetryTarget,
  runScriptToStoryboardAtomicRetry,
} from './script-to-storyboard-atomic-retry'
import { resolveVoiceAnalysisSource } from '@/lib/voice/voice-analysis-source'
import { rebuildEpisodeNarrationTimeline } from '@/lib/novel-promotion/narration-timeline'
import { rebuildEpisodeSpeechPlans } from '@/lib/novel-promotion/speech-plan'

type AnyObj = Record<string, unknown>
const MAX_VOICE_ANALYZE_ATTEMPTS = 2

function buildWorkflowWorkerId(job: Job<TaskJobData>, label: string) {
  return `${label}:${job.queueName}:${job.data.taskId}`
}

function readAssetKind(value: Record<string, unknown>): string {
  return typeof value.assetKind === 'string' ? value.assetKind : 'location'
}

function readNullableText(value: Record<string, unknown>, key: string): string | null {
  const field = value[key]
  return typeof field === 'string' ? field : null
}

function isReasoningEffort(value: unknown): value is 'minimal' | 'low' | 'medium' | 'high' {
  return value === 'minimal' || value === 'low' || value === 'medium' || value === 'high'
}

export async function handleScriptToStoryboardTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const projectId = job.data.projectId
  const episodeIdRaw = typeof payload.episodeId === 'string' ? payload.episodeId : (job.data.episodeId || '')
  const episodeId = episodeIdRaw.trim()
  const inputModel = typeof payload.model === 'string' ? payload.model.trim() : ''
  const retryStepKey = typeof payload.retryStepKey === 'string' ? payload.retryStepKey.trim() : ''
  const retryStepAttempt = typeof payload.retryStepAttempt === 'number' && Number.isFinite(payload.retryStepAttempt)
    ? Math.max(1, Math.floor(payload.retryStepAttempt))
    : 1
  const reasoning = payload.reasoning !== false
  const requestedReasoningEffort = parseEffort(payload.reasoningEffort)
  const temperature = parseTemperature(payload.temperature)

  if (!episodeId) {
    throw new Error('episodeId is required')
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
    },
  })
  if (!project) {
    throw new Error('Project not found')
  }

  // Register project name for per-project log file routing
  onProjectNameAvailable(projectId, project.name)

  const novelData = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    include: {
      characters: true,
      locations: true,
    },
  })
  if (!novelData) {
    throw new Error('Novel promotion data not found')
  }

  const episode = await prisma.novelPromotionEpisode.findUnique({
    where: { id: episodeId },
    include: {
      clips: { orderBy: { createdAt: 'asc' } },
    },
  })
  if (!episode || episode.novelPromotionProjectId !== novelData.id) {
    throw new Error('Episode not found')
  }
  const clips = episode.clips || []
  if (clips.length === 0) {
    throw new Error('No clips found')
  }
  const retryTarget = parseStoryboardRetryTarget(retryStepKey)
  if (retryStepKey && retryStepKey !== 'voice_analyze' && !retryTarget) {
    throw new Error(`unsupported retry step for script_to_storyboard: ${retryStepKey}`)
  }
  const retryClipId = retryTarget?.clipId || null
  const selectedClips = retryClipId
    ? clips.filter((clip) => clip.id === retryClipId)
    : clips
  if (retryClipId && selectedClips.length === 0) {
    throw new Error(`Retry clip not found: ${retryClipId}`)
  }
  const skipVoiceAnalyze = !!retryStepKey && retryStepKey !== 'voice_analyze'

  const model = await resolveAnalysisModel({
    userId: job.data.userId,
    inputModel,
    projectAnalysisModel: novelData.analysisModel,
  })
  const [llmCapabilityOptions, workflowConcurrency] = await Promise.all([
    resolveProjectModelCapabilityGenerationOptions({
      projectId,
      userId: job.data.userId,
      modelType: 'llm',
      modelKey: model,
    }),
    getUserWorkflowConcurrencyConfig(job.data.userId),
  ])
  const capabilityReasoningEffort = llmCapabilityOptions.reasoningEffort
  const reasoningEffort = requestedReasoningEffort
    || (isReasoningEffort(capabilityReasoningEffort) ? capabilityReasoningEffort : 'high')

  const visualDirectionContext = JSON.stringify({
    directorTreatment: episode.directorTreatment || null,
    productionBible: episode.productionBible || null,
  }, null, 2)
  const withVisualDirection = (template: string) => [
    'DIRECTOR_TREATMENT_AND_PRODUCTION_BIBLE:',
    visualDirectionContext,
    'All storyboard decisions must follow this context unless it is null.',
    template,
  ].join('\n\n')
  const phase1PlanTemplate = withVisualDirection(
    getPromptTemplate(PROMPT_IDS.NP_AGENT_STORYBOARD_PLAN, job.data.locale),
  )
  const phase2CinematographyTemplate = withVisualDirection(
    getPromptTemplate(PROMPT_IDS.NP_AGENT_CINEMATOGRAPHER, job.data.locale),
  )
  const phase2ActingTemplate = withVisualDirection(
    getPromptTemplate(PROMPT_IDS.NP_AGENT_ACTING_DIRECTION, job.data.locale),
  )
  const phase3DetailTemplate = withVisualDirection(
    getPromptTemplate(PROMPT_IDS.NP_AGENT_STORYBOARD_DETAIL, job.data.locale),
  )
  const payloadMeta = typeof payload.meta === 'object' && payload.meta !== null
    ? (payload.meta as AnyObj)
    : {}
  const runId = typeof payload.runId === 'string' && payload.runId.trim()
    ? payload.runId.trim()
    : (typeof payloadMeta.runId === 'string' ? payloadMeta.runId.trim() : '')
  if (!runId) {
    throw new Error('runId is required for script_to_storyboard pipeline')
  }
  const workerId = buildWorkflowWorkerId(job, 'script_to_storyboard')
  const assertRunActive = async (stage: string) => {
    await assertWorkflowRunActive({
      runId,
      workerId,
      stage,
    })
  }
  const streamContext = createWorkerLLMStreamContext(job, 'script_to_storyboard')
  const callbacks = createWorkerLLMStreamCallbacks(job, streamContext, {
    assertActive: async (stage) => {
      await assertRunActive(stage)
    },
    isActive: async () => {
      try {
        await assertRunActive('worker_llm_stream_probe')
        return true
      } catch (error) {
        if (error instanceof TaskTerminatedError) {
          return false
        }
        throw error
      }
    },
  })

  const runStep = async (
    meta: ScriptToStoryboardStepMeta,
    prompt: string,
    action: string,
    _maxOutputTokens: number,
  ): Promise<ScriptToStoryboardStepOutput> => {
    void _maxOutputTokens
    const stepAttempt = meta.stepAttempt
      || (retryStepKey && meta.stepId === retryStepKey ? retryStepAttempt : 1)
    await assertRunActive(`script_to_storyboard_step:${meta.stepId}`)
    const progress = 15 + Math.min(70, Math.floor((meta.stepIndex / Math.max(1, meta.stepTotal)) * 70))
    await reportTaskProgress(job, progress, {
      stage: 'script_to_storyboard_step',
      stageLabel: 'progress.stage.scriptToStoryboardStep',
      displayMode: 'detail',
      message: meta.stepTitle,
      stepId: meta.stepId,
      stepAttempt,
      stepTitle: meta.stepTitle,
      stepIndex: meta.stepIndex,
      stepTotal: meta.stepTotal,
      dependsOn: Array.isArray(meta.dependsOn) ? meta.dependsOn : [],
      groupId: meta.groupId || null,
      parallelKey: meta.parallelKey || null,
      retryable: meta.retryable !== false,
      blockedBy: Array.isArray(meta.blockedBy) ? meta.blockedBy : [],
    })

    logAIAnalysis(job.data.userId, 'worker', projectId, project.name, {
      action: `SCRIPT_TO_STORYBOARD_PROMPT:${action}`,
      input: { stepId: meta.stepId, stepTitle: meta.stepTitle, prompt },
      model,
    })

    const output = await executeAiTextStep({
      userId: job.data.userId,
      model,
      messages: [{ role: 'user', content: prompt }],
      projectId,
      action,
      meta: {
        ...meta,
        stepAttempt,
      },
      temperature,
      reasoning,
      reasoningEffort,
    })
    await callbacks.flush()

    logAIAnalysis(job.data.userId, 'worker', projectId, project.name, {
      action: `SCRIPT_TO_STORYBOARD_OUTPUT:${action}`,
      output: {
        stepId: meta.stepId,
        stepTitle: meta.stepTitle,
        rawText: output.text,
        textLength: output.text.length,
        reasoningLength: output.reasoning.length,
      },
      model,
    })

    return {
      text: output.text,
      reasoning: output.reasoning,
    }
  }

  const leaseResult = await withWorkflowRunLease({
    runId,
    userId: job.data.userId,
    workerId,
    run: async () => {
      await reportTaskProgress(job, 10, {
        stage: 'script_to_storyboard_prepare',
        stageLabel: 'progress.stage.scriptToStoryboardPrepare',
        displayMode: 'detail',
      })

      const orchestratorResult: ScriptToStoryboardOrchestratorResult = await (async () => {
        try {
          return await withInternalLLMStreamCallbacks(
            callbacks,
            async () => {
              if (retryTarget) {
                const clipIndex = clips.findIndex((clip) => clip.id === retryTarget.clipId)
                if (clipIndex < 0) {
                  throw new Error(`Retry clip not found: ${retryTarget.clipId}`)
                }
                const clip = clips[clipIndex]
                const atomicResult = await runScriptToStoryboardAtomicRetry({
                  runId,
                  retryTarget,
                  retryStepAttempt,
                  locale: job.data.locale,
                  clip: {
                    id: clip.id,
                    content: clip.content,
                    characters: clip.characters,
                    location: clip.location,
                    props: readNullableText(clip as unknown as Record<string, unknown>, 'props'),
                    screenplay: clip.screenplay,
                  },
                  clipIndex,
                  totalClipCount: clips.length,
                  novelPromotionData: {
                    characters: novelData.characters || [],
                    locations: (novelData.locations || []).filter((item) => readAssetKind(item as unknown as Record<string, unknown>) !== 'prop'),
                    props: (novelData.locations || [])
                      .filter((item) => readAssetKind(item as unknown as Record<string, unknown>) === 'prop')
                      .map((item) => ({ name: item.name, summary: item.summary })),
                  },
                  promptTemplates: {
                    phase1PlanTemplate,
                    phase2CinematographyTemplate,
                    phase2ActingTemplate,
                    phase3DetailTemplate,
                  },
                  runStep,
                })
                return {
                  clipPanels: atomicResult.clipPanels,
                  phase1PanelsByClipId: atomicResult.phase1PanelsByClipId,
                  phase2CinematographyByClipId: atomicResult.phase2CinematographyByClipId,
                  phase2ActingByClipId: atomicResult.phase2ActingByClipId,
                  phase3PanelsByClipId: atomicResult.phase3PanelsByClipId,
                  summary: {
                    clipCount: selectedClips.length,
                    totalPanelCount: atomicResult.totalPanelCount,
                    totalStepCount: atomicResult.totalStepCount,
                  },
                }
              }

              try {
                return await runScriptToStoryboardOrchestrator({
                  concurrency: workflowConcurrency.analysis,
                  locale: job.data.locale,
                  clips: selectedClips.map((clip) => ({
                    id: clip.id,
                    content: clip.content,
                    characters: clip.characters,
                    location: clip.location,
                    props: readNullableText(clip as unknown as Record<string, unknown>, 'props'),
                    screenplay: clip.screenplay,
                  })),
                  novelPromotionData: {
                    characters: novelData.characters || [],
                    locations: (novelData.locations || []).filter((item) => readAssetKind(item as unknown as Record<string, unknown>) !== 'prop'),
                    props: (novelData.locations || [])
                      .filter((item) => readAssetKind(item as unknown as Record<string, unknown>) === 'prop')
                      .map((item) => ({ name: item.name, summary: item.summary })),
                  },
                  promptTemplates: {
                    phase1PlanTemplate,
                    phase2CinematographyTemplate,
                    phase2ActingTemplate,
                    phase3DetailTemplate,
                  },
                  runStep,
                })
              } catch (error) {
                if (error instanceof JsonParseError) {
                  logAIAnalysis(job.data.userId, 'worker', projectId, project.name, {
                    action: 'SCRIPT_TO_STORYBOARD_PARSE_ERROR',
                    error: {
                      message: error.message,
                      rawTextPreview: error.rawText.slice(0, 3000),
                      rawTextLength: error.rawText.length,
                    },
                    model,
                  })
                }
                throw error
              }
            },
          )
        } finally {
          await callbacks.flush()
        }
      })()

      const phase1Map = orchestratorResult.phase1PanelsByClipId || {}
      const phase2CinematographyMap = orchestratorResult.phase2CinematographyByClipId || {}
      const phase2ActingMap = orchestratorResult.phase2ActingByClipId || {}
      const phase3Map = orchestratorResult.phase3PanelsByClipId || {}

      for (const clip of selectedClips) {
        const phase1Panels = phase1Map[clip.id] || []
        if (phase1Panels.length > 0) {
          await createArtifact({
            runId,
            stepKey: `clip_${clip.id}_phase1`,
            artifactType: 'storyboard.clip.phase1',
            refId: clip.id,
            payload: {
              panels: phase1Panels,
            },
          })
        }
        const phase2Cinematography = phase2CinematographyMap[clip.id] || []
        if (phase2Cinematography.length > 0) {
          await createArtifact({
            runId,
            stepKey: `clip_${clip.id}_phase2_cinematography`,
            artifactType: 'storyboard.clip.phase2.cine',
            refId: clip.id,
            payload: {
              rules: phase2Cinematography,
            },
          })
        }
        const phase2Acting = phase2ActingMap[clip.id] || []
        if (phase2Acting.length > 0) {
          await createArtifact({
            runId,
            stepKey: `clip_${clip.id}_phase2_acting`,
            artifactType: 'storyboard.clip.phase2.acting',
            refId: clip.id,
            payload: {
              directions: phase2Acting,
            },
          })
        }
        const phase3Panels = phase3Map[clip.id] || []
        if (phase3Panels.length > 0) {
          await createArtifact({
            runId,
            stepKey: `clip_${clip.id}_phase3_detail`,
            artifactType: 'storyboard.clip.phase3',
            refId: clip.id,
            payload: {
              panels: phase3Panels,
            },
          })
        }
      }

      await reportTaskProgress(job, 80, {
        stage: 'script_to_storyboard_persist',
        stageLabel: 'progress.stage.scriptToStoryboardPersist',
        displayMode: 'detail',
      })
      await assertRunActive('script_to_storyboard_persist')

      const directVoiceLineRows = buildVoiceLineRowsFromClipPanels(orchestratorResult.clipPanels)

      if (skipVoiceAnalyze) {
        const persisted = await persistStoryboardOutputs({
          episodeId,
          clipPanels: orchestratorResult.clipPanels,
          voiceLineRows: directVoiceLineRows,
          speechSource: directVoiceLineRows === null ? 'retry' : 'storyboard',
        })
        await rebuildEpisodeNarrationTimeline(episodeId)
        await rebuildEpisodeSpeechPlans(episodeId, directVoiceLineRows === null ? 'retry' : 'storyboard')
        await reportTaskProgress(job, 96, {
          stage: 'script_to_storyboard_persist_done',
          stageLabel: 'progress.stage.scriptToStoryboardPersistDone',
          displayMode: 'detail',
          message: 'step retry complete',
          stepId: retryStepKey || undefined,
          stepAttempt:
            typeof payload.retryStepAttempt === 'number' && Number.isFinite(payload.retryStepAttempt)
              ? Math.max(1, Math.floor(payload.retryStepAttempt))
              : undefined,
        })
        return {
          episodeId,
          storyboardCount: persisted.persistedStoryboards.length,
          panelCount: orchestratorResult.summary.totalPanelCount,
          voiceLineCount: persisted.voiceLineCount,
          retryStepKey,
        }
      }

      let voiceLineRows: JsonRecord[] | null = directVoiceLineRows
      let voiceLineSource = 'storyboard'
      if (voiceLineRows === null) {
        voiceLineSource = 'voice_analyze_fallback'
        const voiceSource = resolveVoiceAnalysisSource({
          contentPlan: episode.contentPlan,
          clips,
          novelText: episode.novelText,
        })

        const voicePrompt = buildPrompt({
          promptId: PROMPT_IDS.NP_VOICE_ANALYSIS,
          locale: job.data.locale,
          variables: {
            input: voiceSource.text,
            characters_lib_name: (novelData.characters || []).length > 0
              ? (novelData.characters || []).map((item) => item.name).join('、')
              : '无',
            characters_introduction: buildCharactersIntroduction(novelData.characters || []),
            storyboard_json: buildStoryboardJsonFromClipPanels(orchestratorResult.clipPanels),
          },
        })

        let voiceLastError: Error | null = null
        const voiceStepMeta: ScriptToStoryboardStepMeta = {
          stepId: 'voice_analyze',
          stepTitle: 'progress.streamStep.voiceAnalyze',
          stepIndex: orchestratorResult.summary.totalStepCount,
          stepTotal: orchestratorResult.summary.totalStepCount,
          retryable: true,
        }
        try {
          for (let voiceAttempt = 1; voiceAttempt <= MAX_VOICE_ANALYZE_ATTEMPTS; voiceAttempt++) {
            const meta: ScriptToStoryboardStepMeta = {
              ...voiceStepMeta,
              stepAttempt: voiceAttempt,
            }
            try {
              const voiceOutput = await withInternalLLMStreamCallbacks(
                callbacks,
                async () => await runStep(meta, voicePrompt, 'voice_analyze', 2600),
              )
              voiceLineRows = parseVoiceLinesJson(voiceOutput.text)
              break
            } catch (error) {
              if (error instanceof TaskTerminatedError) {
                throw error
              }
              voiceLastError = error instanceof Error ? error : new Error(String(error))
              if (voiceAttempt < MAX_VOICE_ANALYZE_ATTEMPTS) {
                await reportTaskProgress(job, 84, {
                  stage: 'script_to_storyboard_step',
                  stageLabel: 'progress.stage.scriptToStoryboardStep',
                  displayMode: 'detail',
                  message: `台词分析失败，准备重试 (${voiceAttempt + 1}/${MAX_VOICE_ANALYZE_ATTEMPTS})`,
                  stepId: voiceStepMeta.stepId,
                  stepAttempt: voiceAttempt + 1,
                  stepTitle: voiceStepMeta.stepTitle,
                  stepIndex: voiceStepMeta.stepIndex,
                  stepTotal: voiceStepMeta.stepTotal,
                })
              }
            }
          }
        } finally {
          await callbacks.flush()
        }
        if (voiceLineRows === null) {
          throw voiceLastError!
        }
      } else {
        await reportTaskProgress(job, 84, {
          stage: 'voice_analyze_prepare',
          stageLabel: 'progress.stage.voiceAnalyze',
          displayMode: 'detail',
          message: '已使用分镜规划中的镜头台词，不再重新匹配镜头。',
        })
      }

      await createArtifact({
        runId,
        stepKey: 'voice_analyze',
        artifactType: 'voice.lines',
        refId: episodeId,
        payload: {
          lines: voiceLineRows,
          source: voiceLineSource,
        },
      })

      await assertRunActive('script_to_storyboard_voice_persist')
      const persisted = await persistStoryboardOutputs({
        episodeId,
        clipPanels: orchestratorResult.clipPanels,
        voiceLineRows,
        speechSource: voiceLineSource,
      })
      await rebuildEpisodeNarrationTimeline(episodeId)
      await rebuildEpisodeSpeechPlans(episodeId, voiceLineSource)
      const persistedVoiceLines = Array.isArray(persisted.voiceLines) ? persisted.voiceLines : []
      const scriptReview = reviewScriptDraftQuality({
        episodeId,
        clips: clips.map((clip) => ({
          id: clip.id,
          episodeId,
          content: clip.content,
          summary: clip.summary,
          screenplay: clip.screenplay,
        })),
        voiceLines: persistedVoiceLines.map((line) => ({
          id: line.id,
          episodeId: line.episodeId,
          lineIndex: line.lineIndex,
          speaker: line.speaker,
          content: line.content,
          matchedPanelId: line.matchedPanelId,
        })),
      })
      await createArtifact({
        runId,
        stepKey: 'script_quality_review',
        artifactType: 'script.quality.review',
        refId: episodeId,
        versionHash: createCreativeQualityHash(scriptReview),
        payload: {
          review: scriptReview,
        },
      })

      await reportTaskProgress(job, 96, {
        stage: 'script_to_storyboard_persist_done',
        stageLabel: 'progress.stage.scriptToStoryboardPersistDone',
        displayMode: 'detail',
      })

      return {
        episodeId,
        storyboardCount: persisted.persistedStoryboards.length,
        panelCount: orchestratorResult.summary.totalPanelCount,
        voiceLineCount: persisted.voiceLineCount,
      }
    },
  })

  if (!leaseResult.claimed || !leaseResult.result) {
    return {
      runId,
      skipped: true,
      episodeId,
    }
  }

  return leaseResult.result
}
