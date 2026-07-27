import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveOutboundAudioReferences, summarizeOutboundAudioReferences } from './outbound-audio'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import { getObjectBuffer } from '@/lib/storage'

vi.mock('@/lib/storage', () => ({
  extractStorageKey: vi.fn((input: string | null | undefined) => {
    if (!input) return null
    if (input.startsWith('/api/files/')) return decodeURIComponent(input.replace('/api/files/', ''))
    if (!input.startsWith('http') && !input.startsWith('/')) return input
    return null
  }),
  getObjectBuffer: vi.fn(),
  toFetchableUrl: vi.fn((value: string) => (
    value.startsWith('/') ? `http://localhost:3000${value}` : value
  )),
}))

vi.mock('@/lib/media/service', () => ({
  resolveStorageKeyFromMediaValue: vi.fn(),
}))

function makeWavBuffer(durationMs = 2000): Buffer {
  const sampleRate = 8000
  const channels = 1
  const bitsPerSample = 16
  const byteRate = sampleRate * channels * bitsPerSample / 8
  const blockAlign = channels * bitsPerSample / 8
  const dataSize = Math.round(byteRate * durationMs / 1000)
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(channels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(byteRate, 28)
  buffer.writeUInt16LE(blockAlign, 32)
  buffer.writeUInt16LE(bitsPerSample, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataSize, 40)
  return buffer
}

describe('outbound audio references', () => {
  const resolveStorageKeyMock = vi.mocked(resolveStorageKeyFromMediaValue)
  const getObjectBufferMock = vi.mocked(getObjectBuffer)

  beforeEach(() => {
    vi.clearAllMocks()
    resolveStorageKeyMock.mockImplementation(async (value: unknown) => {
      if (value === '/m/voice-public-id') return 'voice/custom/ref.wav'
      return null
    })
    getObjectBufferMock.mockResolvedValue(makeWavBuffer())
  })

  it('loads private storage audio and returns data url plus safe summary', async () => {
    const result = await resolveOutboundAudioReferences([{
      url: 'voice/custom/project/character.wav',
      speaker: '旁白',
      source: 'speaker',
      provider: 'fal',
      voiceType: 'narration',
    }])

    expect(result.issues).toEqual([])
    expect(result.references).toHaveLength(1)
    expect(result.references[0]).toMatchObject({
      speaker: '旁白',
      source: 'speaker',
      provider: 'fal',
      voiceType: 'narration',
      mimeType: 'audio/wav',
      byteSize: makeWavBuffer().length,
      durationMs: 2000,
      sourceKind: 'storage',
    })
    expect(result.references[0].url).toMatch(/^data:audio\/wav;base64,/)
    expect(summarizeOutboundAudioReferences(result.references)[0]).not.toHaveProperty('url')
    expect(getObjectBufferMock).toHaveBeenCalledWith('voice/custom/project/character.wav')
  })

  it('resolves media route to storage key before reading audio', async () => {
    const result = await resolveOutboundAudioReferences([{ url: '/m/voice-public-id', speaker: '尼摩' }])

    expect(result.references).toHaveLength(1)
    expect(resolveStorageKeyMock).toHaveBeenCalledWith('/m/voice-public-id')
    expect(getObjectBufferMock).toHaveBeenCalledWith('voice/custom/ref.wav')
  })

  it('skips unsupported formats without throwing', async () => {
    getObjectBufferMock.mockResolvedValue(Buffer.from([0x4f, 0x67, 0x67, 0x53]))

    const result = await resolveOutboundAudioReferences([{ url: 'voice/custom/ref.ogg', speaker: '旁白' }])

    expect(result.references).toEqual([])
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]).toMatchObject({
      code: 'OUTBOUND_AUDIO_FORMAT_UNSUPPORTED',
    })
  })
})
