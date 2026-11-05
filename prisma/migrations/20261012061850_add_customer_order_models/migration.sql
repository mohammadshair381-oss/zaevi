-- CreateTable
CREATE TABLE `Customer` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(255) NOT NULL,
    `name` VARCHAR(200) NULL,
    `phone` VARCHAR(32) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Customer_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Order` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reference` VARCHAR(32) NOT NULL,
    `customerId` INTEGER NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `currency` CHAR(3) NOT NULL DEFAULT 'INR',
    `subtotalMinor` INTEGER UNSIGNED NOT NULL,
    `totalMinor` INTEGER UNSIGNED NOT NULL,
    `contactEmail` VARCHAR(255) NOT NULL,
    `contactPhone` VARCHAR(32) NULL,
    `shippingName` VARCHAR(200) NULL,
    `shippingAddress` VARCHAR(500) NULL,
    `shippingCity` VARCHAR(120) NULL,
    `shippingPostalCode` VARCHAR(20) NULL,
    `shippingCountry` CHAR(2) NOT NULL DEFAULT 'IN',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Order_reference_key`(`reference`),
    INDEX `Order_customerId_idx`(`customerId`),
    INDEX `Order_status_idx`(`status`),
    INDEX `Order_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OrderItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `orderId` INTEGER NOT NULL,
    `productId` VARCHAR(32) NULL,
    `productSku` VARCHAR(32) NOT NULL,
    `productName` VARCHAR(200) NOT NULL,
    `size` VARCHAR(20) NULL,
    `unitPriceMinor` INTEGER UNSIGNED NOT NULL,
    `quantity` INTEGER UNSIGNED NOT NULL,
    `lineTotalMinor` INTEGER UNSIGNED NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `OrderItem_orderId_idx`(`orderId`),
    INDEX `OrderItem_productId_idx`(`productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderItem` ADD CONSTRAINT `OrderItem_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderItem` ADD CONSTRAINT `OrderItem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
