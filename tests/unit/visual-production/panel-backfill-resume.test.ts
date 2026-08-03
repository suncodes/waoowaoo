import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  novelPromotionPanel: {
    findMany: vi.fn(),
  },
}))

const readinessMock = vi.hoisted(() => ({
  readBackfillRequests: vi.fn(),
  resolvePanelBackfillReadiness: vi.fn(),
}))

const promptPreparationMock = vi.hoisted(() => ({
  preparePanelGenerationPrompt: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/visual-production/panel-backfill-readiness', () => readinessMock)
vi.mock('@/lib/novel-promotion/panel-prompt-preparation', () => promptPreparationMock)

import { prepareReadyBackfilledPanelPrompts } from '@/lib/visual-production/panel-backfill-resume'

describe('backfilled panel prompt preparation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionPanel.findMany.mockResolvedValue([{
      id: 'panel-1',
      referencePlan: { backfill: { requests: [{ assetId: 'asset-1' }] } },
    }])
    readinessMock.readBackfillRequests.mockReturnValue([{ assetId: 'asset-1' }])
    readinessMock.resolvePanelBackfillReadiness.mockResolvedValue({ ready: true })
    promptPreparationMock.preparePanelGenerationPrompt.mockResolvedValue({
      prepared: { artifactId: 'prepared-panel-prompt-1' },
    })
  })

  it('fixes the panel prompt after all backfilled assets are ready', async () => {
    const result = await prepareReadyBackfilledPanelPrompts({
      projectId: 'project-1',
      userId: 'user-1',
      locale: 'zh',
      assetIds: ['asset-1'],
      storyboardModel: 'storyboard-model',
    })

    expect(promptPreparationMock.preparePanelGenerationPrompt).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      locale: 'zh',
      mode: 'image',
      locator: { panelId: 'panel-1' },
    })
    expect(result).toEqual({
      prepared: [{ panelId: 'panel-1', artifactId: 'prepared-panel-prompt-1' }],
      failed: [],
    })
  })

  it('waits when another backfilled asset is not ready', async () => {
    readinessMock.resolvePanelBackfillReadiness.mockResolvedValue({ ready: false })

    const result = await prepareReadyBackfilledPanelPrompts({
      projectId: 'project-1',
      userId: 'user-1',
      locale: 'zh',
      assetIds: ['asset-1'],
      storyboardModel: 'storyboard-model',
    })

    expect(promptPreparationMock.preparePanelGenerationPrompt).not.toHaveBeenCalled()
    expect(result).toEqual({ prepared: [], failed: [] })
  })
})
