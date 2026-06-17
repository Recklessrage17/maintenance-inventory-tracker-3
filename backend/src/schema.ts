import Database from "better-sqlite3";

export function runMigrations(db: Database.Database) {
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      permissions_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      role_id TEXT REFERENCES roles(id) ON UPDATE CASCADE ON DELETE SET NULL,
      display_name TEXT NOT NULL,
      email TEXT UNIQUE,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS vendors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      contact_name TEXT,
      contact_email TEXT,
      phone TEXT,
      email TEXT,
      website TEXT,
      notes TEXT,
      is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      parent_location_id TEXT REFERENCES locations(id) ON UPDATE CASCADE ON DELETE SET NULL,
      notes TEXT,
      is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS inventory_items (
      id TEXT PRIMARY KEY,
      item_name TEXT NOT NULL,
      description TEXT,
      part_number TEXT,
      category TEXT,
      vendor_id TEXT REFERENCES vendors(id) ON UPDATE CASCADE ON DELETE SET NULL,
      location_id TEXT REFERENCES locations(id) ON UPDATE CASCADE ON DELETE SET NULL,
      stock_on_hand REAL NOT NULL DEFAULT 0,
      unit TEXT,
      minimum REAL NOT NULL DEFAULT 0,
      low_alert INTEGER NOT NULL DEFAULT 0 CHECK (low_alert IN (0, 1)),
      low_stock_alert_level REAL NOT NULL DEFAULT 0,
      cost NUMERIC,
      item_url TEXT,
      notes TEXT,
      image_placeholder TEXT,
      image_data_url TEXT,
      barcode_placeholder TEXT,
      order_placed INTEGER NOT NULL DEFAULT 0 CHECK (order_placed IN (0, 1)),
      reorder_hold INTEGER NOT NULL DEFAULT 0 CHECK (reorder_hold IN (0, 1)),
      order_requisition_id TEXT,
      hidden_from_watchlist INTEGER NOT NULL DEFAULT 0 CHECK (hidden_from_watchlist IN (0, 1)),
      non_stocked INTEGER NOT NULL DEFAULT 0 CHECK (non_stocked IN (0, 1)),
      is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS stock_ledger (
      id TEXT PRIMARY KEY,
      item_id TEXT REFERENCES inventory_items(id) ON UPDATE CASCADE ON DELETE SET NULL,
      source_item_id TEXT,
      item_name TEXT,
      item_description TEXT,
      part_number TEXT,
      vendor_name TEXT,
      action_type TEXT NOT NULL,
      old_quantity REAL NOT NULL DEFAULT 0,
      quantity_change REAL NOT NULL DEFAULT 0,
      new_quantity REAL NOT NULL DEFAULT 0,
      reason TEXT,
      used_by TEXT,
      notes TEXT,
      date_time TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      created_at TEXT,
      is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1))
    );

    CREATE TABLE IF NOT EXISTS requisitions (
      id TEXT PRIMARY KEY,
      requested_by TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      needed_by TEXT,
      notes TEXT,
      vendor_key TEXT,
      vendor_name TEXT,
      po_no TEXT,
      total_cost NUMERIC,
      requisition_type TEXT,
      pdf_generated_at TEXT,
      passed_at TEXT,
      source_record_type TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      submitted_at TEXT,
      fulfilled_at TEXT
    );

    CREATE TABLE IF NOT EXISTS requisition_lines (
      id TEXT PRIMARY KEY,
      requisition_id TEXT NOT NULL REFERENCES requisitions(id) ON UPDATE CASCADE ON DELETE CASCADE,
      item_id TEXT REFERENCES inventory_items(id) ON UPDATE CASCADE ON DELETE SET NULL,
      source_line_id TEXT,
      source_item_id TEXT,
      item_name TEXT,
      vendor_name TEXT,
      part_number TEXT,
      description TEXT,
      quantity_requested REAL NOT NULL DEFAULT 0,
      quantity_fulfilled REAL NOT NULL DEFAULT 0,
      unit TEXT,
      unit_cost NUMERIC,
      line_total_cost NUMERIC,
      manual_line INTEGER NOT NULL DEFAULT 0 CHECK (manual_line IN (0, 1)),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS reorder_history (
      id TEXT PRIMARY KEY,
      item_id TEXT REFERENCES inventory_items(id) ON UPDATE CASCADE ON DELETE SET NULL,
      vendor_id TEXT REFERENCES vendors(id) ON UPDATE CASCADE ON DELETE SET NULL,
      part_number TEXT,
      quantity_ordered REAL,
      unit_cost NUMERIC,
      total_cost NUMERIC,
      status TEXT NOT NULL DEFAULT 'planned',
      ordered_at TEXT,
      received_at TEXT,
      notes TEXT,
      source_requisition_id TEXT,
      source_line_id TEXT,
      source_item_id TEXT,
      source_vendor_id TEXT,
      item_name TEXT,
      vendor_name TEXT,
      po_no TEXT,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS deleted_records (
      id TEXT PRIMARY KEY,
      record_type TEXT NOT NULL,
      record_id TEXT NOT NULL,
      title TEXT,
      details TEXT,
      deleted_by TEXT,
      deleted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      expires_at TEXT,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      description TEXT,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      summary TEXT NOT NULL,
      actor TEXT,
      occurred_at TEXT NOT NULL,
      is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1))
    );

    CREATE TABLE IF NOT EXISTS app_snapshots (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      value_json TEXT,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_inventory_items_part_number ON inventory_items(part_number);
    CREATE INDEX IF NOT EXISTS idx_inventory_items_vendor_id ON inventory_items(vendor_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_items_location_id ON inventory_items(location_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_items_low_alert ON inventory_items(low_alert);
    CREATE INDEX IF NOT EXISTS idx_stock_ledger_item_id ON stock_ledger(item_id);
    CREATE INDEX IF NOT EXISTS idx_stock_ledger_date_time ON stock_ledger(date_time);
    CREATE INDEX IF NOT EXISTS idx_requisition_lines_requisition_id ON requisition_lines(requisition_id);
    CREATE INDEX IF NOT EXISTS idx_requisition_lines_item_id ON requisition_lines(item_id);
    CREATE INDEX IF NOT EXISTS idx_reorder_history_item_id ON reorder_history(item_id);
    CREATE INDEX IF NOT EXISTS idx_deleted_records_record ON deleted_records(record_type, record_id);
    CREATE INDEX IF NOT EXISTS idx_deleted_records_expires_at ON deleted_records(expires_at);
    CREATE INDEX IF NOT EXISTS idx_audit_log_occurred_at ON audit_log(occurred_at);

    INSERT OR IGNORE INTO metadata (key, value, value_json)
    VALUES
      ('schema_version', 'web-1', NULL),
      ('app_data_mode', 'sqlite-live-json-backup', '{"sqlite":"live app data","json":"backup export import restore","csv":"inventory import export"}');
  `);

  const inventoryColumns = db.prepare("PRAGMA table_info(inventory_items)").all() as Array<{ name: string }>;
  if (!inventoryColumns.some((column) => column.name === "hidden_from_watchlist")) {
    db.exec("ALTER TABLE inventory_items ADD COLUMN hidden_from_watchlist INTEGER NOT NULL DEFAULT 0 CHECK (hidden_from_watchlist IN (0, 1))");
  }
  if (!inventoryColumns.some((column) => column.name === "non_stocked")) {
    db.exec("ALTER TABLE inventory_items ADD COLUMN non_stocked INTEGER NOT NULL DEFAULT 0 CHECK (non_stocked IN (0, 1))");
  }
}
