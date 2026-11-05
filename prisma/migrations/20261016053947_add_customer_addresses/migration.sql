-- CreateTable
CREATE TABLE `Address` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `customerId` INTEGER NOT NULL,
    `fullName` VARCHAR(200) NOT NULL,
    `phone` VARCHAR(32) NOT NULL,
    `addressLine1` VARCHAR(500) NOT NULL,
    `addressLine2` VARCHAR(500) NULL,
    `landmark` VARCHAR(200) NULL,
    `locality` VARCHAR(200) NULL,
    `city` VARCHAR(120) NOT NULL,
    `state` VARCHAR(120) NOT NULL,
    `postalCode` VARCHAR(20) NOT NULL,
    `country` CHAR(2) NOT NULL DEFAULT 'IN',
    `label` VARCHAR(50) NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Address_customerId_idx`(`customerId`),
    INDEX `Address_customerId_isDefault_idx`(`customerId`, `isDefault`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Address` ADD CONSTRAINT `Address_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
