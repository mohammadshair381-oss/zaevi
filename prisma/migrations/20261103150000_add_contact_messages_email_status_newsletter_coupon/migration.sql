-- Additive only: adds a table and nullable or defaulted columns, and one coupon row.

-- CreateTable
CREATE TABLE `ContactMessage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(120) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `orderReference` VARCHAR(40) NULL,
    `subject` VARCHAR(40) NOT NULL,
    `message` TEXT NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'new',
    `notifyStatus` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `notifyError` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ContactMessage_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `ContactMessage_email_idx`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable: record real email outcomes. New rows start as pending.
ALTER TABLE `Notification` ADD COLUMN `errorMessage` VARCHAR(500) NULL,
    ADD COLUMN `sentAt` DATETIME(3) NULL,
    MODIFY `status` VARCHAR(20) NOT NULL DEFAULT 'pending';

-- AlterTable: coupon eligibility rules.
ALTER TABLE `Coupon` ADD COLUMN `requiresNewsletter` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `perCustomerLimit` INTEGER UNSIGNED NULL;

-- The newsletter offer: 10% off, once per customer, for subscribers, until
-- 3 November 2027 23:59 IST, with 1,000 redemptions in total. All of these can be
-- changed from the admin Coupons tab or by SQL. An existing code is left untouched.
INSERT IGNORE INTO `Coupon`
    (`code`, `description`, `discountType`, `discountValue`, `minOrderMinor`, `expiresAt`, `usageLimit`, `perCustomerLimit`, `requiresNewsletter`, `isActive`, `updatedAt`)
VALUES
    ('ATELIER10', 'Newsletter welcome offer: 10% off one order', 'percentage', 10, 0, '2027-11-03 18:29:59.000', 1000, 1, true, true, CURRENT_TIMESTAMP(3));
