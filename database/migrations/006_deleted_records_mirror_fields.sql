-- Add V3 deleted-record mirror fields that preserve the current JSON trash shape.
ALTER TABLE deleted_records ADD COLUMN title TEXT;
ALTER TABLE deleted_records ADD COLUMN details TEXT;
ALTER TABLE deleted_records ADD COLUMN deleted_by TEXT;
