import { describe, expect, it } from 'vitest'
import {
  buildPanelSpeechPlanPayload,
  compileSpeechPlanPromptSection,
  getPanelSpeechReferenceVoiceConfigs,
  isStoryboardSpeechPlanSource,
  panelSpeechPlanHasSpeech,
} from '@/lib/novel-promotion/speech-plan'

const panel = {
  id: 'panel-1',
  duration: 4,
}

function line(input: {
  id: string
  index: number
  speaker: string
  content: string
}) {
  return {
    id: input.id,
    lineIndex: input.index,
    speaker: input.speaker,
    content: input.content,
  }
}

describe('panel speech plan', () => {
  it('treats only direct storyboard output as a storyboard speech contract', () => {
    expect(isStoryboardSpeechPlanSource('storyboard')).toBe(true)
    expect(isStoryboardSpeechPlanSource('storyboard_auto_fix')).toBe(false)
    expect(isStoryboardSpeechPlanSource('voice_analyze')).toBe(false)
  })

  it('marks silent panels ready without requiring voice audio', () => {
    const plan = buildPanelSpeechPlanPayload({
      panel,
      voiceLines: [],
    })

    expect(plan.mode).toBe('none')
    expect(plan.status).toBe('ready')
    expect(panelSpeechPlanHasSpeech({ mode: plan.mode, linesJson: plan.lines })).toBe(false)
  })

  it('builds ready voiceover plan when narrator voice is configured', () => {
    const plan = buildPanelSpeechPlanPayload({
      panel,
      voiceLines: [
        line({
          id: 'line-1',
          index: 1,
          speaker: '旁白',
          content: '他终于看见海面下的巨大阴影。',
        }),
      ],
      speakerVoices: {
        旁白: {
          provider: 'bailian',
          voiceType: 'narration',
          voiceId: 'voice-1',
        },
      },
    })

    expect(plan.mode).toBe('voiceover')
    expect(plan.status).toBe('ready')
    expect(plan.voiceConfig[0]).toMatchObject({
      speaker: '旁白',
      hasVoice: true,
      source: 'speaker',
    })
    expect(panelSpeechPlanHasSpeech({ mode: plan.mode, linesJson: plan.lines })).toBe(true)
  })

  it('blocks a spoken panel when speaker voice is missing', () => {
    const plan = buildPanelSpeechPlanPayload({
      panel,
      voiceLines: [
        line({
          id: 'line-1',
          index: 1,
          speaker: '尼摩',
          content: '这里不是陆地人的法庭。',
        }),
      ],
    })

    expect(plan.mode).toBe('single_speaker')
    expect(plan.status).toBe('invalid')
    expect(plan.warnings.some((warning) => warning.code === 'SPEAKER_VOICE_MISSING')).toBe(true)
  })

  it('allows short sequential dialogue with two speakers', () => {
    const plan = buildPanelSpeechPlanPayload({
      panel,
      voiceLines: [
        line({ id: 'line-1', index: 1, speaker: '阿龙纳斯', content: '那是什么声音？' }),
        line({ id: 'line-2', index: 2, speaker: '康塞尔', content: '像是金属在深海里震动。' }),
      ],
      speakerVoices: {
        阿龙纳斯: { provider: 'bailian', voiceType: 'dialogue', voiceId: 'voice-a' },
        康塞尔: { provider: 'bailian', voiceType: 'dialogue', voiceId: 'voice-b' },
      },
    })

    expect(plan.mode).toBe('sequential_dialogue')
    expect(plan.status).toBe('ready')
  })

  it('merges consecutive lines from the same speaker into one delivery unit', () => {
    const plan = buildPanelSpeechPlanPayload({
      panel,
      voiceLines: [
        line({ id: 'line-1', index: 1, speaker: '旁白', content: '潜艇穿过海沟。' }),
        line({ id: 'line-2', index: 2, speaker: '旁白', content: '阴影随即逼近。' }),
      ],
      speakerVoices: {
        旁白: { provider: 'bailian', voiceType: 'narration', voiceId: 'voice-1' },
      },
    })

    expect(plan.lines).toHaveLength(1)
    expect(plan.lines[0]).toMatchObject({
      voiceLineId: 'line-1',
      voiceLineIds: ['line-1', 'line-2'],
      content: '潜艇穿过海沟。阴影随即逼近。',
    })
    const prompt = compileSpeechPlanPromptSection({
      mode: plan.mode,
      status: plan.status,
      linesJson: plan.lines,
      voiceConfigJson: plan.voiceConfig,
    })
    expect(prompt).toContain('旁白: 潜艇穿过海沟。阴影随即逼近。')
  })

  it('downgrades complex dialogue to voiceover warning instead of hard failing', () => {
    const plan = buildPanelSpeechPlanPayload({
      panel,
      voiceLines: [
        line({ id: 'line-1', index: 1, speaker: 'A', content: '第一句。' }),
        line({ id: 'line-2', index: 2, speaker: 'B', content: '第二句。' }),
        line({ id: 'line-3', index: 3, speaker: 'C', content: '第三句。' }),
      ],
      speakerVoices: {
        A: { provider: 'bailian', voiceType: 'dialogue', voiceId: 'voice-a' },
        B: { provider: 'bailian', voiceType: 'dialogue', voiceId: 'voice-b' },
        C: { provider: 'bailian', voiceType: 'dialogue', voiceId: 'voice-c' },
      },
    })

    expect(plan.mode).toBe('voiceover')
    expect(plan.status).toBe('ready')
    expect(plan.warnings.some((warning) => warning.code === 'COMPLEX_DIALOGUE_DOWNGRADED')).toBe(true)
  })

  it('compiles speech plan into native video prompt section without requesting subtitles', () => {
    const plan = buildPanelSpeechPlanPayload({
      panel,
      voiceLines: [
        line({
          id: 'line-1',
          index: 1,
          speaker: '旁白',
          content: '鹦鹉螺号穿过黑暗的海沟。',
        }),
      ],
      speakerVoices: {
        旁白: { provider: 'bailian', voiceType: 'narration', voiceId: 'voice-1' },
      },
    })

    const prompt = compileSpeechPlanPromptSection({
      mode: plan.mode,
      status: plan.status,
      linesJson: plan.lines,
      voiceConfigJson: plan.voiceConfig,
    })

    expect(prompt).toContain('原生音频与台词计划')
    expect(prompt).toContain('鹦鹉螺号穿过黑暗的海沟')
    expect(prompt).toContain('不要生成字幕')
  })

  it('selects only current panel speakers with preview audio as Seedance reference candidates', () => {
    const references = getPanelSpeechReferenceVoiceConfigs(
      [
        { voiceLineId: 'line-1', lineIndex: 1, order: 1, speaker: '旁白', content: '海底的阴影逼近。' },
        { voiceLineId: 'line-2', lineIndex: 2, order: 2, speaker: '尼摩', content: '保持航向。' },
      ],
      [
        { speaker: '旁白', hasVoice: true, source: 'speaker', provider: 'fal', previewAudioUrl: 'voice/narrator.wav' },
        { speaker: '尼摩', hasVoice: true, source: 'character', provider: 'fal', previewAudioUrl: 'voice/nemo.wav' },
        { speaker: '阿龙纳斯', hasVoice: true, source: 'character', provider: 'fal', previewAudioUrl: 'voice/unused.wav' },
        { speaker: '康塞尔', hasVoice: true, source: 'character', provider: 'bailian' },
      ],
    )

    expect(references.map((item) => item.speaker)).toEqual(['旁白', '尼摩'])
    expect(references.map((item) => item.previewAudioUrl)).toEqual(['voice/narrator.wav', 'voice/nemo.wav'])
  })
})
