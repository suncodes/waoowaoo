'use client'

import { useEffect } from 'react'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { useSession } from 'next-auth/react'
import { useRouter, Link } from '@/i18n/navigation'
import Navbar from '@/components/Navbar'
import { AppIcon } from '@/components/ui/icons'
import { buildAuthenticatedHomeTarget } from '@/lib/home/default-route'

export default function Home() {
  const t = useTranslations('landing')
  const { status } = useSession()
  const router = useRouter()

  useEffect(() => {
    if (status === 'authenticated') router.replace(buildAuthenticatedHomeTarget())
  }, [router, status])

  if (status !== 'unauthenticated') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0d0a]">
        <div className="flex items-center gap-3 text-sm text-[#777d70]"><AppIcon name="loader" className="h-4 w-4 animate-spin" />正在进入创作台</div>
      </div>
    )
  }

  const workflow = [
    ['项目简报', '确定 AI 漫剧或书籍导读的内容目标。'],
    ['文稿与资产', '编辑文稿，生成并确认角色、场景和道具。'],
    ['分镜与生产', '组织镜头、生成画面、视频与配音。'],
    ['交付与诊断', '导出成片以及完整流程诊断包。'],
  ]

  return (
    <div className="min-h-screen bg-[#0b0d0a] text-[#eff1e8]">
      <div className="sticky top-0 z-50"><Navbar /></div>
      <main>
        <section className="relative min-h-[calc(100dvh-72px)] overflow-hidden border-b border-[#252820]">
          <Image src="/banner.png" alt="Waoo Studio 创作工作台" fill priority sizes="100vw" className="object-cover object-center" />
          <div className="absolute inset-0 bg-black/58" />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(11,13,10,0.96)_0%,rgba(11,13,10,0.76)_48%,rgba(11,13,10,0.18)_100%)]" />
          <div className="relative mx-auto flex min-h-[calc(100dvh-72px)] max-w-[1440px] items-center px-5 pb-28 pt-16 sm:px-8 lg:px-12">
            <div className="max-w-3xl">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#d4b86f]">AI STORY PRODUCTION</p>
              <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-normal text-white sm:text-6xl">Waoo Studio</h1>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-[#d3d7cc]">{t('title')}。{t('subtitle')}</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href={{ pathname: '/auth/signup' }} className="inline-flex h-11 items-center gap-2 bg-[#e8d18a] px-5 text-sm font-semibold text-[#171810] hover:bg-[#f3e9cf]"><AppIcon name="clapperboard" className="h-4 w-4" />{t('getStarted')}</Link>
                <Link href={{ pathname: '/auth/signin' }} className="inline-flex h-11 items-center border border-white/25 bg-black/25 px-5 text-sm font-semibold text-white hover:bg-black/45">登录工作区</Link>
              </div>
            </div>
          </div>
          <div className="absolute inset-x-0 bottom-0 border-t border-white/10 bg-[#0b0d0a]/88 backdrop-blur-md">
            <div className="mx-auto grid max-w-[1440px] grid-cols-2 gap-px bg-white/10 sm:grid-cols-4">
              {workflow.map(([title, description], index) => (
                <div key={title} className="bg-[#11140f]/96 px-4 py-4 sm:px-5">
                  <div className="text-[10px] font-bold text-[#b99b58]">0{index + 1}</div>
                  <div className="mt-1 text-sm font-semibold text-white">{title}</div>
                  <div className="mt-1 hidden text-xs leading-5 text-[#777d70] lg:block">{description}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
