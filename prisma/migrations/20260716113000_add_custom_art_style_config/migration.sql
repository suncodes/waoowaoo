ALTER TABLE `novel_promotion_projects`
  ADD COLUMN `artStyleMode` VARCHAR(191) NOT NULL DEFAULT 'preset',
  ADD COLUMN `customArtStyleReferenceImage` TEXT NULL;
