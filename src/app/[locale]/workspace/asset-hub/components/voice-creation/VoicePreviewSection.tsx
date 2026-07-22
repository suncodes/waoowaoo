import TaskStatusInline from '@/components/task/TaskStatusInline'
import VoiceDesignGeneratorSection from '@/components/voice/VoiceDesignGeneratorSection'
import type { VoiceCreationRuntime } from './hooks/useVoiceCreation'

interface VoicePreviewSectionProps {
  runtime: VoiceCreationRuntime
}

export default function VoicePreviewSection({ runtime }: VoicePreviewSectionProps) {
  const {
    mode,
    voiceName,
    voicePrompt,
    previewText,
    schemeCount,
    isVoiceCreationSubmitting,
    isSaving,
    error,
    generatedVoices,
    selectedIndex,
    playingIndex,
    uploadFile,
    uploadPreviewUrl,
    isUploading,
    isDragging,
    fileInputRef,
    voiceCreationSubmittingState,
    uploadSubmittingState,
    tHub,
    tvCreate,
    setVoicePrompt,
    setPreviewText,
    setSchemeCount,
    setSelectedIndex,
    setUploadFile,
    setUploadPreviewUrl,
    handleGenerate,
    handlePlayVoice,
    handleSaveDesigned,
    handleFileSelect,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handlePlayUpload,
    handleSaveUploaded,
  } = runtime

  return (
    <>
      {mode === 'design' && (
        <VoiceDesignGeneratorSection
          voicePrompt={voicePrompt}
          onVoicePromptChange={setVoicePrompt}
          previewText={previewText}
          onPreviewTextChange={setPreviewText}
          schemeCount={schemeCount}
          onSchemeCountChange={setSchemeCount}
          isSubmitting={isVoiceCreationSubmitting}
          submittingState={voiceCreationSubmittingState}
          error={error}
          generatedVoices={generatedVoices}
          selectedIndex={selectedIndex}
          onSelectIndex={setSelectedIndex}
          playingIndex={playingIndex}
          onPlayVoice={handlePlayVoice}
          onGenerate={() => {
            void handleGenerate()
          }}
          footer={(
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => {
                  void handleGenerate()
                }}
                disabled={isVoiceCreationSubmitting}
                className="h-9 flex-1 rounded-md border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-stone-200 hover:bg-white/[0.08]"
              >
                {tHub('regenerate')}
              </button>
              <button
                onClick={() => {
                  void handleSaveDesigned()
                }}
                disabled={selectedIndex === null || isSaving || !voiceName.trim()}
                className="h-9 flex-1 rounded-md bg-[#f3e9cf] px-3 text-xs font-semibold text-[#161512] hover:bg-[#fff5d9] disabled:cursor-not-allowed disabled:opacity-45"
              >
                {isSaving ? tHub('modal.adding') : tHub('save')}
              </button>
            </div>
          )}
        />
      )}

      {mode === 'upload' && (
        <>
          {!uploadFile ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`cursor-pointer rounded-md border border-dashed p-8 text-center transition-colors ${isDragging
                ? 'border-[#e8d18a] bg-[#e8d18a]/10'
                : 'border-white/15 bg-white/[0.02] hover:border-white/30 hover:bg-white/[0.05]'
                }`}
            >
              <div className="mb-2 text-sm text-stone-300">{tvCreate('dropOrClick')}</div>
              <div className="text-xs text-stone-500">{tvCreate('supportedFormats')}</div>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleFileSelect(file)
                }}
                className="hidden"
              />
            </div>
          ) : (
            <div className="rounded-md border border-white/10 bg-white/[0.03] p-4">
              <div className="truncate text-sm font-medium text-stone-100">{uploadFile.name}</div>
              <button
                onClick={() => {
                  setUploadFile(null)
                  if (uploadPreviewUrl) URL.revokeObjectURL(uploadPreviewUrl)
                  setUploadPreviewUrl(null)
                }}
                className="mt-2 inline-flex h-8 items-center rounded-md border border-white/10 bg-white/[0.04] px-3 text-xs text-stone-300 hover:bg-white/[0.08]"
              >
                ×
              </button>
              {uploadPreviewUrl && (
                <button
                  onClick={handlePlayUpload}
                  className="mt-2 h-9 w-full rounded-md border border-cyan-400/25 bg-cyan-400/10 text-xs font-semibold text-cyan-100 hover:bg-cyan-400/15"
                >
                  {tvCreate('previewAudio')}
                </button>
              )}
            </div>
          )}

          {uploadFile && (
            <button
              onClick={handleSaveUploaded}
              disabled={isUploading || !voiceName.trim()}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[#f3e9cf] px-4 text-sm font-semibold text-[#161512] hover:bg-[#fff5d9] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {isUploading ? (
                <TaskStatusInline
                  state={uploadSubmittingState}
                  className="text-white [&>span]:text-white [&_svg]:text-white"
                />
              ) : (
                tHub('save')
              )}
            </button>
          )}
        </>
      )}

      {mode === 'upload' && error && (
        <div className="rounded-md border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">
          {error}
        </div>
      )}
    </>
  )
}
