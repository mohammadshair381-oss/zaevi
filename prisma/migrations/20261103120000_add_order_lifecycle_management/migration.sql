-- AlterTable
ALTER TABLE `Order` ADD COLUMN `estimatedDispatchAt` DATETIME(3) NULL,
    ADD COLUMN `estimatedProductionCompleteAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `OrderStatusHistory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `orderId` INTEGER NOT NULL,
    `previousStatus` VARCHAR(20) NULL,
    `newStatus` VARCHAR(20) NOT NULL,
    `note` VARCHAR(500) NULL,
    `visibility` VARCHAR(20) NOT NULL DEFAULT 'customer',
    `changedBy` INTEGER NULL,
    `changedByEmail` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `OrderStatusHistory_orderId_createdAt_idx`(`orderId`, `createdAt`),
    INDEX `OrderStatusHistory_changedBy_idx`(`changedBy`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Shipment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `orderId` INTEGER NOT NULL,
    `type` VARCHAR(20) NOT NULL DEFAULT 'outbound',
    `carrier` VARCHAR(120) NULL,
    `trackingNumber` VARCHAR(120) NULL,
    `trackingUrl` VARCHAR(1024) NULL,
    `dispatchedAt` DATETIME(3) NULL,
    `estimatedDeliveryAt` DATETIME(3) NULL,
    `deliveredAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Shipment_orderId_type_idx`(`orderId`, `type`),
    INDEX `Shipment_trackingNumber_idx`(`trackingNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DeliveryEstimateConfig` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `productionDays` INTEGER NOT NULL DEFAULT 0,
    `qualityCheckDays` INTEGER NOT NULL DEFAULT 0,
    `packingDays` INTEGER NOT NULL DEFAULT 0,
    `shippingDays` INTEGER NOT NULL DEFAULT 0,
    `bufferDays` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedBy` INTEGER NULL,
    `updatedByEmail` VARCHAR(255) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CancellationRequest` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `orderId` INTEGER NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `idempotencyKey` VARCHAR(64) NULL,
    `requestedBy` INTEGER NULL,
    `requesterEmail` VARCHAR(255) NULL,
    `decidedBy` INTEGER NULL,
    `deciderEmail` VARCHAR(255) NULL,
    `decidedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CancellationRequest_orderId_key`(`orderId`),
    UNIQUE INDEX `CancellationRequest_idempotencyKey_key`(`idempotencyKey`),
    INDEX `CancellationRequest_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReturnRequest` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `orderId` INTEGER NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `refundStatus` VARCHAR(20) NOT NULL DEFAULT 'not_applicable',
    `idempotencyKey` VARCHAR(64) NULL,
    `requestedBy` INTEGER NULL,
    `requesterEmail` VARCHAR(255) NULL,
    `decidedBy` INTEGER NULL,
    `deciderEmail` VARCHAR(255) NULL,
    `decidedAt` DATETIME(3) NULL,
    `receivedAt` DATETIME(3) NULL,
    `returnShipmentId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ReturnRequest_idempotencyKey_key`(`idempotencyKey`),
    UNIQUE INDEX `ReturnRequest_returnShipmentId_key`(`returnShipmentId`),
    INDEX `ReturnRequest_orderId_status_idx`(`orderId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReturnItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `returnRequestId` INTEGER NOT NULL,
    `orderItemId` INTEGER NOT NULL,
    `quantity` INTEGER UNSIGNED NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ReturnItem_returnRequestId_idx`(`returnRequestId`),
    UNIQUE INDEX `ReturnItem_returnRequestId_orderItemId_key`(`returnRequestId`, `orderItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReplacementRequest` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `orderId` INTEGER NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `idempotencyKey` VARCHAR(64) NULL,
    `requestedBy` INTEGER NULL,
    `requesterEmail` VARCHAR(255) NULL,
    `decidedBy` INTEGER NULL,
    `deciderEmail` VARCHAR(255) NULL,
    `decidedAt` DATETIME(3) NULL,
    `replacementShipmentId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ReplacementRequest_idempotencyKey_key`(`idempotencyKey`),
    UNIQUE INDEX `ReplacementRequest_replacementShipmentId_key`(`replacementShipmentId`),
    INDEX `ReplacementRequest_orderId_status_idx`(`orderId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReplacementItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `replacementRequestId` INTEGER NOT NULL,
    `orderItemId` INTEGER NOT NULL,
    `quantity` INTEGER UNSIGNED NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ReplacementItem_replacementRequestId_idx`(`replacementRequestId`),
    UNIQUE INDEX `ReplacementItem_replacementRequestId_orderItemId_key`(`replacementRequestId`, `orderItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `OrderStatusHistory` ADD CONSTRAINT `OrderStatusHistory_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderStatusHistory` ADD CONSTRAINT `OrderStatusHistory_changedBy_fkey` FOREIGN KEY (`changedBy`) REFERENCES `Customer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Shipment` ADD CONSTRAINT `Shipment_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryEstimateConfig` ADD CONSTRAINT `DeliveryEstimateConfig_updatedBy_fkey` FOREIGN KEY (`updatedBy`) REFERENCES `Customer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CancellationRequest` ADD CONSTRAINT `CancellationRequest_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CancellationRequest` ADD CONSTRAINT `CancellationRequest_requestedBy_fkey` FOREIGN KEY (`requestedBy`) REFERENCES `Customer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CancellationRequest` ADD CONSTRAINT `CancellationRequest_decidedBy_fkey` FOREIGN KEY (`decidedBy`) REFERENCES `Customer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReturnRequest` ADD CONSTRAINT `ReturnRequest_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReturnRequest` ADD CONSTRAINT `ReturnRequest_requestedBy_fkey` FOREIGN KEY (`requestedBy`) REFERENCES `Customer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReturnRequest` ADD CONSTRAINT `ReturnRequest_decidedBy_fkey` FOREIGN KEY (`decidedBy`) REFERENCES `Customer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReturnRequest` ADD CONSTRAINT `ReturnRequest_returnShipmentId_fkey` FOREIGN KEY (`returnShipmentId`) REFERENCES `Shipment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReturnItem` ADD CONSTRAINT `ReturnItem_returnRequestId_fkey` FOREIGN KEY (`returnRequestId`) REFERENCES `ReturnRequest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReturnItem` ADD CONSTRAINT `ReturnItem_orderItemId_fkey` FOREIGN KEY (`orderItemId`) REFERENCES `OrderItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReplacementRequest` ADD CONSTRAINT `ReplacementRequest_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReplacementRequest` ADD CONSTRAINT `ReplacementRequest_requestedBy_fkey` FOREIGN KEY (`requestedBy`) REFERENCES `Customer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReplacementRequest` ADD CONSTRAINT `ReplacementRequest_decidedBy_fkey` FOREIGN KEY (`decidedBy`) REFERENCES `Customer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReplacementRequest` ADD CONSTRAINT `ReplacementRequest_replacementShipmentId_fkey` FOREIGN KEY (`replacementShipmentId`) REFERENCES `Shipment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReplacementItem` ADD CONSTRAINT `ReplacementItem_replacementRequestId_fkey` FOREIGN KEY (`replacementRequestId`) REFERENCES `ReplacementRequest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReplacementItem` ADD CONSTRAINT `ReplacementItem_orderItemId_fkey` FOREIGN KEY (`orderItemId`) REFERENCES `OrderItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

