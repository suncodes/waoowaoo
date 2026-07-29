import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../integration/api/helpers/call-route'
import { installAuthMocks, mockAuthenticated, resetAuthMockState } from '../helpers/auth'
import { resetSystemState } from '../helpers/db-reset'
import { prisma } from '../helpers/prisma'
import { seedMinimalDomainState } from './helpers/seed'
import { expectLifecycleEvents, listTaskEventTypes, waitForTaskTerminalState } from './helpers/tasks'
import { startSystemWorkers, stopSystemWorkers, type SystemWorkers } from './helpers/workers'
import { createFixtureEpisode, createFixtureNovelProject, createFixtureProject, createFixtureUser } from '../helpers/fixtures'

type FakeAiResult = {
  text: string
  reasoning?: string
}

type FakePanelSpeech = {
  speaker: string
  content: string
  emotionStrength?: number
}

const textState = vi.hoisted(() => ({
  aiResults: [] as FakeAiResult[],
  orchestratorClipId: 'clip-seed',
  panelSpeech: {
    speaker: 'Narrator',
    content: 'Hello world',
    emotionStrength: 0.8,
  } as FakePanelSpeech | null | undefined,
}))

vi.mock('@/lib/ai-runtime', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai-runtime')>('@/lib/ai-runtime')
  return {
    ...actual,
    executeAiTextStep: vi.fn(async () => {
      const next = textState.aiResults.shift()
      return {
        text: next?.text || '{"ok":true}',
        reasoning: next?.reasoning || '',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        completion: { usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } },
      }
    }),
  }
})

vi.mock('@/lib/novel-promotion/script-to-storyboard/orchestrator', async () => {
  const actual = await vi.importActual<typeof import('@/lib/novel-promotion/script-to-storyboard/orchestrator')>(
    '@/lib/novel-promotion/script-to-storyboard/orchestrator',
  )
  return {
    ...actual,
    runScriptToStoryboardOrchestrator: vi.fn(async () => ({
      clipPanels: [
        {
          clipId: textState.orchestratorClipId,
          clipIndex: 0,
          finalPanels: [
            {
              panel_number: 1,
              shot_type: 'close-up',
              camera_move: 'static',
              description: 'system generated panel',
              video_prompt: 'system video prompt',
              location: 'Office',
              characters: ['Narrator'],
              speech: textState.panelSpeech,
            },
          ],
        },
      ],
      summary: {
        totalPanelCount: 1,
        totalStepCount: 4,
      },
    })),
  }
})

vi.mock('@/lib/llm-observe/internal-stream-context', () => ({
  withInternalLLMStreamCallbacks: vi.fn(async (_callbacks: unknown, fn: () => Promise<unknown>) => await fn()),
}))

vi.mock('@/lib/workers/handlers/llm-stream', () => ({
  createWorkerLLMStreamContext: vi.fn(() => ({ streamRunId: 'run-1', nextSeqByStepLane: {} })),
  createWorkerLLMStreamCallbacks: vi.fn(() => ({
    onStage: vi.fn(),
    onChunk: vi.fn(),
    onComplete: vi.fn(),
    onError: vi.fn(),
    flush: vi.fn(async () => undefined),
  })),
}))

async function seedScriptToStoryboardState() {
  const user = await createFixtureUser()
  const project = await createFixtureProject(user.id)
  const novelProject = await createFixtureNovelProject(project.id)
  const episode = await createFixtureEpisode(novelProject.id)
  const clip = await prisma.novelPromotionClip.create({
    data: {
      episodeId: episode.id,
      summary: 'script clip',
      content: 'clip content',
      screenplay: 'screenplay text',
      location: 'Office',
      characters: JSON.stringify(['Narrator']),
    },
  })
  await prisma.novelPromotionCharacter.create({
    data: {
      novelPromotionProjectId: novelProject.id,
      name: 'Narrator',
    },
  })
  await prisma.novelPromotionLocation.create({
    data: {
      novelPromotionProjectId: novelProject.id,
      name: 'Office',
      summary: 'Office',
    },
  })
  textState.orchestratorClipId = clip.id
  return { user, project, novelProject, episode, clip }
}

describe('system - text workflows', () => {
  let workers: SystemWorkers = {}

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    textState.aiResults = []
    textState.orchestratorClipId = 'clip-seed'
    textState.panelSpeech = {
      speaker: 'Narrator',
      content: 'Hello world',
      emotionStrength: 0.8,
    }
    await resetSystemState()
    installAuthMocks()
  })

  afterEach(async () => {
    await stopSystemWorkers(workers)
    workers = {}
    resetAuthMockState()
  })

  it('script-to-storyboard success -> persists canonical panel speech and clears legacy lines', async () => {
    const seeded = await seedScriptToStoryboardState()
    mockAuthenticated(seeded.user.id)
    await prisma.novelPromotionVoiceLine.create({
      data: {
        episodeId: seeded.episode.id,
        lineIndex: 1,
        speaker: 'Legacy narrator',
        content: 'legacy line',
      },
    })
    workers = await startSystemWorkers(['text'])

    const mod = await import('@/app/api/novel-promotion/[projectId]/script-to-storyboard-stream/route')
    const response = await callRoute(
      mod.POST,
      'POST',
      { locale: 'zh', episodeId: seeded.episode.id },
      { params: { projectId: seeded.project.id } },
    )

    expect(response.status).toBe(200)
    const json = await response.json() as { taskId: string }
    const task = await waitForTaskTerminalState(json.taskId, { timeoutMs: 20_000 })
    expect(task.status).toBe('completed')
    expect(task.type).toBe('script_to_storyboard_run')
    expect(task.result).toEqual(expect.objectContaining({
      episodeId: seeded.episode.id,
      panelCount: 1,
      voiceLineCount: 1,
    }))

    const storyboards = await prisma.novelPromotionStoryboard.findMany({
      where: { episodeId: seeded.episode.id },
      select: { id: true, panelCount: true },
    })
    expect(storyboards.length).toBeGreaterThan(0)

    const persistedPanelSpeeches = await prisma.novelPromotionPanelSpeech.findMany({
      where: { episodeId: seeded.episode.id },
      select: {
        speaker: true,
        originalContent: true,
        panelId: true,
      },
    })
    expect(persistedPanelSpeeches).toEqual([
      {
        speaker: 'Narrator',
        originalContent: 'Hello world',
        panelId: expect.any(String),
      },
    ])
    expect(await prisma.novelPromotionVoiceLine.count({
      where: { episodeId: seeded.episode.id },
    })).toBe(0)

    const eventTypes = await listTaskEventTypes(json.taskId)
    expectLifecycleEvents(eventTypes, 'completed')
  })

  it('script-to-storyboard accepts an explicit silent panel without creating legacy speech', async () => {
    const seeded = await seedScriptToStoryboardState()
    mockAuthenticated(seeded.user.id)
    textState.panelSpeech = null
    workers = await startSystemWorkers(['text'])

    const mod = await import('@/app/api/novel-promotion/[projectId]/script-to-storyboard-stream/route')
    const response = await callRoute(
      mod.POST,
      'POST',
      { locale: 'zh', episodeId: seeded.episode.id },
      { params: { projectId: seeded.project.id } },
    )

    const json = await response.json() as { taskId: string }
    const task = await waitForTaskTerminalState(json.taskId, { timeoutMs: 20_000 })
    expect(task.status).toBe('completed')
    expect(task.result).toEqual(expect.objectContaining({
      voiceLineCount: 0,
    }))

    expect(await prisma.novelPromotionPanelSpeech.count({
      where: { episodeId: seeded.episode.id },
    })).toBe(0)
    expect(await prisma.novelPromotionVoiceLine.count({
      where: { episodeId: seeded.episode.id },
    })).toBe(0)
  })

  it('script-to-storyboard rejects a missing speech contract before persisting panels', async () => {
    const seeded = await seedScriptToStoryboardState()
    mockAuthenticated(seeded.user.id)
    textState.panelSpeech = undefined
    workers = await startSystemWorkers(['text'])

    const mod = await import('@/app/api/novel-promotion/[projectId]/script-to-storyboard-stream/route')
    const response = await callRoute(
      mod.POST,
      'POST',
      { locale: 'zh', episodeId: seeded.episode.id },
      { params: { projectId: seeded.project.id } },
    )

    const json = await response.json() as { taskId: string }
    const task = await waitForTaskTerminalState(json.taskId, { timeoutMs: 20_000 })
    expect(task.status).toBe('failed')
    expect(task.errorMessage || '').toContain('STORYBOARD_SPEECH_CONTRACT_MISSING')
    expect(await prisma.novelPromotionPanel.count({
      where: { storyboard: { episodeId: seeded.episode.id } },
    })).toBe(0)
  })

  it('insert-panel invalid ai payload -> task fails and no dirty panel remains', async () => {
    const seeded = await seedMinimalDomainState()
    mockAuthenticated(seeded.user.id)
    textState.aiResults = [{ text: 'not-json' }]
    workers = await startSystemWorkers(['text'])

    const beforeCount = await prisma.novelPromotionPanel.count({
      where: { storyboardId: seeded.storyboard.id },
    })

    const mod = await import('@/app/api/novel-promotion/[projectId]/insert-panel/route')
    const response = await callRoute(
      mod.POST,
      'POST',
      {
        locale: 'zh',
        storyboardId: seeded.storyboard.id,
        insertAfterPanelId: seeded.panel.id,
      },
      { params: { projectId: seeded.project.id } },
    )

    expect(response.status).toBe(200)
    const json = await response.json() as { taskId: string }
    const task = await waitForTaskTerminalState(json.taskId, { timeoutMs: 20_000 })
    expect(task.status).toBe('failed')

    const afterCount = await prisma.novelPromotionPanel.count({
      where: { storyboardId: seeded.storyboard.id },
    })
    expect(afterCount).toBe(beforeCount)

    const eventTypes = await listTaskEventTypes(json.taskId)
    expectLifecycleEvents(eventTypes, 'failed')
  })
})
