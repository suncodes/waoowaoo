ALTER TABLE `novel_promotion_panels`
  ADD COLUMN `timelineStartMs` INTEGER NULL,
  ADD COLUMN `timelineEndMs` INTEGER NULL,
  ADD COLUMN `targetDurationMs` INTEGER NULL;

ALTER TABLE `novel_promotion_voice_lines`
  ADD COLUMN `estimatedDurationMs` INTEGER NULL,
  ADD COLUMN `timelineStartMs` INTEGER NULL,
  ADD COLUMN `timelineEndMs` INTEGER NULL;

CREATE TABLE `novel_promotion_panel_voice_spans` (
  `id` VARCHAR(191) NOT NULL,
  `episodeId` VARCHAR(191) NOT NULL,
  `panelId` VARCHAR(191) NOT NULL,
  `voiceLineId` VARCHAR(191) NOT NULL,
  `startMs` INTEGER NOT NULL,
  `endMs` INTEGER NOT NULL,
  `voiceStartMs` INTEGER NOT NULL,
  `voiceEndMs` INTEGER NOT NULL,
  `segmentText` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `np_panel_voice_spans_panel_line_start_end_key`
  ON `novel_promotion_panel_voice_spans` (`panelId`, `voiceLineId`, `startMs`, `endMs`);

CREATE INDEX `novel_promotion_panels_timelineStartMs_idx`
  ON `novel_promotion_panels` (`timelineStartMs`);

CREATE INDEX `novel_promotion_voice_lines_timelineStartMs_idx`
  ON `novel_promotion_voice_lines` (`timelineStartMs`);

CREATE INDEX `novel_promotion_panel_voice_spans_episodeId_idx`
  ON `novel_promotion_panel_voice_spans` (`episodeId`);

CREATE INDEX `novel_promotion_panel_voice_spans_panelId_idx`
  ON `novel_promotion_panel_voice_spans` (`panelId`);

CREATE INDEX `novel_promotion_panel_voice_spans_voiceLineId_idx`
  ON `novel_promotion_panel_voice_spans` (`voiceLineId`);

CREATE INDEX `novel_promotion_panel_voice_spans_startMs_idx`
  ON `novel_promotion_panel_voice_spans` (`startMs`);

ALTER TABLE `novel_promotion_panel_voice_spans`
  ADD CONSTRAINT `novel_promotion_panel_voice_spans_episodeId_fkey`
  FOREIGN KEY (`episodeId`) REFERENCES `novel_promotion_episodes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `novel_promotion_panel_voice_spans`
  ADD CONSTRAINT `novel_promotion_panel_voice_spans_panelId_fkey`
  FOREIGN KEY (`panelId`) REFERENCES `novel_promotion_panels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `novel_promotion_panel_voice_spans`
  ADD CONSTRAINT `novel_promotion_panel_voice_spans_voiceLineId_fkey`
  FOREIGN KEY (`voiceLineId`) REFERENCES `novel_promotion_voice_lines`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
