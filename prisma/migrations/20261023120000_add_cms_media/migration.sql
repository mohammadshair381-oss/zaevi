-- Additive CMS media metadata table.
-- Files are stored outside the project root and served through a controlled route.

CREATE TABLE `MediaAsset` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `storageKey` VARCHAR(160) NOT NULL,
    `url` VARCHAR(255) NOT NULL,
    `mimeType` VARCHAR(64) NOT NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `alt` VARCHAR(200) NULL,
    `sizeBytes` INTEGER UNSIGNED NOT NULL,
    `createdBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `MediaAsset_storageKey_key`(`storageKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `MediaAsset`
    ADD CONSTRAINT `MediaAsset_createdBy_fkey`
    FOREIGN KEY (`createdBy`) REFERENCES `Customer`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
