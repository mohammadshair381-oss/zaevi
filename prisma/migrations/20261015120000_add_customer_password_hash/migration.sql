-- Add passwordHash column to Customer table for authentication
-- Nullable for existing guest customers; non-null for registered accounts

ALTER TABLE `Customer` ADD COLUMN `passwordHash` VARCHAR(255) NULL;