-- CreateTable
CREATE TABLE `Payment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `orderId` INTEGER NOT NULL,
    `provider` VARCHAR(40) NOT NULL DEFAULT 'razorpay',
    `providerOrderId` VARCHAR(80) NULL,
    `providerPaymentId` VARCHAR(80) NULL,
    `amountMinor` INTEGER UNSIGNED NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'INR',
    `status` VARCHAR(30) NOT NULL DEFAULT 'created',
    `method` VARCHAR(40) NULL,
    `failureCode` VARCHAR(80) NULL,
    `failureDescription` VARCHAR(500) NULL,
    `capturedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Payment_providerOrderId_key`(`providerOrderId`),
    UNIQUE INDEX `Payment_providerPaymentId_key`(`providerPaymentId`),
    INDEX `Payment_orderId_createdAt_idx`(`orderId`, `createdAt`),
    INDEX `Payment_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PaymentEvent` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `paymentId` INTEGER NULL,
    `eventId` VARCHAR(120) NOT NULL,
    `eventType` VARCHAR(80) NOT NULL,
    `payload` TEXT NOT NULL,
    `processedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PaymentEvent_eventId_key`(`eventId`),
    INDEX `PaymentEvent_paymentId_idx`(`paymentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Refund` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `paymentId` INTEGER NOT NULL,
    `providerRefundId` VARCHAR(80) NULL,
    `amountMinor` INTEGER UNSIGNED NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'INR',
    `status` VARCHAR(30) NOT NULL DEFAULT 'created',
    `reason` VARCHAR(500) NULL,
    `failureCode` VARCHAR(80) NULL,
    `failureDescription` VARCHAR(500) NULL,
    `processedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Refund_providerRefundId_key`(`providerRefundId`),
    INDEX `Refund_paymentId_createdAt_idx`(`paymentId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PaymentEvent` ADD CONSTRAINT `PaymentEvent_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `Payment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Refund` ADD CONSTRAINT `Refund_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `Payment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
