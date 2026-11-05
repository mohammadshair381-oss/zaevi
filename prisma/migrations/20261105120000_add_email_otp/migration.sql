-- Email one-time codes for sign-up, sign-in and password reset.

-- AlterTable
ALTER TABLE `Customer` ADD COLUMN `emailVerifiedAt` DATETIME(3) NULL;

-- Accounts that already have a password stay usable, and their password cannot be
-- replaced by someone registering the same address again.
UPDATE `Customer` SET `emailVerifiedAt` = CURRENT_TIMESTAMP(3) WHERE `passwordHash` IS NOT NULL;

-- CreateTable
CREATE TABLE `EmailOtp` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `customerId` INTEGER NOT NULL,
    `purpose` VARCHAR(20) NOT NULL,
    `challengeHash` CHAR(64) NOT NULL,
    `codeHash` CHAR(64) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `sendCount` INTEGER NOT NULL DEFAULT 1,
    `lastSentAt` DATETIME(3) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `consumedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `EmailOtp_challengeHash_key`(`challengeHash`),
    INDEX `EmailOtp_customerId_purpose_idx`(`customerId`, `purpose`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `EmailOtp` ADD CONSTRAINT `EmailOtp_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
