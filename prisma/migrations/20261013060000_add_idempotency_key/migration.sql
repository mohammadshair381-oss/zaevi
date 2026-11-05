-- Add idempotency columns to Order table
ALTER TABLE `Order` ADD COLUMN `idempotencyKey` VARCHAR(64) NULL;
ALTER TABLE `Order` ADD COLUMN `idempotencyHash` VARCHAR(64) NULL;
CREATE UNIQUE INDEX `Order_idempotencyKey_key` ON `Order` (`idempotencyKey`);