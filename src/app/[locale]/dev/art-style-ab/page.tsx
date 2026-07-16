import ArtStyleAbClient from './ArtStyleAbClient'

function isArtStyleAbEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.ENABLE_ART_STYLE_AB_TEST === '1'
}

export default function ArtStyleAbPage() {
  if (!isArtStyleAbEnabled()) {
    return (
      <div className="min-h-screen bg-[var(--glass-bg-canvas)] px-6 py-10 text-[var(--glass-text-primary)]">
        <div className="mx-auto max-w-2xl rounded-2xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] p-6">
          <h1 className="text-xl font-bold">画面风格 A/B 测试已禁用</h1>
          <p className="mt-3 text-sm text-[var(--glass-text-secondary)]">
            该页面是开发专用工具。生产环境默认禁用；如确需内部启用，请在服务端配置
            <code className="mx-1 rounded bg-[var(--glass-bg-muted)] px-1.5 py-0.5 text-xs">
              ENABLE_ART_STYLE_AB_TEST=1
            </code>
            后重新启动应用。
          </p>
        </div>
      </div>
    )
  }

  return <ArtStyleAbClient />
}
