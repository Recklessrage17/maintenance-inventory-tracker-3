ALTER TABLE requisitions ADD COLUMN cancelled_at TEXT;
ALTER TABLE requisitions ADD COLUMN cancelled_by TEXT;
ALTER TABLE requisitions ADD COLUMN cancel_reason TEXT;
