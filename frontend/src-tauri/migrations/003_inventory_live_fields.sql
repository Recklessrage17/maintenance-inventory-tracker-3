-- Add V3 inventory fields needed before inventory becomes SQLite live data.
ALTER TABLE inventory_items ADD COLUMN low_stock_alert_level REAL NOT NULL DEFAULT 0;
ALTER TABLE inventory_items ADD COLUMN item_url TEXT;
ALTER TABLE inventory_items ADD COLUMN image_placeholder TEXT;
ALTER TABLE inventory_items ADD COLUMN image_data_url TEXT;
ALTER TABLE inventory_items ADD COLUMN barcode_placeholder TEXT;
ALTER TABLE inventory_items ADD COLUMN order_requisition_id TEXT;
ALTER TABLE inventory_items ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1));
