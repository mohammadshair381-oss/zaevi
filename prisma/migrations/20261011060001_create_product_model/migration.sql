-- CreateTable
CREATE TABLE `Product` (
    `id` VARCHAR(32) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `category` VARCHAR(100) NOT NULL,
    `gender` VARCHAR(20) NOT NULL,
    `price` INTEGER UNSIGNED NOT NULL,
    `color` VARCHAR(50) NOT NULL,
    `imageUrl` VARCHAR(1024) NOT NULL,
    `hoverImageUrl` VARCHAR(1024) NOT NULL,
    `description` TEXT NOT NULL,
    `available` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Product_category_idx`(`category`),
    INDEX `Product_gender_idx`(`gender`),
    INDEX `Product_available_idx`(`available`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductSize` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `productId` VARCHAR(32) NOT NULL,
    `size` VARCHAR(20) NOT NULL,
    `position` INTEGER UNSIGNED NOT NULL,

    INDEX `ProductSize_productId_idx`(`productId`),
    UNIQUE INDEX `ProductSize_productId_size_key`(`productId`, `size`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ProductSize` ADD CONSTRAINT `ProductSize_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
