'use client'

import { useState } from 'react'
import Image from 'next/image'
import { useSession } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import LanguageSwitcher from './LanguageSwitcher'
import { AppIcon } from '@/components/ui/icons'
import UpdateNoticeModal from './UpdateNoticeModal'
import { useGithubReleaseUpdate } from '@/hooks/common/useGithubReleaseUpdate'
import { Link } from '@/i18n/navigation'
import { buildAuthenticatedHomeTarget } from '@/lib/home/default-route'

export default function Navbar() {
  const { data: session, status } = useSession()
  const t = useTranslations('nav')
  const tc = useTranslations('common')
  const { currentVersion, update, shouldPulse, showModal, openModal, dismissCurrentUpdate, checkNow } = useGithubReleaseUpdate()
  const [checkMsg, setCheckMsg] = useState<string | null>(null)
  const [checkMsgFading, setCheckMsgFading] = useState(false)
  const [manualChecking, setManualChecking] = useState(false)

  const handleCheckUpdate = async () => {
    setCheckMsg(null)
    setCheckMsgFading(false)
    setManualChecking(true)
    await Promise.all([checkNow(), new Promise((resolve) => setTimeout(resolve, 700))])
    setManualChecking(false)
    setTimeout(() => {
      setCheckMsg('upToDate')
      setTimeout(() => setCheckMsgFading(true), 2000)
      setTimeout(() => { setCheckMsg(null); setCheckMsgFading(false) }, 3000)
    }, 100)
  }

  return (
    <>
      <nav className="border-b border-[#252820] bg-[#10120f]/95 backdrop-blur-md">
        <div className="mx-auto flex h-[72px] max-w-[1440px] items-center justify-between gap-5 px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Link href={session ? buildAuthenticatedHomeTarget() : { pathname: '/' }} className="flex h-9 w-9 items-center justify-center rounded-md bg-[#e8d18a] text-[#171810] transition-transform hover:scale-[1.03]">
              <Image src="/logo-small.png?v=1" alt={tc('appName')} width={36} height={36} className="h-7 w-7 object-contain" />
            </Link>
            <span className="hidden text-[11px] font-bold uppercase tracking-[0.2em] text-[#b99b58] sm:inline">WAOO STUDIO</span>
            <button
              type="button"
              onClick={openModal}
              disabled={!update}
              className={`relative inline-flex items-center gap-1.5 border px-3 py-1.5 text-[11px] font-semibold transition-colors ${update
                ? 'border-[#d5ad58]/45 bg-[#d5ad58]/10 text-[#f0d78d] hover:bg-[#d5ad58]/16'
                : 'border-[#2a2f25] bg-[#151813] text-[#777d70] disabled:cursor-default'
              }`}
              aria-label={tc('updateNotice.openDialog')}
            >
              <AppIcon name="sparkles" className="h-3.5 w-3.5" />
              {tc('betaVersion', { version: currentVersion })}
              {update ? <span className="relative inline-flex items-center gap-1 text-[10px] uppercase"><span className={shouldPulse ? 'absolute -inset-1 animate-ping bg-[#e8d18a]/20' : ''} /><AppIcon name="upload" className="h-3 w-3" />{tc('updateNotice.updateTag')}</span> : null}
            </button>
            <button
              type="button"
              onClick={() => { void handleCheckUpdate() }}
              disabled={manualChecking}
              className="inline-flex h-8 w-8 items-center justify-center border border-transparent text-[#777d70] transition-colors hover:border-[#2a2f25] hover:bg-[#20241d] hover:text-[#eff1e8] disabled:opacity-40"
              title={tc('updateNotice.checkUpdate')}
            >
              <AppIcon name="refresh" className={`h-3.5 w-3.5 ${manualChecking ? 'animate-spin' : ''}`} />
            </button>
            {checkMsg === 'upToDate' && !update ? <span className="hidden text-[11px] font-medium text-[#70c99d] sm:inline" style={{ opacity: checkMsgFading ? 0 : 1 }}>已是最新</span> : null}
          </div>

          <div className="flex items-center gap-2">
            {status === 'loading' ? <div className="h-8 w-24 animate-pulse bg-[#1a1d18]" /> : session ? (
              <>
                <Link href={{ pathname: '/workspace' }} className="hidden items-center gap-2 px-3 py-2 text-sm font-medium text-[#9ca294] transition-colors hover:bg-[#20241d] hover:text-[#eff1e8] sm:inline-flex"><AppIcon name="monitor" className="h-4 w-4" />{t('workspace')}</Link>
                <Link href={{ pathname: '/workspace/asset-hub' }} className="hidden items-center gap-2 px-3 py-2 text-sm font-medium text-[#9ca294] transition-colors hover:bg-[#20241d] hover:text-[#eff1e8] sm:inline-flex"><AppIcon name="folderHeart" className="h-4 w-4" />{t('assetHub')}</Link>
                <Link href={{ pathname: '/profile' }} className="inline-flex h-9 w-9 items-center justify-center border border-[#2a2f25] bg-[#151813] text-[#9ca294] hover:bg-[#20241d] hover:text-[#eff1e8]" title={t('profile')}><AppIcon name="userRoundCog" className="h-4 w-4" /></Link>
                <div className="hidden sm:block"><LanguageSwitcher /></div>
              </>
            ) : (
              <>
                <Link href={{ pathname: '/auth/signin' }} className="px-3 py-2 text-sm font-medium text-[#9ca294] hover:text-[#eff1e8]">{t('signin')}</Link>
                <Link href={{ pathname: '/auth/signup' }} className="inline-flex h-9 items-center bg-[#e8d18a] px-4 text-sm font-semibold text-[#171810] hover:bg-[#f3e9cf]">{t('signup')}</Link>
                <LanguageSwitcher />
              </>
            )}
          </div>
        </div>
      </nav>
      {update ? <UpdateNoticeModal show={showModal} currentVersion={currentVersion} latestVersion={update.latestVersion} releaseUrl={update.releaseUrl} releaseName={update.releaseName} publishedAt={update.publishedAt} onDismiss={dismissCurrentUpdate} /> : null}
    </>
  )
}
