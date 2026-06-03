import type { StockActionType, StockChange } from "../types";
import { openMaintenanceSqliteDatabase } from "./sqliteRuntime";

type SqliteDatabase = Awaited<ReturnType<typeof openMaintenanceSqliteDatabase>>;

type CountRow = {
  count: number;
};

type StockLedgerMirrorSampleRow = {
  action_type: string;
  part_number: string | null;
};

type SqliteStockLedgerRow = {
  action_type: string;
  created_at: string | null;
  date_time: string;
  id: string;
  is_demo: number | boolean | null;
  item_description: string | null;
  item_id: string | null;
  item_name: string | null;
  new_quantity: number | string | null;
  notes: string | null;
  old_quantity: number | string | null;
  part_number: string | null;
  quantity_change: number | string | null;
  reason: string | null;
  source_item_id: string | null;
  used_by: string | null;
  vendor_name: string | null;
};

export type StockLedgerMirrorStatus = {
  activeStockLedgerSource: "json" | "sqlite";
  error?: string;
  jsonStockLedgerCount: number;
  sampleActions: string[];
  samplePartNumbers: string[];
  sqliteAvailable: boolean;
  sqliteStockLedgerCount: number;
  stockLedgerMatch: boolean;
};

export type StockLedgerActivationResult = StockLedgerMirrorStatus & {
  records: StockChange[];
};

function hasTauriRuntime() {
  return typeof window !== "undefined" && Boolean((window as Window & { __TAURI__?: unknown }).__TAURI__);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function numberValue(value: number | string | null | undefined, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolToSqlite(value: boolean | undefined) {
  return value === true ? 1 : 0;
}

function boolFromSqlite(value: number | boolean | null | undefined) {
  return value === true || value === 1;
}

function signedQuantityChange(record: StockChange) {
  return record.actionType === "Stock Out" ? -Math.abs(record.quantity) : Math.abs(record.quantity);
}

function stockActionFromSqlite(value: string): StockActionType {
  return value === "Stock Out" || value === "Set Stock On Hand" ? value : "Stock In";
}

function stockLedgerRecordFromSqlite(row: SqliteStockLedgerRow): StockChange {
  const quantityChange = numberValue(row.quantity_change);
  const actionType = stockActionFromSqlite(row.action_type);

  return {
    id: row.id,
    itemId: row.source_item_id ?? row.item_id ?? "",
    itemNameSnapshot: row.item_name ?? "Unknown Item",
    partNumberSnapshot: row.part_number ?? "",
    vendorNameSnapshot: row.vendor_name ?? "",
    actionType,
    quantity: Math.abs(quantityChange),
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

function orderBySource<T extends { id: string }>(source: T[], loaded: T[]) {
  const sourceOrder = new Map(source.map((record, index) => [record.id, index]));

  return [...loaded].sort((left, right) => {
    const leftIndex = sourceOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = sourceOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER;

    return leftIndex - rightIndex || left.id.localeCompare(right.id);
  });
}

function hasJsonFieldsMissingFromSqlite(jsonRecords: StockChange[], sqliteRecords: StockChange[]) {
  const sqliteById = new Map(sqliteRecords.map((record) => [record.id, record]));

  return jsonRecords.some((jsonRecord) => {
    const sqliteRecord = sqliteById.get(jsonRecord.id);

    if (!sqliteRecord) {
      return true;
    }

    return (
      jsonRecord.itemId !== sqliteRecord.itemId ||
      jsonRecord.itemNameSnapshot !== sqliteRecord.itemNameSnapshot ||
      jsonRecord.partNumberSnapshot !== sqliteRecord.partNumberSnapshot ||
      (jsonRecord.vendorNameSnapshot ?? "") !== (sqliteRecord.vendorNameSnapshot ?? "") ||
      jsonRecord.actionType !== sqliteRecord.actionType ||
      jsonRecord.quantity !== sqliteRecord.quantity ||
      jsonRecord.reason !== sqliteRecord.reason ||
      jsonRecord.actor !== sqliteRecord.actor ||
      jsonRecord.notes !== sqliteRecord.notes ||
      jsonRecord.occurredAt !== sqliteRecord.occurredAt ||
      jsonRecord.previousQuantity !== sqliteRecord.previousQuantity ||
      jsonRecord.newQuantity !== sqliteRecord.newQuantity ||
      Boolean(jsonRecord.isDemo) !== Boolean(sqliteRecord.isDemo) ||
      jsonRecord.createdAt !== sqliteRecord.createdAt
    );
  });
}

function shouldBackfillJsonStockLedger(jsonRecords: StockChange[], sqliteRecords: StockChange[]) {
  return sqliteRecords.length !== jsonRecords.length || hasJsonFieldsMissingFromSqlite(jsonRecords, sqliteRecords);
}

async function deleteStockLedgerRowsNotIn(ids: string[]) {
  const db = await openMaintenanceSqliteDatabase();

  if (ids.length === 0) {
    await db.execute("DELETE FROM stock_ledger");
    return;
  }

  const placeholders = ids.map(() => "?").join(", ");
  await db.execute(`DELETE FROM stock_ledger WHERE id NOT IN (${placeholders})`, ids);
}

async function saveStockLedgerRecordWithDb(db: SqliteDatabase, record: StockChange) {
  await db.execute(
    `INSERT INTO stock_ledger (
      id,
      item_id,
      source_item_id,
      item_name,
      item_description,
      part_number,
      vendor_name,
      action_type,
      old_quantity,
      quantity_change,
      new_quantity,
      reason,
      used_by,
      notes,
      date_time,
      created_at,
      is_demo
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      item_id = excluded.item_id,
      source_item_id = excluded.source_item_id,
      item_name = excluded.item_name,
      item_description = excluded.item_description,
      part_number = excluded.part_number,
      vendor_name = excluded.vendor_name,
      action_type = excluded.action_type,
      old_quantity = excluded.old_quantity,
      quantity_change = excluded.quantity_change,
      new_quantity = excluded.new_quantity,
      reason = excluded.reason,
      used_by = excluded.used_by,
      notes = excluded.notes,
      date_time = excluded.date_time,
      created_at = excluded.created_at,
      is_demo = excluded.is_demo`,
    [
      record.id,
      null,
      record.itemId,
      record.itemNameSnapshot,
      "",
      record.partNumberSnapshot,
      record.vendorNameSnapshot ?? "",
      record.actionType,
      record.previousQuantity,
      signedQuantityChange(record),
      record.newQuantity,
      record.reason,
      record.actor,
      record.notes,
      record.occurredAt,
      record.createdAt,
      boolToSqlite(record.isDemo)
    ]
  );
}

export async function loadStockLedgerFromSqlite(): Promise<StockChange[]> {
  if (!hasTauriRuntime()) {
    return [];
  }

  const db = await openMaintenanceSqliteDatabase();
  const rows = await db.select<SqliteStockLedgerRow[]>(
    `SELECT
      id,
      item_id,
      source_item_id,
      item_name,
      item_description,
      part_number,
      vendor_name,
      action_type,
      old_quantity,
      quantity_change,
      new_quantity,
      reason,
      used_by,
      notes,
      date_time,
      created_at,
      is_demo
    FROM stock_ledger`
  );

  return rows.map(stockLedgerRecordFromSqlite);
}

export async function saveStockLedgerRecordToSqlite(record: StockChange) {
  if (!hasTauriRuntime()) {
    return;
  }

  const db = await openMaintenanceSqliteDatabase();
  await saveStockLedgerRecordWithDb(db, record);
}

export async function deleteStockLedgerRecordFromSqlite(recordId: string) {
  if (!hasTauriRuntime()) {
    return;
  }

  const db = await openMaintenanceSqliteDatabase();
  await db.execute("DELETE FROM stock_ledger WHERE id = ?", [recordId]);
}

export async function syncStockLedgerToSqlite(records: StockChange[]) {
  if (!hasTauriRuntime()) {
    return 0;
  }

  await deleteStockLedgerRowsNotIn(records.map((record) => record.id));

  const db = await openMaintenanceSqliteDatabase();

  for (const record of records) {
    await saveStockLedgerRecordWithDb(db, record);
  }

  return countSqliteStockLedgerRecords();
}

export async function countSqliteStockLedgerRecords() {
  if (!hasTauriRuntime()) {
    return 0;
  }

  const db = await openMaintenanceSqliteDatabase();
  const rows = await db.select<CountRow[]>("SELECT COUNT(*) AS count FROM stock_ledger");

  return rows[0]?.count ?? 0;
}

export async function loadStockLedgerMirrorSample(limit = 5) {
  if (!hasTauriRuntime()) {
    return [];
  }

  const db = await openMaintenanceSqliteDatabase();
  const safeLimit = Math.max(1, Math.min(25, Math.trunc(limit)));

  return db.select<StockLedgerMirrorSampleRow[]>(
    `SELECT action_type, part_number
    FROM stock_ledger
    ORDER BY date_time DESC, created_at DESC
    LIMIT ?`,
    [safeLimit]
  );
}

export async function activateStockLedgerSqliteState(
  jsonRecords: StockChange[]
): Promise<StockLedgerActivationResult> {
  if (!hasTauriRuntime()) {
    return {
      activeStockLedgerSource: "json",
      jsonStockLedgerCount: jsonRecords.length,
      records: jsonRecords,
      sampleActions: [],
      samplePartNumbers: [],
      sqliteAvailable: false,
      sqliteStockLedgerCount: 0,
      stockLedgerMatch: false
    };
  }

  try {
    let sqliteRecords = await loadStockLedgerFromSqlite();

    if (shouldBackfillJsonStockLedger(jsonRecords, sqliteRecords)) {
      await syncStockLedgerToSqlite(jsonRecords);
      sqliteRecords = await loadStockLedgerFromSqlite();
    }

    const orderedSqliteRecords = orderBySource(jsonRecords, sqliteRecords);

    return {
      activeStockLedgerSource: "sqlite",
      jsonStockLedgerCount: jsonRecords.length,
      records: orderedSqliteRecords,
      sampleActions: orderedSqliteRecords.map((record) => record.actionType).filter(Boolean).slice(0, 5),
      samplePartNumbers: orderedSqliteRecords.map((record) => record.partNumberSnapshot).filter(Boolean).slice(0, 5),
      sqliteAvailable: true,
      sqliteStockLedgerCount: orderedSqliteRecords.length,
      stockLedgerMatch: orderedSqliteRecords.length === jsonRecords.length
    };
  } catch (error) {
    return {
      activeStockLedgerSource: "json",
      error: errorMessage(error),
      jsonStockLedgerCount: jsonRecords.length,
      records: jsonRecords,
      sampleActions: [],
      samplePartNumbers: [],
      sqliteAvailable: false,
      sqliteStockLedgerCount: 0,
      stockLedgerMatch: false
    };
  }
}

export async function getSqliteStockLedgerMirrorStatus(
  records: StockChange[]
): Promise<StockLedgerMirrorStatus> {
  if (!hasTauriRuntime()) {
    return {
      activeStockLedgerSource: "json",
      jsonStockLedgerCount: records.length,
      sampleActions: [],
      samplePartNumbers: [],
      sqliteAvailable: false,
      sqliteStockLedgerCount: 0,
      stockLedgerMatch: false
    };
  }

  try {
    const sqliteStockLedgerCount = await syncStockLedgerToSqlite(records);
    const sample = await loadStockLedgerMirrorSample();

    return {
      activeStockLedgerSource: "sqlite",
      jsonStockLedgerCount: records.length,
      sampleActions: sample.map((record) => record.action_type).filter(Boolean),
      samplePartNumbers: sample.map((record) => record.part_number ?? "").filter(Boolean),
      sqliteAvailable: true,
      sqliteStockLedgerCount,
      stockLedgerMatch: sqliteStockLedgerCount === records.length
    };
  } catch (error) {
    return {
      activeStockLedgerSource: "json",
      error: errorMessage(error),
      jsonStockLedgerCount: records.length,
      sampleActions: [],
      samplePartNumbers: [],
      sqliteAvailable: false,
      sqliteStockLedgerCount: 0,
      stockLedgerMatch: false
    };
  }
}
