'use client'

import { forwardRef, useEffect, useRef, useState, type ChangeEvent, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import type { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import type {
  ActingCharacter,
  AIDataCharacter,
  PhotographyCharacter,
  PhotographyRules,
} from './AIDataModal.types'

interface AIDataModalFormPaneProps {
  t: ReturnType<typeof useTranslations<'storyboard'>>
  shotType: string
  cameraMove: string
  description: string
  location: string | null
  characters: AIDataCharacter[]
  videoPrompt: string
  photographyRules: PhotographyRules | null
  actingNotes: ActingCharacter[]
  activeCharIdx: number
  onActiveCharIdxChange: (idx: number) => void
  onShotTypeChange: (value: string) => void
  onCameraMoveChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  onVideoPromptChange: (value: string) => void
  onPhotographyFieldChange: (path: string, value: string) => void
  onPhotographyCharacterChange: (index: number, field: keyof PhotographyCharacter, value: string) => void
  onActingCharacterChange: (index: number, field: keyof ActingCharacter, value: string) => void
}

function FL({ children }: { children: string }) {
  return <p className="mb-1 text-[10.5px] font-semibold text-stone-500">{children}</p>
}

function StudioInput({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement> & { density?: 'compact' | 'default' }) {
  return <input {...props} className={`h-9 w-full rounded-md border border-white/10 bg-[#0f100e] px-3 text-sm text-stone-100 outline-none focus:border-[#e8d18a] ${className}`} />
}

const StudioTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { density?: 'compact' | 'default' }>(function StudioTextarea({ className = '', ...props }, ref) {
  return <textarea ref={ref} {...props} className={`w-full resize-y rounded-md border border-white/10 bg-[#0f100e] px-3 py-2 text-sm leading-6 text-stone-100 outline-none focus:border-[#e8d18a] ${className}`} />
})

function AutoGrowTextarea({
  value,
  onChange,
  rows,
  placeholder,
  density = 'default',
  className,
}: {
  value: string
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void
  rows: number
  placeholder?: string
  density?: 'compact' | 'default'
  className?: string
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  return (
    <StudioTextarea
      ref={ref}
      rows={rows}
      value={value}
      onChange={onChange}
      onInput={(event) => {
        const el = event.currentTarget
        el.style.height = '0px'
        el.style.height = `${el.scrollHeight}px`
      }}
      placeholder={placeholder}
      density={density}
      className={['overflow-hidden', className].filter(Boolean).join(' ')}
    />
  )
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="flex items-center gap-2 mb-2.5">
      <AppIcon name="sparkles" className="h-3.5 w-3.5 shrink-0 text-[#e8d18a]" />
      <span className="text-[11px] font-semibold text-stone-100">{children}</span>
    </div>
  )
}

function CollapseSection({
  label,
  iconName,
  children,
}: {
  label: string
  iconName?: 'video' | 'film'
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="overflow-hidden rounded-md border border-white/10">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center justify-between bg-white/[0.04] px-3.5 py-2.5 transition-colors hover:bg-white/[0.08]"
      >
        <div className="flex items-center gap-2">
          {iconName ? (
            <AppIcon
              name={iconName}
              className="h-3.5 w-3.5 shrink-0 text-[#e8d18a]"
            />
          ) : null}
          <span className="text-[11px] font-semibold text-stone-300">{label}</span>
        </div>
        <AppIcon
          name={open ? 'chevronUp' : 'chevronDown'}
          className="h-3.5 w-3.5 shrink-0 text-stone-500"
        />
      </button>
      {open && (
        <div className="space-y-3 bg-[#151613] px-3.5 py-3">
          {children}
        </div>
      )}
    </div>
  )
}

export default function AIDataModalFormPane({
  t,
  shotType,
  cameraMove,
  description,
  location,
  characters,
  videoPrompt,
  photographyRules,
  actingNotes,
  activeCharIdx,
  onActiveCharIdxChange,
  onShotTypeChange,
  onCameraMoveChange,
  onDescriptionChange,
  onVideoPromptChange,
  onPhotographyFieldChange,
  onPhotographyCharacterChange,
  onActingCharacterChange,
}: AIDataModalFormPaneProps) {
  const activeChar = characters[activeCharIdx]
  const photoChar = photographyRules?.characters.find(c => c.name === activeChar?.name)
  const actingCharIdx = actingNotes.findIndex(n => n.name === activeChar?.name)
  const actingChar = actingCharIdx >= 0 ? actingNotes[actingCharIdx] : null

  return (
    <div className="w-[55%] space-y-5 overflow-y-auto border-r border-white/10 bg-[#151613] p-5">

      {/* ① 视觉描述 — 最高优先 */}
      <section>
        <div className="flex items-center gap-2 mb-2.5">
          <AppIcon name="fileText" className="h-3.5 w-3.5 shrink-0 text-[#e8d18a]" />
          <span className="text-[11px] font-semibold text-stone-100">
            {t('aiData.visualDescription')}
          </span>
        </div>
        <AutoGrowTextarea
          rows={3}
          value={description}
          onChange={e => onDescriptionChange(e.target.value)}
          placeholder={t('insert.placeholder.description')}
        />
      </section>

      {/* ② 镜头设置 */}
      <section>
        <SectionLabel>{t('aiData.shotAndScene')}</SectionLabel>
        <div className="grid grid-cols-2 gap-3 mb-2">
          <div>
            <FL>{t('aiData.shotType')}</FL>
            <div className="relative">
              <AppIcon name="clapperboard" className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-500" />
              <StudioInput
                density="compact"
                value={shotType}
                onChange={e => onShotTypeChange(e.target.value)}
                placeholder={t('aiData.shotTypePlaceholder')}
                className="pl-9"
              />
            </div>
          </div>
          <div>
            <FL>{t('aiData.cameraMove')}</FL>
            <div className="relative">
              <AppIcon name="video" className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-500" />
              <StudioInput
                density="compact"
                value={cameraMove}
                onChange={e => onCameraMoveChange(e.target.value)}
                placeholder={t('aiData.cameraMovePlaceholder')}
                className="pl-9"
              />
            </div>
          </div>
        </div>
        {/* 场景 + 比例 — 只读文字，不用 input 避免视觉干扰 */}
        {location && (
          <div className="flex items-center gap-2 text-[11.5px] text-stone-500">
            <AppIcon name="imageAlt" className="h-3.5 w-3.5 shrink-0 text-[#e8d18a]" />
            <span>
              {t('aiData.scene').replace('（只读）', '')}：<span className="font-medium text-stone-300">{location}</span>
            </span>
          </div>
        )}
      </section>

      {/* ③ 角色详情 — tab 切换 */}
      {characters.length > 0 && (
        <section>
          <SectionLabel>{t('aiData.characterDetails')}</SectionLabel>

          {/* Tab 按钮 */}
          <div className="flex gap-2 mb-3 flex-wrap">
            {characters.map((char, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onActiveCharIdxChange(i)}
                className={[
                  'flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-semibold transition-all',
                  activeCharIdx === i
                    ? 'border-[#e8d18a]/60 bg-[#e8d18a]/10 text-[#f3e9cf]'
                    : 'border-white/10 bg-white/[0.04] text-stone-500 hover:text-stone-200',
                ].join(' ')}
              >
                <div className={[
                  'h-5 w-5 rounded-full flex items-center justify-center flex-shrink-0',
                  activeCharIdx === i ? 'bg-[#e8d18a]/10 text-[#e8d18a]' : 'bg-white/[0.06] text-stone-500',
                ].join(' ')}>
                  <AppIcon name="user" className="h-3 w-3" />
                </div>
                {char.name}
                {char.slot && (
                  <span className="inline-flex items-center gap-1 rounded bg-white/[0.06] px-1.5 py-0.5 text-[9.5px] text-stone-400">
                    <AppIcon name="badgeCheck" className="h-3 w-3" />
                    {char.slot}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* 当前角色详情卡 */}
          {activeChar && (
            <div className="overflow-hidden rounded-md border border-[#e8d18a]/30">
              {/* slot 行 */}
              <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-white/[0.04] px-3.5 py-2">
                <AppIcon name="badgeCheck" className="h-3.5 w-3.5 shrink-0 text-[#e8d18a]" />
                <span className="text-[10.5px] font-semibold text-stone-500">
                  {t('aiData.slot')}：
                </span>
                <span className="rounded bg-cyan-400/10 px-2 py-0.5 text-[10.5px] text-cyan-100">
                  {activeChar.slot ?? t('aiData.slotUnset')}
                </span>
              </div>

              <div className="space-y-3 bg-[#151613] px-3.5 py-3">
                {/* 外貌 — 只读 */}
                {activeChar.appearance && (
                  <div>
                    <FL>{t('aiData.appearanceReadonly')}</FL>
                    <div className="flex items-start gap-2 rounded-md bg-white/[0.04] px-3 py-2">
                      <AppIcon name="sparkles" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-200" />
                      <p className="text-[12px] leading-relaxed text-stone-300">
                        {activeChar.appearance}
                      </p>
                    </div>
                  </div>
                )}

                {/* 画面站位 */}
                {photoChar && (
                  <div>
                    <FL>{t('aiData.framePosition')}</FL>
                    <div className="space-y-2">
                      <div>
                        <p className="mb-1 text-[10px] text-stone-500">{t('aiData.screenPosition')}</p>
                        <StudioInput
                          density="compact"
                          value={photoChar.screen_position}
                          onChange={e => {
                            const idx = photographyRules!.characters.findIndex(c => c.name === activeChar.name)
                            if (idx >= 0) onPhotographyCharacterChange(idx, 'screen_position', e.target.value)
                          }}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <p className="mb-1 text-[10px] text-stone-500">{t('aiData.posture')}</p>
                          <StudioInput
                            density="compact"
                            value={photoChar.posture}
                            onChange={e => {
                              const idx = photographyRules!.characters.findIndex(c => c.name === activeChar.name)
                              if (idx >= 0) onPhotographyCharacterChange(idx, 'posture', e.target.value)
                            }}
                          />
                        </div>
                        <div>
                          <p className="mb-1 text-[10px] text-stone-500">{t('aiData.facing')}</p>
                          <StudioInput
                            density="compact"
                            value={photoChar.facing}
                            onChange={e => {
                              const idx = photographyRules!.characters.findIndex(c => c.name === activeChar.name)
                              if (idx >= 0) onPhotographyCharacterChange(idx, 'facing', e.target.value)
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 表演指导 */}
                {actingChar && (
                  <div>
                    <FL>{t('aiData.actingGuide')}</FL>
                    <AutoGrowTextarea
                      density="compact"
                      rows={2}
                      value={actingChar.acting}
                      onChange={e => onActingCharacterChange(actingCharIdx, 'acting', e.target.value)}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ④ 视频提示词 — 折叠 */}
      <CollapseSection label={t('aiData.videoPrompt')} iconName="video">
        <AutoGrowTextarea
          rows={4}
          value={videoPrompt}
          onChange={e => onVideoPromptChange(e.target.value)}
          placeholder={t('panel.videoPromptPlaceholder')}
          className="bg-amber-400/10"
        />
      </CollapseSection>

      {/* ⑤ 摄影环境 — 折叠 */}
      {photographyRules && (
        <CollapseSection label={t('aiData.photoEnv')} iconName="film">
          <div>
            <FL>{t('aiData.summary')}</FL>
            <StudioInput
              density="compact"
              value={photographyRules.scene_summary}
              onChange={e => onPhotographyFieldChange('scene_summary', e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FL>{t('aiData.lightingDirection')}</FL>
              <StudioInput
                density="compact"
                value={photographyRules.lighting?.direction ?? ''}
                onChange={e => onPhotographyFieldChange('lighting.direction', e.target.value)}
              />
            </div>
            <div>
              <FL>{t('aiData.lightingQuality')}</FL>
              <StudioInput
                density="compact"
                value={photographyRules.lighting?.quality ?? ''}
                onChange={e => onPhotographyFieldChange('lighting.quality', e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FL>{t('aiData.depthOfField')}</FL>
              <StudioInput
                density="compact"
                value={photographyRules.depth_of_field}
                onChange={e => onPhotographyFieldChange('depth_of_field', e.target.value)}
              />
            </div>
            <div>
              <FL>{t('aiData.colorTone')}</FL>
              <StudioInput
                density="compact"
                value={photographyRules.color_tone}
                onChange={e => onPhotographyFieldChange('color_tone', e.target.value)}
              />
            </div>
          </div>
        </CollapseSection>
      )}
    </div>
  )
}
