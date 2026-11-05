-- Hash existing idempotencyKey values for secure at-rest storage
-- This migration converts any existing raw idempotency keys to their SHA-256 hashes.
-- Run this once after deploying the code that hashes incoming keys.
-- Safe to run multiple times: already-hashed keys (64-char hex) are idempotent.

-- Update only rows where idempotencyKey is non-null and not already a 64-char hex string
UPDATE `Order`
SET `idempotencyKey` = SHA2(`idempotencyKey`, 256)
WHERE `idempotencyKey` IS NOT NULL
  AND (LENGTH(`idempotencyKey`) <> 64 OR `idempotencyKey` NOT REGEXP '^[0-9a-f]{64}$');