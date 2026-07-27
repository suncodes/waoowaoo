CREATE TABLE `novel_promotion_panel_speech_plans` (
  `id` VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NOT NULL,
  `episodeId` VARCHAR(191) NOT NULL,
  `clipId` VARCHAR(191) NULL,
  `panelId` VARCHAR(191) NOT NULL,
  `mode` VARCHAR(191) NOT NULL DEFAULT 'none',
  `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
  `linesJson` JSON NULL,
  `voiceConfigJson` JSON NULL,
  `timingJson` JSON NULL,
  `warningsJson` JSON NULL,
  `source` VARCHAR(191) NOT NULL DEFAULT 'system',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `novel_promotion_panel_speech_plans_panelId_key`
  ON `novel_promotion_panel_speech_plans` (`panelId`);

CREATE INDEX `novel_promotion_panel_speech_plans_projectId_idx`
  ON `novel_promotion_panel_speech_plans` (`projectId`);

CREATE INDEX `novel_promotion_panel_speech_plans_episodeId_idx`
  ON `novel_promotion_panel_speech_plans` (`episodeId`);

CREATE INDEX `novel_promotion_panel_speech_plans_clipId_idx`
  ON `novel_promotion_panel_speech_plans` (`clipId`);

CREATE INDEX `novel_promotion_panel_speech_plans_status_idx`
  ON `novel_promotion_panel_speech_plans` (`status`);

ALTER TABLE `novel_promotion_panel_speech_plans`
  ADD CONSTRAINT `novel_promotion_panel_speech_plans_episodeId_fkey`
  FOREIGN KEY (`episodeId`) REFERENCES `novel_promotion_episodes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `novel_promotion_panel_speech_plans`
  ADD CONSTRAINT `novel_promotion_panel_speech_plans_clipId_fkey`
  FOREIGN KEY (`clipId`) REFERENCES `novel_promotion_clips`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `novel_promotion_panel_speech_plans`
  ADD CONSTRAINT `novel_promotion_panel_speech_plans_panelId_fkey`
  FOREIGN KEY (`panelId`) REFERENCES `novel_promotion_panels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
