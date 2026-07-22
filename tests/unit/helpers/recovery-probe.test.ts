import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  recoveryProbeTestUtils,
  startRecoveryProbe,
} from '@/lib/query/hooks/run-stream/recovery-probe'

describe('recovery probe', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    recoveryProbeTestUtils.clearSuccessfulProbeScopes()
  })

  it('retries active run recovery when the first probe misses and a later probe finds a run', async () => {
    vi.useFakeTimers()

    const resolveActiveRunId = vi
      .fn<({ projectId, storageScopeKey }: { projectId: string; storageScopeKey?: string }) => Promise<string | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('run-2')
    const onRecovered = vi.fn()

    const cleanup = startRecoveryProbe({
      projectId: 'project-1',
      storageKey: 'scope:story-to-script:episode-1',
      storageScopeKey: 'episode-1',
      hasRunState: () => false,
      resolveActiveRunId,
      onRecovered,
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(resolveActiveRunId).toHaveBeenCalledTimes(1)
    expect(resolveActiveRunId).toHaveBeenLastCalledWith({
      projectId: 'project-1',
      storageScopeKey: 'episode-1',
    })
    expect(onRecovered).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(
      recoveryProbeTestUtils.PROBE_RETRY_INTERVAL_MS,
    )

    expect(resolveActiveRunId).toHaveBeenCalledTimes(2)
    expect(onRecovered).toHaveBeenCalledTimes(1)
    expect(onRecovered).toHaveBeenCalledWith('run-2')

    cleanup()
  })

  it('backs off repeated empty recovery probes instead of polling every two seconds forever', async () => {
    vi.useFakeTimers()

    const resolveActiveRunId = vi.fn().mockResolvedValue(null)
    const cleanup = startRecoveryProbe({
      projectId: 'project-1',
      storageKey: 'scope:content-plan:episode-1',
      storageScopeKey: 'episode-1',
      hasRunState: () => false,
      resolveActiveRunId,
      onRecovered: vi.fn(),
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(resolveActiveRunId).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(recoveryProbeTestUtils.PROBE_RETRY_DELAYS_MS[0])
    expect(resolveActiveRunId).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(recoveryProbeTestUtils.PROBE_RETRY_DELAYS_MS[1] - 1)
    expect(resolveActiveRunId).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(1)
    expect(resolveActiveRunId).toHaveBeenCalledTimes(3)

    cleanup()
  })

  it('pauses recovery probes while the page is hidden and resumes when visible', async () => {
    vi.useFakeTimers()

    let visibilityState: DocumentVisibilityState = 'hidden'
    const listeners: { visibilitychange?: () => void } = {}
    vi.stubGlobal('document', {
      get visibilityState() {
        return visibilityState
      },
      addEventListener: vi.fn((event: string, listener: () => void) => {
        if (event === 'visibilitychange') listeners.visibilitychange = listener
      }),
      removeEventListener: vi.fn(),
    })

    const resolveActiveRunId = vi.fn().mockResolvedValue(null)
    const cleanup = startRecoveryProbe({
      projectId: 'project-1',
      storageKey: 'scope:visual-plan:episode-1',
      storageScopeKey: 'episode-1',
      hasRunState: () => false,
      resolveActiveRunId,
      onRecovered: vi.fn(),
    })

    await vi.advanceTimersByTimeAsync(60_000)
    expect(resolveActiveRunId).not.toHaveBeenCalled()

    visibilityState = 'visible'
    listeners.visibilitychange?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(resolveActiveRunId).toHaveBeenCalledTimes(1)

    cleanup()
  })
})
