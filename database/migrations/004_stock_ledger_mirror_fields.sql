-- Add V3 stock ledger mirror fields that are not in the initial SQLite schema.
ALTER TABLE stock_ledger ADD COLUMN item_name TEXT;
ALTER TABLE stock_ledger ADD COLUMN item_description TEXT;
ALTER TABLE stock_ledger ADD COLUMN source_item_id TEXT;
ALTER TABLE stock_ledger ADD COLUMN vendor_name TEXT;
ALTER TABLE stock_ledger ADD COLUMN created_at TEXT;
ALTER TABLE stock_ledger ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1));
