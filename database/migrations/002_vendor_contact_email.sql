-- Add the V2 vendor contactEmail field to the V3 SQLite vendor pilot.
ALTER TABLE vendors ADD COLUMN contact_email TEXT;
