import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { runMigrations } from "./schema.js";

const DB_PATH = process.env.MIT3_DB_PATH ?? path.resolve(process.cwd(), "data", "maintenance_inventory_3_web.db");
const SNAPSHOT_KEY = "app";

let dbInstance: Database.Database | null = null;

export type AppData = {
  app: "maintenance-inventory-tracker";
  version: string;
  lastSavedAt: string;
  items: unknown[];
  locations: unknown[];
  vendors: unknown[];
  stockChanges: unknown[];
  requisitionMadeRecords: unknown[];
  deletedRecords?: unknown[];
  auditLog: unknown[];
  settings: Record<string, unknown>;
};

function ensureParentFolder(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function getDatabase() {
  if (!dbInstance) {
    ensureParentFolder(DB_PATH);
    dbInstance = new Database(DB_PATH);
    dbInstance.pragma("journal_mode = WAL");
    dbInstance.pragma("foreign_keys = ON");
    runMigrations(dbInstance);
  }

  return dbInstance;
}

export function getDatabasePath() {
  return DB_PATH;
}

export function loadAppDataFromSqlite(): AppData | null {
  const db = getDatabase();
  const row = db
    .prepare("SELECT value_json FROM app_snapshots WHERE key = ? LIMIT 1")
    .get(SNAPSHOT_KEY) as { value_json: string } | undefined;

  return row ? (JSON.parse(row.value_json) as AppData) : null;
}

export function saveAppDataSnapshot(data: AppData, dbParam?: Database.Database) {
  const db = dbParam ?? getDatabase();
  const savedAt = new Date().toISOString();
  const snapshot = {
    ...data,
    lastSavedAt: data.lastSavedAt || savedAt,
    deletedRecords: data.deletedRecords ?? []
  };

  db.prepare(
    `INSERT INTO app_snapshots (key, value_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
  ).run(SNAPSHOT_KEY, JSON.stringify(snapshot), savedAt);

  db.prepare(
    `INSERT INTO app_settings (key, value_json, description, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
  ).run("app", JSON.stringify(snapshot.settings), "Current app settings", savedAt);

  return { savedAt };
}

export function saveNormalizedTablesFromAppData(data: AppData) {
  const db = getDatabase();
  const savedAt = new Date().toISOString();

  const tx = db.transaction(() => {
    // Save snapshot and app settings inside the same transaction for safety
    saveAppDataSnapshot(data, db);

    // Clear normalized mirror tables (Phase 1 delete-and-reinsert)
    const clearTables = [
      "requisition_lines",
      "requisitions",
      "stock_ledger",
      "inventory_items",
      "vendors",
      "locations",
      "deleted_records",
      "audit_log"
    ];

    for (const t of clearTables) {
      db.prepare(`DELETE FROM ${t}`).run();
    }

    // Prepare ID sets to protect foreign key inserts
    const vendorIdSet = new Set((Array.isArray(data.vendors) ? data.vendors : []).map((v: any) => v.id));
    const locationIdSet = new Set((Array.isArray(data.locations) ? data.locations : []).map((l: any) => l.id));
    const itemIdSet = new Set((Array.isArray(data.items) ? data.items : []).map((it: any) => it.id));

    // Insert vendors
    if (Array.isArray(data.vendors)) {
      const insertVendor = db.prepare(`
        INSERT INTO vendors (id, name, contact_name, contact_email, phone, email, website, notes, is_demo, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const v of data.vendors as any[]) {
          insertVendor.run(
          v.id,
          v.name,
          v.contactName ?? null,
          v.contactEmail ?? null,
          v.phone ?? null,
          v.email ?? null,
          v.website ?? null,
          v.notes ?? null,
          v.isDemo ? 1 : 0,
          v.createdAt ?? savedAt,
          v.updatedAt ?? savedAt
        );
      }
    }

    // Insert locations
    if (Array.isArray(data.locations)) {
      const insertLocation = db.prepare(`
        INSERT INTO locations (id, name, description, notes, is_demo, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (const l of data.locations as any[]) {
        insertLocation.run(
          l.id,
          l.name,
          l.description ?? null,
          l.notes ?? null,
          l.isDemo ? 1 : 0,
          l.createdAt ?? savedAt,
          l.updatedAt ?? savedAt
        );
      }
    }

    // Insert inventory items
    if (Array.isArray(data.items)) {
      const insertItem = db.prepare(`
        INSERT INTO inventory_items (id, item_name, description, part_number, category, vendor_id, location_id, stock_on_hand, unit, minimum, low_alert, low_stock_alert_level, cost, item_url, notes, image_placeholder, image_data_url, barcode_placeholder, order_placed, reorder_hold, order_requisition_id, is_demo, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const it of data.items as any[]) {
        const safeVendorId = it.vendorId && vendorIdSet.has(it.vendorId) ? it.vendorId : null;
        const safeLocationId = it.locationId && locationIdSet.has(it.locationId) ? it.locationId : null;

        insertItem.run(
          it.id,
          it.name,
          it.description ?? null,
          it.partNumber ?? null,
          it.category ?? null,
          safeVendorId,
          safeLocationId,
          typeof it.quantityOnHand === "number" ? it.quantityOnHand : 0,
          it.stockUnit ?? null,
          typeof it.minimumStockLevel === "number" ? it.minimumStockLevel : 0,
          (it.lowStockAlertLevel && it.lowStockAlertLevel > 0) ? 1 : 0,
          typeof it.lowStockAlertLevel === "number" ? it.lowStockAlertLevel : 0,
          it.costEach ?? null,
          it.itemUrl ?? null,
          it.notes ?? null,
          it.imagePlaceholder ?? null,
          it.imageDataUrl ?? null,
          it.barcodePlaceholder ?? null,
          it.orderPlaced ? 1 : 0,
          it.reorderHold ? 1 : 0,
          it.orderRequisitionId ?? null,
          it.isDemo ? 1 : 0,
          it.createdAt ?? savedAt,
          it.updatedAt ?? savedAt
        );
      }
    }

    // Insert stock ledger
    if (Array.isArray(data.stockChanges)) {
      const insertStock = db.prepare(`
        INSERT INTO stock_ledger (id, item_id, source_item_id, item_name, item_description, part_number, vendor_name, action_type, old_quantity, quantity_change, new_quantity, reason, used_by, notes, date_time, created_at, is_demo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const s of data.stockChanges as any[]) {
        const safeItemId = s.itemId && itemIdSet.has(s.itemId) ? s.itemId : null;

        insertStock.run(
          s.id,
          safeItemId,
          s.sourceItemId ?? null,
          s.itemNameSnapshot ?? s.itemName ?? null,
          s.itemDescription ?? null,
          s.partNumberSnapshot ?? s.partNumber ?? null,
          s.vendorNameSnapshot ?? null,
          s.actionType ?? null,
          typeof s.previousQuantity === "number" ? s.previousQuantity : 0,
          typeof s.quantity === "number" ? s.quantity : 0,
          typeof s.newQuantity === "number" ? s.newQuantity : 0,
          s.reason ?? null,
          s.actor ?? null,
          s.notes ?? null,
          s.occurredAt ?? s.date_time ?? savedAt,
          s.createdAt ?? savedAt,
          s.isDemo ? 1 : 0
        );
      }
    }

    // Insert requisitions and lines
    if (Array.isArray(data.requisitionMadeRecords)) {
      const insertReq = db.prepare(`
        INSERT INTO requisitions (id, requested_by, status, needed_by, notes, vendor_key, vendor_name, po_no, total_cost, requisition_type, pdf_generated_at, passed_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertLine = db.prepare(`
        INSERT INTO requisition_lines (id, requisition_id, item_id, source_item_id, item_name, vendor_name, part_number, description, quantity_requested, unit_cost, line_total_cost, manual_line, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const r of data.requisitionMadeRecords as any[]) {
        insertReq.run(
          r.id,
          r.createdBy ?? r.requisitionedBy ?? null,
          r.status ?? "Made",
          r.neededBy ?? null,
          r.comments ?? r.notes ?? null,
          r.vendorKey ?? null,
          r.vendorName ?? null,
          r.poNo ?? r.po_no ?? null,
          r.totalCost ?? null,
          r.requisitionType ?? r.requisition_type ?? null,
          r.pdfGeneratedAt ?? null,
          r.passedAt ?? null,
          r.createdAt ?? savedAt,
          r.createdAt ?? savedAt
        );

        if (Array.isArray(r.itemSnapshots)) {
          for (let i = 0; i < r.itemSnapshots.length; i++) {
            const s = r.itemSnapshots[i];
            const lineId = `${r.id}-${i}`;
            const safeLineItemId = s.itemId && itemIdSet.has(s.itemId) ? s.itemId : null;

            insertLine.run(
              lineId,
              r.id,
              safeLineItemId,
              s.itemId ?? null,
              s.itemName ?? null,
              r.vendorName ?? s.vendorName ?? null,
              s.partNumber ?? null,
              s.itemName ?? null,
              typeof s.quantityRequested === "number" ? s.quantityRequested : (s.quantityRequested ?? 0),
              s.unitCost ?? null,
              s.totalCost ?? null,
              0,
              null,
              r.createdAt ?? savedAt,
              r.createdAt ?? savedAt
            );
          }
        }
      }
    }

    // Insert deleted records
    if (Array.isArray(data.deletedRecords)) {
      const insertDel = db.prepare(`
        INSERT INTO deleted_records (id, record_type, record_id, title, details, deleted_by, deleted_at, expires_at, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const d of data.deletedRecords as any[]) {
        insertDel.run(
          d.id,
          d.type ?? null,
          d.originalId ?? d.recordId ?? null,
          d.title ?? null,
          d.details ?? null,
          d.actor ?? null,
          d.deletedAt ?? savedAt,
          d.expiresAt ?? null,
          JSON.stringify(d.payload ?? null)
        );
      }
    }

    // Insert audit log
    if (Array.isArray(data.auditLog)) {
      const insertAudit = db.prepare(`
        INSERT INTO audit_log (id, entity_type, entity_id, action, summary, actor, occurred_at, is_demo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const a of data.auditLog as any[]) {
        insertAudit.run(
          a.id,
          a.entityType ?? a.entity_type ?? null,
          a.entityId ?? a.entity_id ?? null,
          a.action ?? null,
          a.summary ?? null,
          a.actor ?? null,
          a.occurredAt ?? a.occurred_at ?? savedAt,
          a.isDemo ? 1 : 0
        );
      }
    }
  });

  tx();

  return { savedAt, counts: getHealthCounts() };
}

export function getHealthCounts() {
  const db = getDatabase();
  const tables = [
    "vendors",
    "locations",
    "inventory_items",
    "stock_ledger",
    "requisitions",
    "requisition_lines",
    "deleted_records",
    "audit_log",
    "app_snapshots"
  ];

  return Object.fromEntries(
    tables.map((table) => {
      const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
      return [table, row.count];
    })
  );
}
