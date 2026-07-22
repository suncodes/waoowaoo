import { describe, expect, it } from 'vitest'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'

const CASES = [
  {
    promptId: PROMPT_IDS.NP_CONTENT_PLAN,
    variables: { profile_json: '{}', book_seed_json: '{}', source_text: 'source' },
  },
  {
    promptId: PROMPT_IDS.NP_CONTENT_REVIEW,
    variables: { profile_json: '{}', book_seed_json: '{}', source_text: 'source', plan_json: '{}' },
  },
  {
    promptId: PROMPT_IDS.NP_VISUAL_PLAN,
    variables: {
      profile_json: '{}',
      creative_brief_json: '{}',
      content_plan_json: '{}',
      clips_json: '[]',
      assets_json: '{}',
      video_ratio: '16:9',
      art_style: 'cinematic',
    },
  },
  {
    promptId: PROMPT_IDS.NP_VISUAL_PLAN_REPAIR,
    variables: {
      validation_error: 'visualUnits.0.imagePrompt is required',
      candidate_output: '{}',
      profile_json: '{}',
      clips_json: '[]',
      assets_json: '{}',
    },
  },
  {
    promptId: PROMPT_IDS.NP_VISUAL_QUALITY_REVIEW,
    variables: { target_spec_json: '{}', technical_checks_json: '[]', candidate_count: '1' },
  },
  {
    promptId: PROMPT_IDS.NP_VISUAL_AUTO_REPAIR,
    variables: { base_prompt: 'base', target_spec_json: '{}', prompt_patch_json: '{}' },
  },
] as const

describe('video quality prompt catalog', () => {
  for (const locale of ['zh', 'en'] as const) {
    for (const promptCase of CASES) {
      it(`builds ${promptCase.promptId} in ${locale} without unresolved placeholders`, () => {
        const prompt = buildPrompt({
          promptId: promptCase.promptId,
          locale,
          variables: promptCase.variables,
        })

        expect(prompt.length).toBeGreaterThan(100)
        expect(prompt).not.toMatch(/\{[a-zA-Z0-9_]+\}/)
      })
    }
  }

  it('keeps the content and visual planning contracts explicit in both locales', () => {
    for (const locale of ['zh', 'en'] as const) {
      const contentPlan = buildPrompt({
        promptId: PROMPT_IDS.NP_CONTENT_PLAN,
        locale,
        variables: { profile_json: '{}', book_seed_json: '{}', source_text: 'source' },
      })
      const visualPlan = buildPrompt({
        promptId: PROMPT_IDS.NP_VISUAL_PLAN,
        locale,
        variables: {
          profile_json: '{}',
          creative_brief_json: '{}',
          content_plan_json: '{}',
          clips_json: '[]',
          assets_json: '{}',
          video_ratio: '16:9',
          art_style: 'cinematic',
        },
      })

      expect(contentPlan).toMatch(/85%.*92%/)
      expect(contentPlan).toMatch(locale === 'zh' ? /准确文字.*onScreenText/ : /exact copy.*onScreenText/)
      expect(visualPlan).toContain('assetRefs')
      expect(visualPlan).toMatch(locale === 'zh' ? /一个时空.*一个构图.*一个主要视觉事件/ : /one time.*one place.*one composition.*one primary visual event/)
      expect(visualPlan).toMatch(/generated_image.*text_card.*composite/)
    }
  })
})
