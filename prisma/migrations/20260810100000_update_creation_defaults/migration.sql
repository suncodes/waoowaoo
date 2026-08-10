ALTER TABLE `novel_promotion_projects`
  ALTER COLUMN `videoRatio` SET DEFAULT '16:9',
  ALTER COLUMN `artStyle` SET DEFAULT 'classic-shanghai-animation';

ALTER TABLE `user_preferences`
  ALTER COLUMN `videoRatio` SET DEFAULT '16:9',
  ALTER COLUMN `artStyle` SET DEFAULT 'classic-shanghai-animation';
