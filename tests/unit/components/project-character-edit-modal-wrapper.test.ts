import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const sharedModalState = vi.hoisted(() => ({
  props: null as null | {
    characterId: string
    appearanceId?: string
    onSave: (characterId: string, appearanceId: string) => void
  },
}))

vi.mock('@/components/shared/assets/CharacterEditModal', () => ({
  CharacterEditModal: (props: {
    characterId: string
    appearanceId?: string
    onSave: (characterId: string, appearanceId: string) => void
  }) => {
    sharedModalState.props = props
    return null
  },
}))

describe('project CharacterEditModal wrapper', () => {
  it('keeps project appearance id as uuid string when generating candidates', async () => {
    Reflect.set(globalThis, 'React', React)
    const ProjectCharacterEditModal = (await import(
      '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/assets/CharacterEditModal'
    )).default
    const onSave = vi.fn()
    const appearanceId = '382633e5-fd27-427f-9b22-c8928bd91629'

    renderToStaticMarkup(createElement(ProjectCharacterEditModal, {
      characterId: 'character-1',
      characterName: '角色',
      appearanceId,
      description: '角色描述',
      projectId: 'project-1',
      onClose: () => undefined,
      onSave,
      onUpdate: () => undefined,
    }))

    expect(sharedModalState.props?.appearanceId).toBe(appearanceId)
    sharedModalState.props?.onSave('character-1', appearanceId)
    expect(onSave).toHaveBeenCalledWith('character-1', appearanceId)
  })
})
