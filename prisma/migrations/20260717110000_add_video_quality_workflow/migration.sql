ALTER TABLE `novel_promotion_projects`
  ADD COLUMN `videoProfile` JSON NULL;

ALTER TABLE `novel_promotion_episodes`
  ADD COLUMN `creativeBrief` JSON NULL,
  ADD COLUMN `contentPlan` JSON NULL,
  ADD COLUMN `contentReview` JSON NULL,
  ADD COLUMN `directorTreatment` JSON NULL,
  ADD COLUMN `productionBible` JSON NULL;

ALTER TABLE `novel_promotion_panels`
  ADD COLUMN `visualType` VARCHAR(191) NULL,
  ADD COLUMN `renderMode` VARCHAR(191) NULL,
  ADD COLUMN `onScreenText` TEXT NULL,
  ADD COLUMN `sourceAnchor` JSON NULL,
  ADD COLUMN `visualQualityState` JSON NULL;
