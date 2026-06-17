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

export type AppDataLoadSource = "normalized" | "snapshot-fallback" | "none";

export type AppDataLoadResult = {
  data: AppData | null;
  normalizedLoadError?: string;
  normalizedLoadReady: boolean;
  source: AppDataLoadSource;
};

type SqliteScalar = string | number | null;

type VendorRow = {
  contact_email: string | null;
  contact_name: string | null;
  created_at: string;
  email: string | null;
  id: string;
  is_demo: SqliteScalar;
  name: string;
  notes: string | null;
  phone: string | null;
  updated_at: string;
  website: string | null;
};

type LocationRow = {
  created_at: string;
  description: string | null;
  id: string;
  is_demo: SqliteScalar;
  name: string;
  notes: string | null;
  updated_at: string;
};

type InventoryItemRow = {
  barcode_placeholder: string | null;
  category: string | null;
  cost: SqliteScalar;
  created_at: string;
  description: string | null;
  id: string;
  image_data_url: string | null;
  image_placeholder: string | null;
  hidden_from_watchlist: SqliteScalar;
  non_stocked: SqliteScalar;
  is_demo: SqliteScalar;
  item_name: string;
  item_url: string | null;
  location_id: string | null;
  low_stock_alert_level: SqliteScalar;
  minimum: SqliteScalar;
  notes: string | null;
  order_placed: SqliteScalar;
  order_requisition_id: string | null;
  part_number: string | null;
  reorder_hold: SqliteScalar;
  stock_on_hand: SqliteScalar;
  unit: string | null;
  updated_at: string;
  vendor_id: string | null;
};

type StockLedgerRow = {
  action_type: string;
  created_at: string | null;
  date_time: string;
  id: string;
  is_demo: SqliteScalar;
  item_id: string | null;
  item_name: string | null;
  new_quantity: SqliteScalar;
  notes: string | null;
  old_quantity: SqliteScalar;
  part_number: string | null;
  quantity_change: SqliteScalar;
  reason: string | null;
  source_item_id: string | null;
  used_by: string | null;
  vendor_name: string | null;
};

type RequisitionRow = {
  created_at: string;
  fulfilled_at: string | null;
  id: string;
  passed_at: string | null;
  pdf_generated_at: string | null;
  po_no: string | null;
  requested_by: string | null;
  requisition_type: string | null;
  status: string | null;
  submitted_at: string | null;
  total_cost: SqliteScalar;
  updated_at: string;
  vendor_key: string | null;
  vendor_name: string | null;
};

type RequisitionLineRow = {
  description: string | null;
  id: string;
  item_id: string | null;
  item_name: string | null;
  line_total_cost: SqliteScalar;
  part_number: string | null;
  quantity_requested: SqliteScalar;
  requisition_id: string;
  source_item_id: string | null;
  unit_cost: SqliteScalar;
};

type DeletedRecordRow = {
  deleted_at: string;
  deleted_by: string | null;
  details: string | null;
  expires_at: string | null;
  id: string;
  payload_json: string;
  record_id: string;
  record_type: string;
  title: string | null;
};

type AuditLogRow = {
  action: string;
  actor: string | null;
  entity_id: string;
  entity_type: string;
  id: string;
  is_demo: SqliteScalar;
  occurred_at: string;
  summary: string;
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

function nowIso() {
  return new Date().toISOString();
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function numberValue(value: SqliteScalar | undefined, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolFromSqlite(value: SqliteScalar | boolean | undefined) {
  return value === true || value === 1;
}

function textValue(value: unknown, fallback = "") {
  return value === undefined || value === null ? fallback : String(value);
}

function readJson<T>(value: string, fallback: T): T {
  try {
    const parsed = JSON.parse(value) as T;

    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function readSnapshotRow(db = getDatabase()) {
  return db
    .prepare("SELECT value_json, updated_at FROM app_snapshots WHERE key = ? LIMIT 1")
    .get(SNAPSHOT_KEY) as { updated_at: string; value_json: string } | undefined;
}

function loadAppDataSnapshot(db = getDatabase()): AppData | null {
  const row = readSnapshotRow(db);

  if (!row) {
    return null;
  }

  try {
    return JSON.parse(row.value_json) as AppData;
  } catch {
    return null;
  }
}

function createDefaultSettings(now = nowIso()): Record<string, unknown> {
  return {
    id: "appSettings",
    companyShopName: "JBT USA Maintenance",
    headerBadgeText: "Local-first maintenance inventory",
    defaultLocationId: "",
    lowStockWarningsEnabled: true,
    lowStockIncludeEqual: true,
    allowNegativeStockOverride: false,
    backupEnabled: false,
    backupInterval: "change",
    autoImportEnabled: true,
    backupDirectoryName: "",
    backupDirectoryPath: "",
    backupDirectoryHandle: null,
    csvExportFolderPath: "",
    csvAutoExportHistoryEnabled: false,
    csvLastExportAt: "",
    csvLastHistoryExportAt: "",
    customCategories: [],
    lastBackupTimestamp: "",
    lastAutoImportTimestamp: "",
    backupStatus: "Choose backup folder to enable auto backup and auto import.",
    watchListDefaultsMigratedAt: now,
    createdAt: now,
    updatedAt: now
  };
}

function loadSettingsFromNormalized(db: Database.Database, snapshot: AppData | null) {
  const row = db
    .prepare("SELECT value_json FROM app_settings WHERE key = ? LIMIT 1")
    .get("app") as { value_json: string } | undefined;

  if (row) {
    const parsed = readJson<Record<string, unknown> | null>(row.value_json, null);

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  }

  return snapshot?.settings ?? createDefaultSettings(snapshot?.lastSavedAt ?? nowIso());
}

function appDataShapeIsValid(data: AppData | null): data is AppData {
  return Boolean(
    data &&
      data.app === "maintenance-inventory-tracker" &&
      Array.isArray(data.items) &&
      Array.isArray(data.vendors) &&
      Array.isArray(data.locations) &&
      Array.isArray(data.stockChanges) &&
      Array.isArray(data.requisitionMadeRecords) &&
      Array.isArray(data.auditLog) &&
      data.settings &&
      typeof data.settings === "object"
  );
}

function normalizedDataIsSafeToUse(data: AppData | null, snapshot: AppData | null, counts: Record<string, number>) {
  if (!appDataShapeIsValid(data)) {
    return false;
  }

  return counts.inventory_items > 0 || counts.app_snapshots === 0 || !snapshot;
}

function vendorFromRow(row: VendorRow) {
  return {
    id: row.id,
    name: row.name,
    contactName: row.contact_name ?? "",
    contactEmail: row.contact_email ?? "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    website: row.website ?? "",
    notes: row.notes ?? "",
    isDemo: boolFromSqlite(row.is_demo),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function locationFromRow(row: LocationRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    notes: row.notes ?? "",
    isDemo: boolFromSqlite(row.is_demo),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function itemFromRow(row: InventoryItemRow) {
  return {
    id: row.id,
    name: row.item_name,
    partNumber: row.part_number ?? "",
    description: row.description ?? "",
    category: row.category ?? "Other",
    quantityOnHand: numberValue(row.stock_on_hand),
    stockUnit: row.unit ?? "each",
    minimumStockLevel: Math.max(0, numberValue(row.minimum)),
    lowStockAlertLevel: Math.max(0, numberValue(row.low_stock_alert_level)),
    locationId: row.location_id ?? "",
    vendorId: row.vendor_id ?? "",
    costEach: Math.max(0, numberValue(row.cost)),
    itemUrl: row.item_url ?? "",
    notes: row.notes ?? "",
    imagePlaceholder: row.image_placeholder ?? "",
    imageDataUrl: row.image_data_url ?? "",
    barcodePlaceholder: row.barcode_placeholder ?? "",
    reorderHold: boolFromSqlite(row.reorder_hold),
    orderPlaced: boolFromSqlite(row.order_placed),
    orderRequisitionId: row.order_requisition_id ?? undefined,
    hiddenFromWatchList: boolFromSqlite(row.hidden_from_watchlist),
    nonStocked: boolFromSqlite(row.non_stocked),
    isDemo: boolFromSqlite(row.is_demo),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function stockActionType(value: string) {
  return value === "Stock Out" || value === "Set Stock On Hand" ? value : "Stock In";
}

function stockChangeFromRow(row: StockLedgerRow) {
  return {
    id: row.id,
    itemId: row.source_item_id ?? row.item_id ?? "",
    itemNameSnapshot: row.item_name ?? "Unknown Item",
    partNumberSnapshot: row.part_number ?? "",
    vendorNameSnapshot: row.vendor_name ?? "",
    actionType: stockActionType(row.action_type),
    quantity: Math.abs(numberValue(row.quantity_change)),
    reason: row.reason ?? "",
    actor: row.used_by ?? "System",
    notes: row.notes ?? "",
    occurredAt: row.date_time,
    previousQuantity: numberValue(row.old_quantity),
    newQuantity: numberValue(row.new_quantity),
    isDemo: boolFromSqlite(row.is_demo),
    createdAt: row.created_at ?? row.date_time
  };
}

function requisitionType(value: string | null) {
  return value === "over100" ? "over100" : "under100";
}

function requisitionFromRows(row: RequisitionRow, lines: RequisitionLineRow[]) {
  const createdAt = row.created_at || row.passed_at || row.pdf_generated_at || nowIso();
  const itemSnapshots = lines.map((line) => {
    const quantityRequested = numberValue(line.quantity_requested);
    const unitCost = numberValue(line.unit_cost);

    return {
      itemId: line.source_item_id ?? line.item_id ?? "",
      itemName: line.item_name ?? line.description ?? line.part_number ?? "Unknown Item",
      partNumber: line.part_number ?? "",
      quantityRequested,
      unitCost,
      totalCost: numberValue(line.line_total_cost, quantityRequested * unitCost)
    };
  });

  return {
    id: row.id,
    vendorKey: row.vendor_key ?? "",
    vendorName: row.vendor_name ?? "Unassigned Vendor",
    createdAt,
    createdBy: row.requested_by ?? "",
    itemIds: itemSnapshots.map((snapshot) => snapshot.itemId),
    itemSnapshots,
    poNo: row.po_no ?? "",
    totalCost: numberValue(
      row.total_cost,
      itemSnapshots.reduce((total, snapshot) => total + snapshot.totalCost, 0)
    ),
    requisitionType: requisitionType(row.requisition_type),
    pdfGeneratedAt: row.pdf_generated_at ?? row.submitted_at ?? createdAt,
    passedAt: row.passed_at ?? row.fulfilled_at ?? createdAt,
    requisitionedBy: row.requested_by ?? "",
    status: "Made"
  };
}

function deletedRecordType(value: string) {
  return value === "Vendor" || value === "Location" ? value : "Inventory";
}

function fallbackDeletedRecordExpiresAt(deletedAt: string) {
  const deletedAtMs = new Date(deletedAt).getTime();

  return new Date((Number.isFinite(deletedAtMs) ? deletedAtMs : Date.now()) + 30 * 60 * 1000).toISOString();
}

function deletedRecordFromRow(row: DeletedRecordRow) {
  const payload = readJson<Record<string, unknown> | null>(row.payload_json, null);

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  return {
    id: row.id,
    originalId: row.record_id,
    type: deletedRecordType(row.record_type),
    title: row.title ?? textValue(payload.name, row.record_id),
    details: row.details ?? "",
    deletedAt: row.deleted_at,
    expiresAt: row.expires_at ?? fallbackDeletedRecordExpiresAt(row.deleted_at),
    actor: row.deleted_by ?? "User",
    payload
  };
}

function auditEntryFromRow(row: AuditLogRow) {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    summary: row.summary,
    actor: row.actor ?? "System",
    occurredAt: row.occurred_at,
    isDemo: boolFromSqlite(row.is_demo)
  };
}

export function loadAppDataFromNormalizedTables(snapshot: AppData | null = loadAppDataSnapshot()): AppData | null {
  const db = getDatabase();
  const vendors = (
    db.prepare(
      `SELECT id, name, contact_name, contact_email, phone, email, website, notes, is_demo, created_at, updated_at
       FROM vendors
       ORDER BY name ASC, id ASC`
    ).all() as VendorRow[]
  ).map(vendorFromRow);
  const locations = (
    db.prepare(
      `SELECT id, name, description, notes, is_demo, created_at, updated_at
       FROM locations
       ORDER BY name ASC, id ASC`
    ).all() as LocationRow[]
  ).map(locationFromRow);
  const items = (
    db.prepare(
      `SELECT id, item_name, description, part_number, category, vendor_id, location_id, stock_on_hand, unit, minimum,
        low_stock_alert_level, cost, item_url, notes, image_placeholder, image_data_url, barcode_placeholder,
        order_placed, reorder_hold, order_requisition_id, hidden_from_watchlist, non_stocked, is_demo, created_at, updated_at
       FROM inventory_items
       ORDER BY updated_at DESC, item_name ASC, id ASC`
    ).all() as InventoryItemRow[]
  ).map(itemFromRow);
  const stockChanges = (
    db.prepare(
      `SELECT id, item_id, source_item_id, item_name, part_number, vendor_name, action_type, old_quantity,
        quantity_change, new_quantity, reason, used_by, notes, date_time, created_at, is_demo
       FROM stock_ledger
       ORDER BY date_time DESC, created_at DESC, id ASC`
    ).all() as StockLedgerRow[]
  ).map(stockChangeFromRow);
  const requisitionRows = db.prepare(
    `SELECT id, requested_by, status, created_at, updated_at, submitted_at, fulfilled_at, vendor_key, vendor_name,
      po_no, total_cost, requisition_type, pdf_generated_at, passed_at
     FROM requisitions
     ORDER BY created_at DESC, id ASC`
  ).all() as RequisitionRow[];
  const requisitionLineRows = db.prepare(
    `SELECT id, requisition_id, item_id, source_item_id, item_name, part_number, description,
      quantity_requested, unit_cost, line_total_cost
     FROM requisition_lines
     ORDER BY requisition_id ASC, created_at ASC, id ASC`
  ).all() as RequisitionLineRow[];
  const linesByRequisitionId = new Map<string, RequisitionLineRow[]>();

  for (const line of requisitionLineRows) {
    linesByRequisitionId.set(line.requisition_id, [...(linesByRequisitionId.get(line.requisition_id) ?? []), line]);
  }

  const requisitionMadeRecords = requisitionRows.map((row) =>
    requisitionFromRows(row, linesByRequisitionId.get(row.id) ?? [])
  );
  const deletedRecords = (
    db.prepare(
      `SELECT id, record_type, record_id, title, details, deleted_by, deleted_at, expires_at, payload_json
       FROM deleted_records
       ORDER BY deleted_at DESC, id ASC`
    ).all() as DeletedRecordRow[]
  ).map(deletedRecordFromRow).filter((record) => record !== null);
  const auditLog = (
    db.prepare(
      `SELECT id, entity_type, entity_id, action, summary, actor, occurred_at, is_demo
       FROM audit_log
       ORDER BY occurred_at DESC, id ASC`
    ).all() as AuditLogRow[]
  ).map(auditEntryFromRow);
  const loadedAt = snapshot?.lastSavedAt ?? readSnapshotRow(db)?.updated_at ?? nowIso();

  return {
    app: "maintenance-inventory-tracker",
    version: snapshot?.version ?? "3.0.0-rc.5",
    lastSavedAt: loadedAt,
    items,
    locations,
    vendors,
    stockChanges,
    requisitionMadeRecords,
    deletedRecords,
    auditLog,
    settings: loadSettingsFromNormalized(db, snapshot)
  };
}

export function loadAppDataWithSource(): AppDataLoadResult {
  const db = getDatabase();
  const snapshot = loadAppDataSnapshot(db);
  let normalizedLoadError: string | undefined;
  let normalizedData: AppData | null = null;

  try {
    normalizedData = loadAppDataFromNormalizedTables(snapshot);
  } catch (error) {
    normalizedLoadError = errorMessage(error);
  }

  const counts = getHealthCounts();

  if (normalizedDataIsSafeToUse(normalizedData, snapshot, counts)) {
    return {
      data: normalizedData,
      normalizedLoadError,
      normalizedLoadReady: true,
      source: "normalized"
    };
  }

  return {
    data: snapshot,
    normalizedLoadError,
    normalizedLoadReady: false,
    source: snapshot ? "snapshot-fallback" : "none"
  };
}

export function loadAppDataFromSqlite(): AppData | null {
  return loadAppDataWithSource().data;
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
        INSERT INTO inventory_items (id, item_name, description, part_number, category, vendor_id, location_id, stock_on_hand, unit, minimum, low_alert, low_stock_alert_level, cost, item_url, notes, image_placeholder, image_data_url, barcode_placeholder, order_placed, reorder_hold, order_requisition_id, hidden_from_watchlist, non_stocked, is_demo, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          (!it.nonStocked && it.lowStockAlertLevel && it.lowStockAlertLevel > 0) ? 1 : 0,
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
          it.hiddenFromWatchList ? 1 : 0,
          it.nonStocked ? 1 : 0,
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

export function getDataFreshnessSummary() {
  const db = getDatabase();
  const latestItem = db.prepare("SELECT MAX(updated_at) AS latest FROM inventory_items").get() as { latest: string | null };
  const latestSnapshot = db.prepare("SELECT MAX(updated_at) AS latest FROM app_snapshots").get() as { latest: string | null };

  return {
    latestItemUpdatedAt: latestItem.latest,
    latestSnapshotUpdatedAt: latestSnapshot.latest
  };
}

export function getAppDataCountComparison() {
  const snapshot = loadAppDataSnapshot();
  const normalizedCounts = getHealthCounts();

  return {
    snapshot: {
      items: Array.isArray(snapshot?.items) ? snapshot.items.length : 0,
      vendors: Array.isArray(snapshot?.vendors) ? snapshot.vendors.length : 0,
      locations: Array.isArray(snapshot?.locations) ? snapshot.locations.length : 0,
      stockChanges: Array.isArray(snapshot?.stockChanges) ? snapshot.stockChanges.length : 0,
      requisitionMadeRecords: Array.isArray(snapshot?.requisitionMadeRecords) ? snapshot.requisitionMadeRecords.length : 0,
      deletedRecords: Array.isArray(snapshot?.deletedRecords) ? snapshot.deletedRecords.length : 0,
      auditLog: Array.isArray(snapshot?.auditLog) ? snapshot.auditLog.length : 0
    },
    normalized: {
      items: normalizedCounts.inventory_items,
      vendors: normalizedCounts.vendors,
      locations: normalizedCounts.locations,
      stockChanges: normalizedCounts.stock_ledger,
      requisitionMadeRecords: normalizedCounts.requisitions,
      requisitionLines: normalizedCounts.requisition_lines,
      deletedRecords: normalizedCounts.deleted_records,
      auditLog: normalizedCounts.audit_log
    }
  };
}
