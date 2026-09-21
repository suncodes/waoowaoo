import { downloadAndUploadVideo, generateUniqueKey, toFetchableUrl, uploadObject } from '@/lib/storage'

export interface ProcessMediaOptions {
  source: string | Buffer
  type: 'image' | 'video' | 'audio'
  keyPrefix: string
  targetId: string
  downloadHeaders?: Record<string, string>
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
}

function resolveContentType(ext: string): string {
  return MIME_BY_EXT[ext] || 'application/octet-stream'
}

function defaultExtensionForMediaType(type: ProcessMediaOptions['type']): string {
  if (type === 'video') return 'mp4'
  if (type === 'audio') return 'mp3'
  return 'jpg'
}

function isExtensionCompatibleWithMediaType(ext: string, type: ProcessMediaOptions['type']): boolean {
  const mimeType = resolveContentType(ext)
  if (type === 'image') return mimeType.startsWith('image/')
  if (type === 'video') return mimeType.startsWith('video/')
  return mimeType.startsWith('audio/')
}

function extensionFromMimeType(mimeType: string): string | null {
  const normalized = mimeType.trim().toLowerCase().split(';', 1)[0]
  for (const [extension, mappedMimeType] of Object.entries(MIME_BY_EXT)) {
    if (mappedMimeType === normalized) return extension
  }
  return null
}

function extensionFromUrl(value: string): string | null {
  try {
    const parsed = new URL(value)
    const filename = parsed.searchParams.get('filename') || parsed.pathname.split('/').pop() || ''
    const match = filename.toLowerCase().match(/\.([a-z0-9]{1,10})$/)
    return match?.[1] || null
  } catch {
    const cleanValue = value.split(/[?#]/, 1)[0] || ''
    const match = cleanValue.toLowerCase().match(/\.([a-z0-9]{1,10})$/)
    return match?.[1] || null
  }
}

function resolveSourceMediaFormat(source: string | Buffer, type: ProcessMediaOptions['type']): {
  ext: string
  contentType: string
} {
  let extension: string | null = null
  if (typeof source === 'string' && source.startsWith('data:')) {
    const mimeType = source.slice(5).split(/[;,]/, 1)[0] || ''
    extension = extensionFromMimeType(mimeType)
  } else if (typeof source === 'string') {
    extension = extensionFromUrl(source)
  }

  const ext = extension && isExtensionCompatibleWithMediaType(extension, type)
    ? extension
    : defaultExtensionForMediaType(type)
  return {
    ext,
    contentType: resolveContentType(ext),
  }
}

/**
 * 处理媒体结果：下载 -> 上传 COS，返回 COS key。
 */
export async function processMediaResult(options: ProcessMediaOptions): Promise<string> {
  const { source, type, keyPrefix, targetId, downloadHeaders } = options
  const { ext, contentType } = resolveSourceMediaFormat(source, type)
  const key = generateUniqueKey(`${keyPrefix}-${targetId}`, ext)

  if (typeof source === 'string') {
    if (source.startsWith('data:')) {
      const base64Start = source.indexOf(';base64,')
      if (base64Start === -1) throw new Error('无法解析 data: URL')
      const base64Data = source.substring(base64Start + 8)
      const buffer = Buffer.from(base64Data, 'base64') as Buffer
      return await uploadObject(buffer, key, undefined, contentType)
    }

    if (type === 'video') {
      return await downloadAndUploadVideo(source, key, 3, downloadHeaders, contentType)
    }

    const response = await fetch(toFetchableUrl(source))
    const buffer = Buffer.from(await response.arrayBuffer()) as Buffer
    return await uploadObject(buffer, key, undefined, contentType)
  }

  return await uploadObject(source, key, undefined, contentType)
}
