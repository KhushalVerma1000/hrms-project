-- Store Managers can now be enrolled as Employee records (with a linked
-- MANAGER login) like Process Associates / Shift Incharges.
ALTER TYPE "Designation" ADD VALUE IF NOT EXISTS 'STORE_MANAGER';
