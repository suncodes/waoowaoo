'use client'
import { useEffect, useState } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import ProductShell from '@/components/product/ProductShell'
import ApiConfigTab from './components/ApiConfigTab'
import { AppIcon } from '@/components/ui/icons'
import { useRouter } from '@/i18n/navigation'

export default function ProfilePage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const t = useTranslations('profile')
  const tc = useTranslations('common')

  // 主要分区：扣费记录 / API配置
  const [activeSection, setActiveSection] = useState<'billing' | 'apiConfig'>('apiConfig')

  useEffect(() => {
    if (status === 'loading') return
    if (!session) { router.push({ pathname: '/auth/signin' }); return }
  }, [router, session, status])

  if (status === 'loading' || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#080907]">
        <div className="text-sm text-stone-500">{tc('loading')}</div>
      </div>
    )
  }

  const noBillingText = t('openSourceNoBilling')

  return (
    <ProductShell title="设置" subtitle="配置模型、账户和项目默认生产能力。" maxWidth="wide">
        <div className="grid min-h-[calc(100vh-160px)] gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">

          {/* 左侧侧边栏 */}
          <aside className="min-w-0">
            <div className="flex h-full flex-col rounded-lg border border-white/10 bg-[#0b0c0a] p-5">

              {/* 用户信息 */}
              <div className="mb-6">
                <div className="mb-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#c8a85f]">Account</p>
                  <h2 className="mt-2 truncate font-semibold text-stone-50">{session.user?.name || t('user')}</h2>
                  <p className="mt-1 text-xs text-stone-500">{t('personalAccount')}</p>
                </div>

                {/* 余额卡片 */}
                <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
                  <div className="text-xs font-medium text-stone-500">{t('availableBalance')}</div>
                  <div className="mt-2 text-sm font-semibold text-stone-100">{noBillingText}</div>
                </div>
              </div>

              {/* 导航菜单 */}
              <nav className="flex-1 space-y-2">
                <button
                  onClick={() => setActiveSection('apiConfig')}
                  className={`flex w-full cursor-pointer items-center gap-3 rounded-md px-4 py-3 text-left text-sm transition-colors ${activeSection === 'apiConfig'
                    ? 'bg-[#e8d18a]/12 text-[#f3e9cf]'
                    : 'text-stone-400 hover:bg-white/[0.06] hover:text-stone-100'
                    }`}
                >
                  <AppIcon name="settingsHexAlt" className="h-5 w-5" />
                  <span className="font-medium">{t('apiConfig')}</span>
                </button>

                <button
                  onClick={() => setActiveSection('billing')}
                  className={`flex w-full cursor-pointer items-center gap-3 rounded-md px-4 py-3 text-left text-sm transition-colors ${activeSection === 'billing'
                    ? 'bg-[#e8d18a]/12 text-[#f3e9cf]'
                    : 'text-stone-400 hover:bg-white/[0.06] hover:text-stone-100'
                    }`}
                >
                  <AppIcon name="receipt" className="h-5 w-5" />
                  <span className="font-medium">{t('billingRecords')}</span>
                </button>
              </nav>
              {/* 退出登录 */}
              <button
                onClick={() => signOut({ callbackUrl: '/' })}
                className="mt-auto flex cursor-pointer items-center gap-2 rounded-md border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm font-semibold text-rose-200 transition-colors hover:bg-rose-400/15"
              >
                <AppIcon name="logout" className="h-4 w-4" />
                {t('logout')}
              </button>
            </div>
          </aside>

          {/* 右侧内容区 */}
          <section className="min-w-0">
            <div className="flex h-full flex-col overflow-hidden rounded-lg border border-white/10 bg-[#10110e]">

              {activeSection === 'apiConfig' ? (
                <ApiConfigTab />
              ) : (
                <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                  <AppIcon name="receipt" className="mb-4 h-12 w-12 text-stone-600" />
                  <p className="text-base font-semibold text-stone-100">{noBillingText}</p>
                </div>
              )}
            </div>
          </section>
        </div>
    </ProductShell>
  )
}
