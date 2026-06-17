-- Persist Dashboard Watch List visibility independently from reorder state.
ALTER TABLE inventory_items ADD COLUMN hidden_from_watchlist INTEGER NOT NULL DEFAULT 0 CHECK (hidden_from_watchlist IN (0, 1));
