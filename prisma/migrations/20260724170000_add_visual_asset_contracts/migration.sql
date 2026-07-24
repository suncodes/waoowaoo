ALTER TABLE `novel_promotion_characters`
  ADD COLUMN `semanticType` VARCHAR(191) NULL,
  ADD COLUMN `assetTier` VARCHAR(191) NULL,
  ADD COLUMN `usageScope` VARCHAR(191) NULL,
  ADD COLUMN `assetMeta` JSON NULL;

ALTER TABLE `global_characters`
  ADD COLUMN `semanticType` VARCHAR(191) NULL,
  ADD COLUMN `assetTier` VARCHAR(191) NULL,
  ADD COLUMN `usageScope` VARCHAR(191) NULL,
  ADD COLUMN `assetMeta` JSON NULL;

ALTER TABLE `novel_promotion_locations`
  ADD COLUMN `semanticType` VARCHAR(191) NULL,
  ADD COLUMN `assetTier` VARCHAR(191) NULL,
  ADD COLUMN `usageScope` VARCHAR(191) NULL,
  ADD COLUMN `assetMeta` JSON NULL;

ALTER TABLE `global_locations`
  ADD COLUMN `semanticType` VARCHAR(191) NULL,
  ADD COLUMN `assetTier` VARCHAR(191) NULL,
  ADD COLUMN `usageScope` VARCHAR(191) NULL,
  ADD COLUMN `assetMeta` JSON NULL;

ALTER TABLE `novel_promotion_panels`
  ADD COLUMN `visualLicense` VARCHAR(191) NULL,
  ADD COLUMN `shotFunction` VARCHAR(191) NULL,
  ADD COLUMN `primarySubject` TEXT NULL,
  ADD COLUMN `continuityGroupId` VARCHAR(191) NULL,
  ADD COLUMN `generationRoute` VARCHAR(191) NULL,
  ADD COLUMN `noReferenceReason` VARCHAR(191) NULL,
  ADD COLUMN `promptSpec` JSON NULL,
  ADD COLUMN `referencePlan` JSON NULL;

CREATE TABLE `novel_promotion_asset_relations` (
  `id` VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NOT NULL,
  `fromType` VARCHAR(191) NOT NULL,
  `fromId` VARCHAR(191) NOT NULL,
  `toType` VARCHAR(191) NOT NULL,
  `toId` VARCHAR(191) NOT NULL,
  `relation` VARCHAR(191) NOT NULL,
  `reason` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `novel_promotion_asset_relations_projectId_idx`(`projectId`),
  INDEX `novel_promotion_asset_relations_fromType_fromId_idx`(`fromType`, `fromId`),
  INDEX `novel_promotion_asset_relations_toType_toId_idx`(`toType`, `toId`),
  UNIQUE INDEX `novel_promotion_asset_relations_unique_idx`(`projectId`, `fromType`, `fromId`, `toType`, `toId`, `relation`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `novel_promotion_asset_relations`
  ADD CONSTRAINT `novel_promotion_asset_relations_projectId_fkey`
  FOREIGN KEY (`projectId`) REFERENCES `novel_promotion_projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
