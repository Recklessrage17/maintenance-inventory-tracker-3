import type { StockChange } from "../types";
import { openMaintenanceSqliteDatabase } from "./sqliteRuntime";

type CountRow = {
  count: number;
};

type StockLedgerMirrorSampleRow = {
  action_type: string;
  part_number: string | null;
};

export type StockLedgerMirrorStatus = {
  error?: string;
  jsonStockLedgerCount: number;
  sampleActions: string[];
  samplePartNumbers: string[];
  sqliteAvailable: boolean;
  sqliteStockLedgerCount: number;
  stockLedgerMatch: boolean;
};

function hasTauriRuntime() {
  return typeof window !== "undefined" && Boolean((window as Window & { __TAURI__?: unknown }).__TAURI__);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function boolToSqlite(value: boolean | undefined) {
  return value === true ? 1 : 0;
}

function signedQuantityChange(record: StockChange) {
  return record.actionType === "Stock Out" ? -Math.abs(record.quantity) : Math.abs(record.quantity);
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

export async function syncStockLedgerToSqlite(records: StockChange[]) {
  if (!hasTauriRuntime()) {
    return 0;
  }

  await deleteStockLedgerRowsNotIn(records.map((record) => record.id));

  const db = await openMaintenanceSqliteDatabase();

  for (const record of records) {
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

export async function getSqliteStockLedgerMirrorStatus(
  records: StockChange[]
): Promise<StockLedgerMirrorStatus> {
  if (!hasTauriRuntime()) {
    return {
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
      jsonStockLedgerCount: records.length,
      sampleActions: sample.map((record) => record.action_type).filter(Boolean),
      samplePartNumbers: sample.map((record) => record.part_number ?? "").filter(Boolean),
      sqliteAvailable: true,
      sqliteStockLedgerCount,
      stockLedgerMatch: sqliteStockLedgerCount === records.length
    };
  } catch (error) {
    return {
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
