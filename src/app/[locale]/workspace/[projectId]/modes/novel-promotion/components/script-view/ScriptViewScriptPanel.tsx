'use client'

import { useCallback, useEffect, useState } from 'react'
import { logWarn as _ulogWarn } from '@/lib/logging/core'
import { AppIcon } from '@/components/ui/icons'

interface Clip {
  id: string
  clipIndex?: number
  summary: string
  content: string
  screenplay?: string | null
  characters: string | null
  location: string | null
}

type ScreenplayContentItem =
  | { type: 'action'; text: string }
  | { type: 'dialogue'; character: string; lines: string }
  | { type: 'voiceover'; text: string }

interface ScreenplayScene {
  scene_number?: number
  heading?: {
    int_ext?: string
    location?: string
    time?: string
  }
  description?: string
  content?: ScreenplayContentItem[]
}

interface ScreenplayData {
  scenes: ScreenplayScene[]
}

function parseScreenplay(value: string | null | undefined): ScreenplayData | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object') return null
    const scenes = (parsed as { scenes?: unknown }).scenes
    if (!Array.isArray(scenes)) return null
    return parsed as ScreenplayData
  } catch (error) {
    _ulogWarn('解析剧本JSON失败:', error)
    return null
  }
}

interface ScriptViewScriptPanelProps {
  clips: Clip[]
  selectedClipId: string | null
  onSelectClip: (clipId: string) => void
  savingClips: Set<string>
  onClipEdit?: (clipId: string) => void
  onClipDelete?: (clipId: string) => void
  onClipUpdate?: (clipId: string, data: Partial<Clip>) => Promise<void> | void
  t: (key: string, values?: Record<string, unknown>) => string
  tScript: (key: string, values?: Record<string, unknown>) => string
  fullWidth?: boolean
  readOnlyClipIds?: ReadonlySet<string>
  readOnlyLabel?: string
  onDirtyStateChange?: (dirty: boolean) => void
}

function EditableText({
  editorId,
  text,
  onSave,
  onDirtyChange,
  className = '',
  tScript,
  disabled = false,
}: {
  editorId: string
  text: string
  onSave: (val: string) => Promise<void> | void
  onDirtyChange: (editorId: string, dirty: boolean) => void
  className?: string
  tScript: (key: string, values?: Record<string, unknown>) => string
  disabled?: boolean
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [value, setValue] = useState(text)

  useEffect(() => {
    setValue(text)
    onDirtyChange(editorId, false)
  }, [editorId, onDirtyChange, text])

  const handleBlur = () => {
    setIsEditing(false)
    onDirtyChange(editorId, false)
    if (value !== text) {
      void onSave(value)
    }
  }

  if (isEditing && !disabled) {
    return (
      <textarea
        autoFocus
        value={value}
        onChange={(event) => {
          const nextValue = event.target.value
          setValue(nextValue)
          onDirtyChange(editorId, nextValue !== text)
        }}
        onBlur={handleBlur}
        className={`w-full bg-[var(--glass-bg-surface)] border border-[var(--glass-stroke-focus)] rounded p-1 outline-none focus:ring-2 focus:ring-[var(--glass-focus-ring-strong)] ${className}`}
        style={{ resize: 'none', minHeight: '1.5em' }}
      />
    )
  }

  return (
    <div
      onClick={(e) => {
        if (disabled) return
        e.stopPropagation()
        setIsEditing(true)
      }}
      className={`${disabled ? 'cursor-default' : 'cursor-text hover:bg-[var(--glass-tone-info-bg)] hover:border-[var(--glass-stroke-focus)]'} rounded px-1 -mx-1 transition-colors border border-transparent ${className}`}
      title={disabled ? undefined : tScript('screenplay.clickToEdit')}
    >
      {text}
    </div>
  )
}

export default function ScriptViewScriptPanel({
  clips,
  selectedClipId,
  onSelectClip,
  savingClips,
  onClipEdit,
  onClipDelete,
  onClipUpdate,
  t,
  tScript,
  fullWidth = false,
  readOnlyClipIds = new Set<string>(),
  readOnlyLabel,
  onDirtyStateChange,
}: ScriptViewScriptPanelProps) {
  const [dirtyEditorIds, setDirtyEditorIds] = useState<Set<string>>(new Set())
  const handleEditorDirtyChange = useCallback((editorId: string, dirty: boolean) => {
    setDirtyEditorIds((previous) => {
      const next = new Set(previous)
      if (dirty) next.add(editorId)
      else next.delete(editorId)
      if (next.size === previous.size && [...next].every((id) => previous.has(id))) return previous
      return next
    })
  }, [])

  useEffect(() => {
    onDirtyStateChange?.(dirtyEditorIds.size > 0)
  }, [dirtyEditorIds.size, onDirtyStateChange])

  const handleScriptSave = async (clipId: string, newContent: string, isJson: boolean) => {
    if (!onClipUpdate) return
    const updateData: Partial<Clip> = isJson ? { screenplay: newContent } : { content: newContent }
    await onClipUpdate(clipId, updateData)
  }

  return (
    <div className={`${fullWidth ? 'w-full' : 'col-span-12 lg:col-span-8'} flex min-h-[400px] flex-col gap-4 lg:h-full`}>
      <div className="flex justify-between items-end px-2">
        <h2 className="text-xl font-bold text-[var(--glass-text-primary)] flex items-center gap-2">
          <span className="w-1.5 h-6 bg-[var(--glass-accent-from)] rounded-full" /> {tScript('scriptBreakdown')}
        </h2>
        <span className="text-sm text-[var(--glass-text-tertiary)]">
          {tScript('splitCount', { count: clips.length })}
        </span>
      </div>

      <div className="flex-1 glass-surface-elevated overflow-hidden flex flex-col relative w-full min-h-[300px]">
        <div className="lg:absolute lg:inset-0 overflow-y-auto p-6 space-y-4 app-scrollbar">
          {clips.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-[var(--glass-text-tertiary)]">
              <AppIcon name="fileFold" className="h-10 w-10 mb-2" />
              <p>{tScript('noClips')}</p>
            </div>
          ) : (
            clips.map((clip, idx) => {
              const screenplay = parseScreenplay(clip.screenplay)
              const readOnly = readOnlyClipIds.has(clip.id)

              return (
                <div
                  key={clip.id}
                  onClick={() => onSelectClip(clip.id)}
                  className={`
                    group p-5 border-[1.5px] rounded-2xl transition-all cursor-pointer relative bg-[var(--glass-bg-surface)]
                    ${selectedClipId === clip.id
                      ? 'border-[var(--glass-stroke-focus)] shadow-[0_6px_24px_rgba(0,0,0,0.06)] ring-2 ring-[var(--glass-tone-info-bg)]'
                      : 'border-[var(--glass-stroke-base)] hover:border-[var(--glass-stroke-focus)]/40 hover:shadow-md'
                    }
                  `}
                >
                  {savingClips.has(clip.id) && (
                    <div className="absolute top-2 right-2 text-xs text-[var(--glass-tone-info-fg)] flex items-center gap-1 animate-pulse">
                      <AppIcon name="upload" className="w-3 h-3" />
                      {t('preview.saving')}
                    </div>
                  )}

                  <div className="flex justify-between mb-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-bold px-2 py-0.5 rounded text-[var(--glass-tone-info-fg)] bg-[var(--glass-tone-info-bg)]">
                        {tScript('segment.title', { index: idx + 1 })} {selectedClipId === clip.id && tScript('segment.selected')}
                      </span>
                      {readOnly ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-[var(--glass-tone-info-fg)]" title={readOnlyLabel}>
                          <AppIcon name="lock" className="h-3 w-3" />
                          {readOnlyLabel}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      {onClipEdit && (
                        <button
                          onClick={() => onClipEdit(clip.id)}
                          className="text-[var(--glass-text-tertiary)] text-xs cursor-pointer hover:text-[var(--glass-tone-info-fg)]"
                        >
                          {t('common.edit')}
                        </button>
                      )}
                      {onClipDelete && (
                        <button
                          onClick={() => onClipDelete(clip.id)}
                          className="text-[var(--glass-text-tertiary)] text-xs cursor-pointer hover:text-[var(--glass-tone-danger-fg)]"
                        >
                          {t('common.delete')}
                        </button>
                      )}
                    </div>
                  </div>

                  {screenplay && screenplay.scenes ? (
                    <div className="space-y-3">
                      {screenplay.scenes.map((scene, sceneIdx: number) => (
                        <div key={sceneIdx}>
                          {/* 场景头信息 */}
                          <div className="flex items-center gap-1.5 text-xs mb-2 flex-wrap">
                            <span className="font-bold text-[var(--glass-tone-info-fg)] bg-[var(--glass-tone-info-bg)] px-2 py-0.5 rounded">
                              {tScript('screenplay.scene', { number: scene.scene_number })}
                            </span>
                            <span className="text-[var(--glass-text-tertiary)] flex items-center gap-1">
                              {scene.heading?.int_ext} ·
                              <EditableText
                                editorId={`${clip.id}:${sceneIdx}:location`}
                                text={scene.heading?.location || ''}
                                onSave={(newVal) => {
                                  const newScreenplay = JSON.parse(JSON.stringify(screenplay))
                                  newScreenplay.scenes[sceneIdx].heading.location = newVal
                                  void handleScriptSave(clip.id, JSON.stringify(newScreenplay), true)
                                }}
                                className="inline"
                                tScript={tScript}
                                disabled={readOnly}
                                onDirtyChange={handleEditorDirtyChange}
                              />
                              ·
                              <EditableText
                                editorId={`${clip.id}:${sceneIdx}:time`}
                                text={scene.heading?.time || ''}
                                onSave={(newVal) => {
                                  const newScreenplay = JSON.parse(JSON.stringify(screenplay))
                                  newScreenplay.scenes[sceneIdx].heading.time = newVal
                                  void handleScriptSave(clip.id, JSON.stringify(newScreenplay), true)
                                }}
                                className="inline"
                                tScript={tScript}
                                disabled={readOnly}
                                onDirtyChange={handleEditorDirtyChange}
                              />
                            </span>
                          </div>

                          {/* 场景描述 */}
                          {scene.description && (
                            <div className="text-xs text-[var(--glass-text-secondary)] bg-[var(--glass-bg-muted)] border-l-2 border-[var(--glass-stroke-base)] px-2 py-1 rounded mb-2">
                              <EditableText
                                editorId={`${clip.id}:${sceneIdx}:description`}
                                text={scene.description}
                                onSave={(newVal) => {
                                  const newScreenplay = JSON.parse(JSON.stringify(screenplay))
                                  newScreenplay.scenes[sceneIdx].description = newVal
                                  void handleScriptSave(clip.id, JSON.stringify(newScreenplay), true)
                                }}
                                tScript={tScript}
                                disabled={readOnly}
                                onDirtyChange={handleEditorDirtyChange}
                              />
                            </div>
                          )}

                          {/* 内容流 - 高密度胶囊文本流 */}
                          <div className="flex flex-col gap-2">
                            {scene.content?.map((item, itemIdx: number) => {
                              if (item.type === 'action') {
                                return (
                                  <div key={itemIdx} className="text-sm text-[var(--glass-text-secondary)] bg-[var(--glass-bg-muted)]/60 border border-[var(--glass-stroke-base)] px-2.5 py-1 rounded-lg flex items-start gap-2 w-fit max-w-full leading-[1.5]">
                                    <AppIcon name="clapperboard" className="w-3.5 h-3.5 text-[var(--glass-text-tertiary)] shrink-0 mt-[2px]" />
                                    <EditableText
                                      editorId={`${clip.id}:${sceneIdx}:${itemIdx}:action`}
                                      text={item.text}
                                      onSave={(newVal) => {
                                        const newScreenplay = JSON.parse(JSON.stringify(screenplay))
                                        newScreenplay.scenes[sceneIdx].content[itemIdx].text = newVal
                                        void handleScriptSave(clip.id, JSON.stringify(newScreenplay), true)
                                      }}
                                      tScript={tScript}
                                      disabled={readOnly}
                                      onDirtyChange={handleEditorDirtyChange}
                                    />
                                  </div>
                                )
                              }
                              if (item.type === 'dialogue') {
                                return (
                                  <div key={itemIdx} className="flex flex-wrap items-baseline gap-2">
                                    <span className="inline-flex items-center text-[13px] font-bold text-[var(--glass-tone-info-fg)] bg-[var(--glass-tone-info-bg)] border border-[var(--glass-stroke-focus)]/40 px-2.5 py-0.5 rounded-full shrink-0">
                                      {item.character}
                                    </span>
                                    <div className="text-[15px] text-[var(--glass-text-primary)] font-medium leading-[1.5] flex-1 min-w-0">
                                      <EditableText
                                        editorId={`${clip.id}:${sceneIdx}:${itemIdx}:dialogue`}
                                        text={item.lines}
                                        onSave={(newVal) => {
                                          const newScreenplay = JSON.parse(JSON.stringify(screenplay))
                                          newScreenplay.scenes[sceneIdx].content[itemIdx].lines = newVal
                                          void handleScriptSave(clip.id, JSON.stringify(newScreenplay), true)
                                        }}
                                        tScript={tScript}
                                        disabled={readOnly}
                                        onDirtyChange={handleEditorDirtyChange}
                                      />
                                    </div>
                                  </div>
                                )
                              }
                              if (item.type === 'voiceover') {
                                return (
                                  <div key={itemIdx} className="flex flex-wrap items-baseline gap-2">
                                    <span className="inline-flex items-center text-[13px] font-bold text-[var(--glass-tone-info-fg)]/80 bg-[var(--glass-tone-info-bg)]/50 border border-[var(--glass-stroke-focus)]/20 px-2.5 py-0.5 rounded-full shrink-0 italic">
                                      {tScript('screenplay.narration')}
                                    </span>
                                    <div className="min-w-0 flex-1 text-[15px] font-medium italic leading-[1.5] text-[var(--glass-text-secondary)]">
                                      <EditableText
                                        editorId={`${clip.id}:${sceneIdx}:${itemIdx}:voiceover`}
                                        text={item.text}
                                        onSave={(newVal) => {
                                          const newScreenplay = JSON.parse(JSON.stringify(screenplay))
                                          newScreenplay.scenes[sceneIdx].content[itemIdx].text = newVal
                                          return handleScriptSave(clip.id, JSON.stringify(newScreenplay), true)
                                        }}
                                        tScript={tScript}
                                        disabled={readOnly}
                                        onDirtyChange={handleEditorDirtyChange}
                                      />
                                    </div>
                                  </div>
                                )
                              }
                              return null
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm leading-relaxed text-[var(--glass-text-secondary)]">
                      <EditableText
                        editorId={`${clip.id}:content`}
                        text={clip.content || clip.summary}
                        onSave={(newVal) => handleScriptSave(clip.id, newVal, false)}
                        tScript={tScript}
                        disabled={readOnly}
                        onDirtyChange={handleEditorDirtyChange}
                      />
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
