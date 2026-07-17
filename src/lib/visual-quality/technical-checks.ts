import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { loadImageResource } from '@/lib/media/outbound-image'
import type { VisualQualityIssueCode } from './types'

export interface VisualTechnicalIssue {
  code: VisualQualityIssueCode
  severity: 'major' | 'critical'
  message: string
}

export interface VisualTechnicalCheck {
  candidateIndex: number
  readable: boolean
  byteLength: number
  width: number | null
  height: number | null
  actualAspectRatio: number | null
  contentHash: string | null
  issues: VisualTechnicalIssue[]
}

function parseAspectRatio(value: string): number | null {
  const match = value.trim().match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/)
  if (!match) return null
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  return width / height
}

async function inspectCandidate(url: string, candidateIndex: number, targetRatio: number | null) {
  const issues: VisualTechnicalIssue[] = []
  try {
    const resource = await loadImageResource(url)
    const byteLength = resource.bytes.byteLength
    if (byteLength < 512) {
      issues.push({ code: 'EMPTY_IMAGE', severity: 'critical', message: 'image payload is empty or truncated' })
    }
    const metadata = await sharp(resource.bytes).metadata()
    const width = metadata.width || null
    const height = metadata.height || null
    const actualAspectRatio = width && height ? width / height : null
    if (!width || !height) {
      issues.push({ code: 'UNREADABLE_IMAGE', severity: 'critical', message: 'image dimensions are unavailable' })
    } else {
      if (Math.min(width, height) < 512) {
        issues.push({ code: 'LOW_TECHNICAL_QUALITY', severity: 'major', message: 'short edge is below 512 pixels' })
      }
      if (targetRatio && actualAspectRatio && Math.abs(actualAspectRatio - targetRatio) / targetRatio > 0.08) {
        issues.push({ code: 'ASPECT_RATIO_MISMATCH', severity: 'major', message: 'image aspect ratio differs from target' })
      }
    }
    return {
      candidateIndex,
      readable: !issues.some((issue) => issue.code === 'EMPTY_IMAGE' || issue.code === 'UNREADABLE_IMAGE'),
      byteLength,
      width,
      height,
      actualAspectRatio,
      contentHash: createHash('sha256').update(resource.bytes).digest('hex'),
      issues,
    } satisfies VisualTechnicalCheck
  } catch (error) {
    return {
      candidateIndex,
      readable: false,
      byteLength: 0,
      width: null,
      height: null,
      actualAspectRatio: null,
      contentHash: null,
      issues: [{
        code: 'UNREADABLE_IMAGE',
        severity: 'critical',
        message: error instanceof Error ? error.message : String(error),
      }],
    } satisfies VisualTechnicalCheck
  }
}

export async function inspectVisualCandidates(
  candidateUrls: string[],
  aspectRatio: string,
): Promise<VisualTechnicalCheck[]> {
  const targetRatio = parseAspectRatio(aspectRatio)
  const checks = await Promise.all(candidateUrls.map(
    async (url, index) => await inspectCandidate(url, index, targetRatio),
  ))
  const firstIndexByHash = new Map<string, number>()
  for (const check of checks) {
    if (!check.contentHash) continue
    const firstIndex = firstIndexByHash.get(check.contentHash)
    if (firstIndex === undefined) {
      firstIndexByHash.set(check.contentHash, check.candidateIndex)
      continue
    }
    check.issues.push({
      code: 'DUPLICATE_CANDIDATE',
      severity: 'major',
      message: `candidate duplicates candidate ${firstIndex}`,
    })
  }
  return checks
}
