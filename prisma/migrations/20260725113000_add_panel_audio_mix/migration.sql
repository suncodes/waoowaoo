ALTER TABLE `novel_promotion_panels`
  ADD COLUMN `audioMixedVideoUrl` TEXT NULL,
  ADD COLUMN `audioMixedVideoMediaId` VARCHAR(191) NULL;

CREATE INDEX `novel_promotion_panels_audioMixedVideoMediaId_idx`
  ON `novel_promotion_panels`(`audioMixedVideoMediaId`);

ALTER TABLE `novel_promotion_panels`
  ADD CONSTRAINT `novel_promotion_panels_audioMixedVideoMediaId_fkey`
  FOREIGN KEY (`audioMixedVideoMediaId`) REFERENCES `media_objects`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
