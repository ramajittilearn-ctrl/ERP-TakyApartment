BEGIN;
-- Reference lines must hold full DECIMAL(14,2) rent/display money and the sum of
-- up to twenty approved DECIMAL(14,3) physical-meter segments without coercion.
-- Widening is value-preserving; the authoritative invoice total remains 14,2.
ALTER TABLE "InvoiceItem" ALTER COLUMN quantity TYPE DECIMAL(17,3), ALTER COLUMN "unitPrice" TYPE DECIMAL(16,4);
COMMIT;
