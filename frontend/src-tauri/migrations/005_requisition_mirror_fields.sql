-- Add V3 requisition mirror fields that preserve current JSON requisition-made data.
ALTER TABLE requisitions ADD COLUMN vendor_key TEXT;
ALTER TABLE requisitions ADD COLUMN vendor_name TEXT;
ALTER TABLE requisitions ADD COLUMN po_no TEXT;
ALTER TABLE requisitions ADD COLUMN total_cost NUMERIC;
ALTER TABLE requisitions ADD COLUMN requisition_type TEXT;
ALTER TABLE requisitions ADD COLUMN pdf_generated_at TEXT;
ALTER TABLE requisitions ADD COLUMN passed_at TEXT;
ALTER TABLE requisitions ADD COLUMN source_record_type TEXT;

ALTER TABLE requisition_lines ADD COLUMN source_line_id TEXT;
ALTER TABLE requisition_lines ADD COLUMN source_item_id TEXT;
ALTER TABLE requisition_lines ADD COLUMN item_name TEXT;
ALTER TABLE requisition_lines ADD COLUMN vendor_name TEXT;
ALTER TABLE requisition_lines ADD COLUMN unit_cost NUMERIC;
ALTER TABLE requisition_lines ADD COLUMN line_total_cost NUMERIC;
ALTER TABLE requisition_lines ADD COLUMN manual_line INTEGER NOT NULL DEFAULT 0 CHECK (manual_line IN (0, 1));

ALTER TABLE reorder_history ADD COLUMN source_requisition_id TEXT;
ALTER TABLE reorder_history ADD COLUMN source_line_id TEXT;
ALTER TABLE reorder_history ADD COLUMN source_item_id TEXT;
ALTER TABLE reorder_history ADD COLUMN source_vendor_id TEXT;
ALTER TABLE reorder_history ADD COLUMN item_name TEXT;
ALTER TABLE reorder_history ADD COLUMN vendor_name TEXT;
ALTER TABLE reorder_history ADD COLUMN po_no TEXT;
ALTER TABLE reorder_history ADD COLUMN description TEXT;
