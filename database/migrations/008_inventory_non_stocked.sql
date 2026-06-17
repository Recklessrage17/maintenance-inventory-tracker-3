-- Patch 7: Track reference/order-as-needed items separately from stocked inventory.
ALTER TABLE inventory_items ADD COLUMN non_stocked INTEGER NOT NULL DEFAULT 0 CHECK (non_stocked IN (0, 1));
