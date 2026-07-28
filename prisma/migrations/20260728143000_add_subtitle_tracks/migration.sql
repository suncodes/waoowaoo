CREATE TABLE `novel_promotion_subtitle_tracks` (
  `id` VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NOT NULL,
  `episodeId` VARCHAR(191) NOT NULL,
  `sourceVideoHash` VARCHAR(64) NOT NULL,
  `sourceSpeechHash` VARCHAR(64) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'ready',
  `timingSource` VARCHAR(191) NOT NULL DEFAULT 'panel',
  `styleJson` JSON NULL,
  `cuesJson` JSON NOT NULL,
  `warningsJson` JSON NULL,
  `srtStorageKey` VARCHAR(512) NULL,
  `assStorageKey` VARCHAR(512) NULL,
  `burnedVideoStorageKey` VARCHAR(512) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `np_subtitle_tracks_episode_video_speech_key`
  ON `novel_promotion_subtitle_tracks` (`episodeId`, `sourceVideoHash`, `sourceSpeechHash`);

CREATE INDEX `novel_promotion_subtitle_tracks_projectId_idx`
  ON `novel_promotion_subtitle_tracks` (`projectId`);

CREATE INDEX `novel_promotion_subtitle_tracks_episodeId_idx`
  ON `novel_promotion_subtitle_tracks` (`episodeId`);

CREATE INDEX `novel_promotion_subtitle_tracks_status_idx`
  ON `novel_promotion_subtitle_tracks` (`status`);

ALTER TABLE `novel_promotion_subtitle_tracks`
  ADD CONSTRAINT `novel_promotion_subtitle_tracks_episodeId_fkey`
  FOREIGN KEY (`episodeId`) REFERENCES `novel_promotion_episodes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
