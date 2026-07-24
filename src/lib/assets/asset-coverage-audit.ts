import type { VisualAssetRef, VisualUnit } from '@/lib/visual-planning'
import {
  inferAssetSemanticType,
  type AssetSemanticType,
  type VisualAssetKind,
} from './asset-semantics'

export type AssetCoverageStatus =
  | 'covered'
  | 'covered_by_wrong_type'
  | 'missing'
  | 'one_off_allowed'

export type AssetCoverageSeverity = 'blocking' | 'warning' | 'info'

export interface AssetCoverageAuditAsset {
  id: string
  kind: VisualAssetKind
  name: string
  summary?: string | null
  semanticType?: string | null
  assetTier?: string | null
  usageScope?: string | null
}

export interface AssetCoverageAuditItem {
  panelId: string
  clipId: string
  primarySubject: string
  expectedKind: VisualAssetKind | 'abstract'
  expectedSemanticType?: AssetSemanticType
  matchedAssetId?: string
  matchedAssetName?: string
  matchedAssetKind?: VisualAssetKind
  matchedAssetSemanticType?: AssetSemanticType
  coverageStatus: AssetCoverageStatus
  severity: AssetCoverageSeverity
  suggestedAction: 'continue' | 'create_asset' | 'change_binding' | 'mark_one_off'
  reason: string
}

export interface MissingAssetRequest {
  name: string
  expectedKind: VisualAssetKind
  expectedSemanticType?: AssetSemanticType
  sourcePanelIds: string[]
  sourceClipIds: string[]
  reason: string
  severity: AssetCoverageSeverity
}

export interface AssetRelationSuggestion {
  fromType: VisualAssetKind
  fromId: string
  toType: VisualAssetKind
  toId: string
  relation: 'part_of' | 'contains' | 'not_equivalent' | 'visual_variant_of'
  reason: string
}

export interface AssetCoverageAuditResult {
  schemaVersion: 1
  targetId: string
  status: 'passed' | 'warning' | 'blocking'
  items: AssetCoverageAuditItem[]
  missingAssetRequests: MissingAssetRequest[]
  relationSuggestions: AssetRelationSuggestion[]
  summary: {
    totalPanels: number
    covered: number
    missing: number
    wrongType: number
    oneOffAllowed: number
    blocking: number
  }
  generatedAt: string
}

function normalizeText(...values: Array<string | null | undefined>): string {
  return values
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, '')
}

function compactName(value: string): string {
  return normalizeText(value)
    .replace(/(的)?(内部|内景|舱室|房间|大厅|走廊|控制室|本体|外观|主体|封面|书封)$/iu, '')
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function splitAliases(name: string): string[] {
  const base = name.toLowerCase().trim()
  return uniqueStrings([
    base,
    compactName(base),
    ...base.split(/[\/|,，、：《》"“”'’‘\s]+/u),
  ]).filter((item) => item.length >= 2)
}

function textMentionsName(text: string, name: string): boolean {
  const normalized = normalizeText(text)
  return splitAliases(name).some((alias) => normalized.includes(normalizeText(alias)))
}

function readUnitText(unit: VisualUnit): string {
  return JSON.stringify({
    description: unit.description,
    imagePrompt: unit.imagePrompt,
    videoPrompt: unit.videoPrompt,
    visualType: unit.visualType,
    renderMode: unit.renderMode,
    primarySubject: unit.shotSpec.primarySubject,
    subjectIdentity: unit.shotSpec.subjectIdentity,
    promptBlueprint: unit.shotSpec.promptBlueprint,
  })
}

function semanticForAsset(asset: AssetCoverageAuditAsset): AssetSemanticType {
  return inferAssetSemanticType({
    assetKind: asset.kind,
    name: asset.name,
    description: asset.summary,
    explicitSemanticType: asset.semanticType,
  })
}

function inferExpectedSemanticType(primarySubject: string, unit: VisualUnit): AssetSemanticType | undefined {
  const text = normalizeText(primarySubject, readUnitText(unit))
  if (/(潜水艇|潜艇|船体|舰船|飞船|飞艇|列车|火车|汽车|马车|载具|vehicle|submarine|ship|vessel|train|car|spaceship)/iu.test(text)) return 'vehicle'
  if (/(书封|封面|书籍|实体书|书本|book|cover|novel)/iu.test(text)) return 'book'
  if (/(标志|徽章|纹章|符号|图案|logo|emblem|badge|symbol|motif)/iu.test(text)) return 'symbol'
  if (/(装置|机器|机关|设备|引擎|device|machine|engine)/iu.test(text)) return 'device'
  if (/(武器|枪|剑|刀|炮|weapon|gun|sword|cannon)/iu.test(text)) return 'weapon'
  if (/(工具|钥匙|罗盘|地图|仪表|tool|key|map|compass|instrument)/iu.test(text)) return 'tool'
  if (/(内部|内景|舱室|房间|大厅|走廊|控制室|interior|cabin|room|hall|corridor)/iu.test(text)) return 'interior_location'
  if (/(海底|深海|城市|街道|森林|岛屿|山谷|外景|undersea|city|street|forest|island|valley)/iu.test(text)) return 'exterior_location'
  return undefined
}

function inferExpectedKind(
  primarySubject: string,
  unit: VisualUnit,
  expectedSemanticType?: AssetSemanticType,
): VisualAssetKind | 'abstract' {
  if (unit.renderMode === 'text_card' || unit.visualType === 'kinetic_text' || unit.visualType === 'quote_card') return 'abstract'
  if (expectedSemanticType === 'interior_location' || expectedSemanticType === 'exterior_location') return 'location'
  if (expectedSemanticType) return 'prop'
  const text = normalizeText(primarySubject, readUnitText(unit))
  if (/(人物|角色|男人|女人|少年|少女|船长|教授|person|character|man|woman|captain|professor)/iu.test(text)) return 'character'
  return 'prop'
}

function isOneOffAllowed(unit: VisualUnit, primarySubject: string, expectedKind: VisualAssetKind | 'abstract'): boolean {
  if (expectedKind === 'abstract') return true
  if (unit.renderMode === 'text_card' || unit.visualType === 'quote_card' || unit.visualType === 'kinetic_text') return true
  if (unit.visualType === 'diagram' && !/(主体|本体|角色|载具|书封|封面|vehicle|character|book|cover)/iu.test(primarySubject)) return true
  return false
}

function assetMatchesSubject(asset: AssetCoverageAuditAsset, primarySubject: string, unit: VisualUnit): boolean {
  const text = normalizeText(primarySubject, readUnitText(unit))
  return textMentionsName(text, asset.name)
}

function isWrongType(params: {
  expectedKind: VisualAssetKind | 'abstract'
  expectedSemanticType?: AssetSemanticType
  asset: AssetCoverageAuditAsset
  assetSemanticType: AssetSemanticType
}): boolean {
  if (params.expectedKind === 'abstract') return false
  if (params.asset.kind !== params.expectedKind) {
    return true
  }
  if (
    params.expectedSemanticType
    && params.assetSemanticType !== params.expectedSemanticType
  ) {
    if (
      params.expectedSemanticType === 'vehicle'
      && params.assetSemanticType === 'interior_location'
    ) {
      return true
    }
    if (
      params.expectedSemanticType === 'interior_location'
      && params.assetSemanticType === 'vehicle'
    ) {
      return true
    }
  }
  return false
}

function findBestMatchedAsset(params: {
  unit: VisualUnit
  primarySubject: string
  availableAssets: AssetCoverageAuditAsset[]
}): AssetCoverageAuditAsset | null {
  const boundIds = new Set([
    ...(params.unit.assetRefs || []).map((asset) => asset.id),
    ...params.unit.shotSpec.visibleAssets.map((asset) => asset.id),
  ])
  const boundAssets = params.availableAssets.filter((asset) => boundIds.has(asset.id))
  return boundAssets.find((asset) => assetMatchesSubject(asset, params.primarySubject, params.unit))
    || params.availableAssets.find((asset) => assetMatchesSubject(asset, params.primarySubject, params.unit))
    || boundAssets[0]
    || null
}

function severityForMissing(unit: VisualUnit, expectedSemanticType?: AssetSemanticType): AssetCoverageSeverity {
  if (
    unit.shotSpec.shotFunction === 'hook'
    || unit.shotSpec.shotFunction === 'payoff'
    || expectedSemanticType === 'vehicle'
    || expectedSemanticType === 'book'
  ) {
    return 'blocking'
  }
  return 'warning'
}

function buildAuditItem(
  unit: VisualUnit,
  availableAssets: AssetCoverageAuditAsset[],
): AssetCoverageAuditItem {
  const primarySubject = unit.shotSpec.primarySubject || unit.description
  const expectedSemanticType = inferExpectedSemanticType(primarySubject, unit)
  const expectedKind = inferExpectedKind(primarySubject, unit, expectedSemanticType)
  const oneOffAllowed = isOneOffAllowed(unit, primarySubject, expectedKind)
  const matchedAsset = findBestMatchedAsset({ unit, primarySubject, availableAssets })
  const matchedSemanticType = matchedAsset ? semanticForAsset(matchedAsset) : undefined

  if (!matchedAsset) {
    return {
      panelId: unit.id,
      clipId: unit.clipId,
      primarySubject,
      expectedKind,
      ...(expectedSemanticType ? { expectedSemanticType } : {}),
      coverageStatus: oneOffAllowed ? 'one_off_allowed' : 'missing',
      severity: oneOffAllowed ? 'info' : severityForMissing(unit, expectedSemanticType),
      suggestedAction: oneOffAllowed ? 'mark_one_off' : 'create_asset',
      reason: oneOffAllowed
        ? '一次性抽象、文字卡或图表镜头允许不绑定稳定资产'
        : '主视觉主体没有匹配到可复用资产',
    }
  }

  const wrongType = matchedSemanticType
    ? isWrongType({
        expectedKind,
        expectedSemanticType,
        asset: matchedAsset,
        assetSemanticType: matchedSemanticType,
      })
    : false
  if (wrongType) {
    return {
      panelId: unit.id,
      clipId: unit.clipId,
      primarySubject,
      expectedKind,
      ...(expectedSemanticType ? { expectedSemanticType } : {}),
      matchedAssetId: matchedAsset.id,
      matchedAssetName: matchedAsset.name,
      matchedAssetKind: matchedAsset.kind,
      matchedAssetSemanticType: matchedSemanticType,
      coverageStatus: 'covered_by_wrong_type',
      severity: 'blocking',
      suggestedAction: 'change_binding',
      reason: '主主体需要的资产类型和已绑定资产不一致，不能用内部空间或环境资产替代本体资产',
    }
  }

  return {
    panelId: unit.id,
    clipId: unit.clipId,
    primarySubject,
    expectedKind,
    ...(expectedSemanticType ? { expectedSemanticType } : {}),
    matchedAssetId: matchedAsset.id,
    matchedAssetName: matchedAsset.name,
    matchedAssetKind: matchedAsset.kind,
    ...(matchedSemanticType ? { matchedAssetSemanticType: matchedSemanticType } : {}),
    coverageStatus: 'covered',
    severity: 'info',
    suggestedAction: 'continue',
    reason: '主视觉主体已有可复用资产支撑',
  }
}

function buildMissingAssetRequests(items: AssetCoverageAuditItem[]): MissingAssetRequest[] {
  const requests = new Map<string, MissingAssetRequest>()
  for (const item of items) {
    if (item.coverageStatus !== 'missing' || item.expectedKind === 'abstract') continue
    const key = `${item.expectedKind}:${normalizeText(item.primarySubject)}`
    const current = requests.get(key)
    if (current) {
      current.sourcePanelIds = uniqueStrings([...current.sourcePanelIds, item.panelId])
      current.sourceClipIds = uniqueStrings([...current.sourceClipIds, item.clipId])
      current.severity = current.severity === 'blocking' || item.severity === 'blocking' ? 'blocking' : 'warning'
      continue
    }
    requests.set(key, {
      name: item.primarySubject,
      expectedKind: item.expectedKind,
      ...(item.expectedSemanticType ? { expectedSemanticType: item.expectedSemanticType } : {}),
      sourcePanelIds: [item.panelId],
      sourceClipIds: [item.clipId],
      reason: item.reason,
      severity: item.severity,
    })
  }
  return [...requests.values()]
}

function areRelatedAssetNames(left: string, right: string): boolean {
  const a = compactName(left)
  const b = compactName(right)
  return Boolean(a && b && (a.includes(b) || b.includes(a)))
}

function buildRelationSuggestions(assets: AssetCoverageAuditAsset[]): AssetRelationSuggestion[] {
  const suggestions: AssetRelationSuggestion[] = []
  for (const left of assets) {
    const leftSemanticType = semanticForAsset(left)
    for (const right of assets) {
      if (left.id === right.id) continue
      const rightSemanticType = semanticForAsset(right)
      if (!areRelatedAssetNames(left.name, right.name)) continue
      if (leftSemanticType === 'interior_location' && rightSemanticType === 'vehicle') {
        suggestions.push({
          fromType: left.kind,
          fromId: left.id,
          toType: right.kind,
          toId: right.id,
          relation: 'part_of',
          reason: `${left.name} 是 ${right.name} 的内部空间，不能替代外观本体资产`,
        })
        suggestions.push({
          fromType: left.kind,
          fromId: left.id,
          toType: right.kind,
          toId: right.id,
          relation: 'not_equivalent',
          reason: '内部场景资产与载具本体资产在分镜绑定中不可互相替代',
        })
      }
      if (leftSemanticType === 'vehicle' && rightSemanticType === 'interior_location') {
        suggestions.push({
          fromType: left.kind,
          fromId: left.id,
          toType: right.kind,
          toId: right.id,
          relation: 'contains',
          reason: `${left.name} 可包含 ${right.name}，但两者用于不同镜头职责`,
        })
      }
    }
  }
  const seen = new Set<string>()
  return suggestions.filter((item) => {
    const key = `${item.fromType}:${item.fromId}:${item.toType}:${item.toId}:${item.relation}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function auditVisualAssetCoverage(params: {
  targetId: string
  visualUnits: VisualUnit[]
  assets: AssetCoverageAuditAsset[]
  generatedAt?: string
}): AssetCoverageAuditResult {
  const items = params.visualUnits.map((unit) => buildAuditItem(unit, params.assets))
  const missingAssetRequests = buildMissingAssetRequests(items)
  const relationSuggestions = buildRelationSuggestions(params.assets)
  const summary = {
    totalPanels: items.length,
    covered: items.filter((item) => item.coverageStatus === 'covered').length,
    missing: items.filter((item) => item.coverageStatus === 'missing').length,
    wrongType: items.filter((item) => item.coverageStatus === 'covered_by_wrong_type').length,
    oneOffAllowed: items.filter((item) => item.coverageStatus === 'one_off_allowed').length,
    blocking: items.filter((item) => item.severity === 'blocking').length,
  }
  return {
    schemaVersion: 1,
    targetId: params.targetId,
    status: summary.blocking > 0 ? 'blocking' : summary.missing + summary.wrongType > 0 ? 'warning' : 'passed',
    items,
    missingAssetRequests,
    relationSuggestions,
    summary,
    generatedAt: params.generatedAt || new Date().toISOString(),
  }
}

export function visualAssetRefFromCoverageAsset(asset: AssetCoverageAuditAsset): VisualAssetRef {
  return {
    id: asset.id,
    kind: asset.kind,
    name: asset.name,
  }
}
