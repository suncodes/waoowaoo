import { describe, expect, it } from 'vitest'
import {
  buildPanelImageGenerationSnapshot,
  buildPanelImagePromptSpec,
  type PanelImagePromptCompilerContext,
} from '@/lib/prompt-compiler/panel-image-prompt-compiler'

function buildContext(): PanelImagePromptCompilerContext {
  return {
    panel: {
      panel_id: 'panel-1',
      shot_type: 'close-up',
      camera_move: 'low angle',
      description: 'Hero grips the brass key before opening the vault.',
      image_prompt: 'Hero and key at the vault door',
      location: 'Vault corridor',
      characters: [{ name: 'Hero', appearance: 'jacket', slot: 'left foreground' }],
      props: ['brass key'],
      source_text: 'The vault door trembled.',
      photography_rules: {
        lighting: { direction: 'hard side light' },
        camera: { angle: 'low angle' },
        shotSpec: {
          narrativeIntent: 'Show the irreversible choice before the vault opens.',
          shotFunction: 'payoff',
          primarySubject: 'brass key',
          actionBeats: ['The key is held still at the lock.'],
          sceneLightingBaseline: 'narrow hard side light with bright metal edge',
          camera: 'low angle close-up with shallow depth',
          continuity: {
            fromPrevious: 'Hero has reached the vault door.',
            toNext: 'The lock will turn in the next shot.',
            screenDirection: 'Hero faces right toward the vault.',
            lightingContinuity: 'same hard side light',
          },
          singleImageFeasibility: {
            status: 'feasible',
            reason: 'one object action at one vault door',
            riskFlags: [],
          },
          promptBlueprint: {
            subject: ['brass key identity locked to prop reference'],
            environment: ['vault corridor metal door'],
            action: ['key held still at the lock'],
            camera: ['low angle close-up'],
            lighting: ['hard side light'],
            style: ['cinematic ink illustration'],
            negative: ['no extra hands'],
          },
        },
      },
      acting_notes: null,
      visual_type: 'illustration',
      render_mode: 'generated_image',
      on_screen_text_for_downstream_composition: '',
    },
    context: {
      character_appearances: [{
        id: 'character-1',
        name: 'Hero',
        appearance: 'jacket',
        description: 'short black hair, dark jacket',
        slot: 'left foreground',
      }],
      location_reference: {
        id: 'location-1',
        name: 'Vault corridor',
        description: 'narrow metal corridor with a sealed vault door',
        available_slots: ['door in background'],
      },
      prop_references: [{
        id: 'prop-1',
        name: 'brass key',
        description: 'worn brass key with square teeth',
      }],
    },
  }
}

describe('panel image prompt compiler', () => {
  it('turns panel context into a structured image prompt spec', () => {
    const spec = buildPanelImagePromptSpec({
      context: buildContext(),
      aspectRatio: '16:9',
      styleText: 'cinematic ink illustration',
    })

    expect(spec).toMatchObject({
      panelId: 'panel-1',
      aspectRatio: '16:9',
      narrativeIntent: 'Show the irreversible choice before the vault opens.',
      shotFunction: 'payoff',
      primarySubject: 'brass key',
      actionState: 'The key is held still at the lock.',
      environment: 'narrow metal corridor with a sealed vault door',
      lightingAndColor: 'narrow hard side light with bright metal edge',
      styleAndTexture: 'cinematic ink illustration',
      textPolicy: 'no_text',
    })
    expect(spec.assetRefs).toEqual([
      { id: 'character-1', kind: 'character', name: 'Hero', role: 'supporting' },
      { id: 'location-1', kind: 'location', name: 'Vault corridor', role: 'environment' },
      { id: 'prop-1', kind: 'prop', name: 'brass key', role: 'primary' },
    ])
    expect(spec.spatialLayout).toContain('Hero: left foreground')
    expect(spec.composition.midground).toContain('brass key')
    expect(spec.continuity.fromPrevious).toBe('Hero has reached the vault door.')
    expect(spec.singleImageFeasibility.reason).toBe('one object action at one vault door')
    expect(spec.promptBlueprint.subject).toEqual(['brass key identity locked to prop reference'])
    expect(spec.negativeConstraints).toContain('no extra hands')
    expect(spec.negativeConstraints).toContain('无水印')
  })

  it('builds stable prompt, spec and input hashes for the same generation inputs', () => {
    const spec = buildPanelImagePromptSpec({
      context: buildContext(),
      aspectRatio: '16:9',
      styleText: 'cinematic ink illustration',
    })
    const first = buildPanelImageGenerationSnapshot({
      targetId: 'panel-1',
      modelKey: 'image::storyboard',
      promptTemplateId: 'single_panel_image',
      referenceImages: ['ref-1.png'],
      promptSpec: spec,
      compiledPrompt: 'full compiled prompt',
      assetVersionHash: 'asset-hash',
    })
    const second = buildPanelImageGenerationSnapshot({
      targetId: 'panel-1',
      modelKey: 'image::storyboard',
      promptTemplateId: 'single_panel_image',
      referenceImages: ['ref-1.png'],
      promptSpec: spec,
      compiledPrompt: 'full compiled prompt',
      assetVersionHash: 'asset-hash',
    })

    expect(second.promptHash).toBe(first.promptHash)
    expect(second.specHash).toBe(first.specHash)
    expect(second.inputHash).toBe(first.inputHash)
  })
})
