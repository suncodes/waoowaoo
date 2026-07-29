CREATE TABLE `novel_promotion_panel_speech_audios` (
  `id` VARCHAR(191) NOT NULL,
  `panelSpeechId` VARCHAR(191) NOT NULL,
  `audioUrl` TEXT NULL,
  `audioMediaId` VARCHAR(191) NULL,
  `audioDuration` INTEGER NULL,
  `voicePresetId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `novel_promotion_panel_speech_audios_panelSpeechId_key`
  ON `novel_promotion_panel_speech_audios` (`panelSpeechId`);

CREATE INDEX `novel_promotion_panel_speech_audios_audioMediaId_idx`
  ON `novel_promotion_panel_speech_audios` (`audioMediaId`);

ALTER TABLE `novel_promotion_panel_speech_audios`
  ADD CONSTRAINT `novel_promotion_panel_speech_audios_panelSpeechId_fkey`
  FOREIGN KEY (`panelSpeechId`) REFERENCES `novel_promotion_panel_speeches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `novel_promotion_panel_speech_audios`
  ADD CONSTRAINT `novel_promotion_panel_speech_audios_audioMediaId_fkey`
  FOREIGN KEY (`audioMediaId`) REFERENCES `media_objects`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
