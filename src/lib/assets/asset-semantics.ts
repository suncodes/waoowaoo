export type VisualAssetKind = 'character' | 'location' | 'prop'

export type AssetSemanticType =
  | 'person'
  | 'interior_location'
  | 'exterior_location'
  | 'vehicle'
  | 'book'
  | 'weapon'
  | 'tool'
  | 'symbol'
  | 'magic_item'
  | 'creature'
  | 'device'
  | 'generic_object'

export type AssetTier = 'hero' | 'recurring' | 'supporting' | 'one_off'

export type AssetUsageScope =
  | 'identity_lock'
  | 'environment_plate'
  | 'prop_detail'
  | 'style_only'

function normalizeText(...values: Array<string | null | undefined>): string {
  return values
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase()
}

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text))
}

const VEHICLE_PATTERNS = [
  /潜水艇|潜艇|船体|舰船|飞船|飞艇|列车|火车|汽车|马车|载具|vehicle|submarine|ship|vessel|train|car|spaceship|airship/iu,
]

const BOOK_PATTERNS = [
  /书封|封面|书籍|实体书|书本|书页|book|cover|novel/iu,
]

const WEAPON_PATTERNS = [
  /武器|枪|剑|刀|炮|弩|weapon|gun|sword|cannon|blade/iu,
]

const TOOL_PATTERNS = [
  /工具|钥匙|罗盘|地图|仪表|望远镜|tool|key|map|compass|instrument|telescope/iu,
]

const SYMBOL_PATTERNS = [
  /标志|标识|徽章|纹章|符号|图案|logo|emblem|badge|symbol|motif|pattern/iu,
]

const CREATURE_PATTERNS = [
  /怪物|巨兽|生物|海怪|动物|creature|monster|beast|animal/iu,
]

const DEVICE_PATTERNS = [
  /装置|机器|机关|设备|引擎|仪器|device|machine|engine|mechanism|apparatus/iu,
]

const INTERIOR_PATTERNS = [
  /内部|内景|舱室|房间|大厅|走廊|控制室|书房|interior|cabin|room|hall|corridor|control room/iu,
]

const EXTERIOR_PATTERNS = [
  /外部|外景|海底|深海|城市|街道|森林|岛屿|山谷|天空|exterior|undersea|deep sea|city|street|forest|island|valley|sky/iu,
]

export function inferAssetSemanticType(params: {
  assetKind: VisualAssetKind
  name: string
  description?: string | null
  explicitSemanticType?: string | null
}): AssetSemanticType {
  const explicit = params.explicitSemanticType?.trim()
  if (
    explicit === 'person'
    || explicit === 'interior_location'
    || explicit === 'exterior_location'
    || explicit === 'vehicle'
    || explicit === 'book'
    || explicit === 'weapon'
    || explicit === 'tool'
    || explicit === 'symbol'
    || explicit === 'magic_item'
    || explicit === 'creature'
    || explicit === 'device'
    || explicit === 'generic_object'
  ) {
    return explicit
  }

  if (params.assetKind === 'character') return 'person'

  const text = normalizeText(params.name, params.description)
  if (params.assetKind === 'location') {
    if (hasAny(text, INTERIOR_PATTERNS)) return 'interior_location'
    if (hasAny(text, EXTERIOR_PATTERNS)) return 'exterior_location'
    return 'exterior_location'
  }

  if (hasAny(text, VEHICLE_PATTERNS)) return 'vehicle'
  if (hasAny(text, BOOK_PATTERNS)) return 'book'
  if (hasAny(text, WEAPON_PATTERNS)) return 'weapon'
  if (hasAny(text, TOOL_PATTERNS)) return 'tool'
  if (hasAny(text, SYMBOL_PATTERNS)) return 'symbol'
  if (hasAny(text, CREATURE_PATTERNS)) return 'creature'
  if (hasAny(text, DEVICE_PATTERNS)) return 'device'

  return 'generic_object'
}

export function inferAssetTier(params: {
  importance?: 'core' | 'supporting' | null
  sourceUnitIds?: string[]
  usedByPanels?: string[]
  explicitAssetTier?: string | null
}): AssetTier {
  const explicit = params.explicitAssetTier?.trim()
  if (explicit === 'hero' || explicit === 'recurring' || explicit === 'supporting' || explicit === 'one_off') {
    return explicit
  }
  if (params.importance === 'core') return 'hero'
  const usageCount = new Set([...(params.sourceUnitIds || []), ...(params.usedByPanels || [])]).size
  if (usageCount >= 2) return 'recurring'
  if (usageCount === 1 || params.importance === 'supporting') return 'supporting'
  return 'one_off'
}

export function inferAssetUsageScope(params: {
  assetKind: VisualAssetKind
  semanticType: AssetSemanticType
  explicitUsageScope?: string | null
}): AssetUsageScope {
  const explicit = params.explicitUsageScope?.trim()
  if (
    explicit === 'identity_lock'
    || explicit === 'environment_plate'
    || explicit === 'prop_detail'
    || explicit === 'style_only'
  ) {
    return explicit
  }
  if (params.assetKind === 'character') return 'identity_lock'
  if (params.assetKind === 'location') return 'environment_plate'
  if (params.semanticType === 'symbol') return 'style_only'
  return 'prop_detail'
}

export function buildAssetMeta(params: {
  assetKind: VisualAssetKind
  name: string
  description?: string | null
  importance?: 'core' | 'supporting' | null
  sourceUnitIds?: string[]
  usedByPanels?: string[]
  explicitSemanticType?: string | null
  explicitAssetTier?: string | null
  explicitUsageScope?: string | null
}) {
  const semanticType = inferAssetSemanticType({
    assetKind: params.assetKind,
    name: params.name,
    description: params.description,
    explicitSemanticType: params.explicitSemanticType,
  })
  const assetTier = inferAssetTier({
    importance: params.importance,
    sourceUnitIds: params.sourceUnitIds,
    usedByPanels: params.usedByPanels,
    explicitAssetTier: params.explicitAssetTier,
  })
  const usageScope = inferAssetUsageScope({
    assetKind: params.assetKind,
    semanticType,
    explicitUsageScope: params.explicitUsageScope,
  })
  return {
    semanticType,
    assetTier,
    usageScope,
  }
}
