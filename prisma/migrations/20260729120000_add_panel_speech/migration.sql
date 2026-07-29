CREATE TABLE `novel_promotion_panel_speeches` (
  `id` VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NOT NULL,
  `episodeId` VARCHAR(191) NOT NULL,
  `clipId` VARCHAR(191) NULL,
  `panelId` VARCHAR(191) NOT NULL,
  `speaker` VARCHAR(191) NOT NULL,
  `originalContent` TEXT NOT NULL,
  `deliveryContent` TEXT NULL,
  `sourceAnchor` JSON NULL,
  `targetDurationMs` INTEGER NULL,
  `estimatedDurationMs` INTEGER NULL,
  `emotionPrompt` TEXT NULL,
  `emotionStrength` DOUBLE NULL,
  `voiceConfigJson` JSON NULL,
  `warningsJson` JSON NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'ready',
  `source` VARCHAR(191) NOT NULL DEFAULT 'system',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `novel_promotion_panel_speeches_panelId_key`
  ON `novel_promotion_panel_speeches` (`panelId`);

CREATE INDEX `novel_promotion_panel_speeches_projectId_idx`
  ON `novel_promotion_panel_speeches` (`projectId`);

CREATE INDEX `novel_promotion_panel_speeches_episodeId_idx`
  ON `novel_promotion_panel_speeches` (`episodeId`);

CREATE INDEX `novel_promotion_panel_speeches_clipId_idx`
  ON `novel_promotion_panel_speeches` (`clipId`);

CREATE INDEX `novel_promotion_panel_speeches_status_idx`
  ON `novel_promotion_panel_speeches` (`status`);

ALTER TABLE `novel_promotion_panel_speeches`
  ADD CONSTRAINT `novel_promotion_panel_speeches_episodeId_fkey`
  FOREIGN KEY (`episodeId`) REFERENCES `novel_promotion_episodes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `novel_promotion_panel_speeches`
  ADD CONSTRAINT `novel_promotion_panel_speeches_clipId_fkey`
  FOREIGN KEY (`clipId`) REFERENCES `novel_promotion_clips`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `novel_promotion_panel_speeches`
  ADD CONSTRAINT `novel_promotion_panel_speeches_panelId_fkey`
  FOREIGN KEY (`panelId`) REFERENCES `novel_promotion_panels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
