-- Additive CMS foundation tables.
-- This migration does not alter Product, ProductSize, Customer, Address, Order,
-- or OrderItem data. It does not add inventory or stock behavior.

CREATE TABLE `WebsiteSetting` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `siteName` VARCHAR(120) NOT NULL,
    `logoUrl` VARCHAR(1024) NULL,
    `faviconUrl` VARCHAR(1024) NULL,
    `primaryColor` CHAR(7) NOT NULL DEFAULT '#111111',
    `secondaryColor` CHAR(7) NOT NULL DEFAULT '#f5f5f3',
    `accentColor` CHAR(7) NOT NULL DEFAULT '#111111',
    `backgroundColor` CHAR(7) NOT NULL DEFAULT '#ffffff',
    `textColor` CHAR(7) NOT NULL DEFAULT '#111111',
    `headingFont` VARCHAR(80) NOT NULL DEFAULT 'Playfair Display',
    `bodyFont` VARCHAR(80) NOT NULL DEFAULT 'Inter',
    `headerLayout` VARCHAR(40) NOT NULL DEFAULT 'default',
    `footerLayout` VARCHAR(40) NOT NULL DEFAULT 'default',
    `announcementEnabled` BOOLEAN NOT NULL DEFAULT false,
    `announcementText` VARCHAR(240) NOT NULL DEFAULT '',
    `announcementLink` VARCHAR(1024) NOT NULL DEFAULT '',
    `socialLinks` JSON NULL,
    `defaultSeoTitle` VARCHAR(160) NULL,
    `defaultSeoDescription` VARCHAR(320) NULL,
    `themeTokens` JSON NULL,
    `updatedBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CmsPage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `slug` VARCHAR(80) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `seoTitle` VARCHAR(160) NULL,
    `seoDescription` VARCHAR(320) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'draft',
    `draftRevisionId` INTEGER NULL,
    `publishedRevisionId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CmsPage_slug_key`(`slug`),
    UNIQUE INDEX `CmsPage_draftRevisionId_key`(`draftRevisionId`),
    UNIQUE INDEX `CmsPage_publishedRevisionId_key`(`publishedRevisionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CmsPageRevision` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `pageId` INTEGER NOT NULL,
    `version` INTEGER NOT NULL,
    `snapshot` JSON NOT NULL,
    `createdBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `publishedAt` DATETIME(3) NULL,
    `note` VARCHAR(500) NULL,

    UNIQUE INDEX `CmsPageRevision_pageId_version_key`(`pageId`, `version`),
    INDEX `CmsPageRevision_pageId_createdAt_idx`(`pageId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `CmsPageRevision`
    ADD CONSTRAINT `CmsPageRevision_pageId_fkey`
    FOREIGN KEY (`pageId`) REFERENCES `CmsPage`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `CmsPageRevision`
    ADD CONSTRAINT `CmsPageRevision_createdBy_fkey`
    FOREIGN KEY (`createdBy`) REFERENCES `Customer`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `CmsPage`
    ADD CONSTRAINT `CmsPage_draftRevisionId_fkey`
    FOREIGN KEY (`draftRevisionId`) REFERENCES `CmsPageRevision`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `CmsPage`
    ADD CONSTRAINT `CmsPage_publishedRevisionId_fkey`
    FOREIGN KEY (`publishedRevisionId`) REFERENCES `CmsPageRevision`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `WebsiteSetting`
    ADD CONSTRAINT `WebsiteSetting_updatedBy_fkey`
    FOREIGN KEY (`updatedBy`) REFERENCES `Customer`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
