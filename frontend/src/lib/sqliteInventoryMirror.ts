import type { InventoryItem } from "../types";
import { openMaintenanceSqliteDatabase } from "./sqliteRuntime";

type CountRow = {
  count: number;
};

type InventoryMirrorSampleRow = {
  id: string;
  item_name: string;
  part_number: string | null;
};

export type InventoryMirrorSample = {
  id: string;
  name: string;
  partNumber: string;
};

export type SqliteInventoryMirrorStatus = {
  error?: string;
  inventoryMatch: boolean;
  jsonInventoryCount: number;
  samplePartNumbers: string[];
  sqliteAvailable: boolean;
  sqliteInventoryCount: number;
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

function itemHasLowAlert(item: InventoryItem) {
  return item.lowStockAlertLevel > 0 && item.quantityOnHand <= item.lowStockAlertLevel;
}

async function deleteInventoryRowsNotIn(ids: string[]) {
  const db = await openMaintenanceSqliteDatabase();

  if (ids.length === 0) {
    await db.execute("DELETE FROM inventory_items");
    return;
  }

  const placeholders = ids.map(() => "?").join(", ");
  await db.execute(`DELETE FROM inventory_items WHERE id NOT IN (${placeholders})`, ids);
}

export async function syncInventoryToSqlite(items: InventoryItem[]) {
  if (!hasTauriRuntime()) {
    return 0;
  }

  await deleteInventoryRowsNotIn(items.map((item) => item.id));

  const db = await openMaintenanceSqliteDatabase();

  for (const item of items) {
    await db.execute(
      `INSERT INTO inventory_items (
        id,
        item_name,
        description,
        part_number,
        category,
        vendor_id,
        location_id,
        stock_on_hand,
        unit,
        minimum,
        low_alert,
        cost,
        notes,
        order_placed,
        reorder_hold,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        item_name = excluded.item_name,
        description = excluded.description,
        part_number = excluded.part_number,
        category = excluded.category,
        vendor_id = excluded.vendor_id,
        location_id = excluded.location_id,
        stock_on_hand = excluded.stock_on_hand,
        unit = excluded.unit,
        minimum = excluded.minimum,
        low_alert = excluded.low_alert,
        cost = excluded.cost,
        notes = excluded.notes,
        order_placed = excluded.order_placed,
        reorder_hold = excluded.reorder_hold,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at`,
      [
        item.id,
        item.name,
        item.description,
        item.partNumber,
        item.category,
        item.vendorId || null,
        item.locationId || null,
        item.quantityOnHand,
        item.stockUnit,
        item.minimumStockLevel,
        boolToSqlite(itemHasLowAlert(item)),
        item.costEach,
        item.notes,
        boolToSqlite(item.orderPlaced),
        boolToSqlite(item.reorderHold),
        item.createdAt,
        item.updatedAt
      ]
    );
  }

  return countSqliteInventoryItems();
}

export async function countSqliteInventoryItems() {
  if (!hasTauriRuntime()) {
    return 0;
  }

  const db = await openMaintenanceSqliteDatabase();
  const rows = await db.select<CountRow[]>("SELECT COUNT(*) AS count FROM inventory_items");

  return rows[0]?.count ?? 0;
}

export async function loadInventoryMirrorSample(limit = 5): Promise<InventoryMirrorSample[]> {
  if (!hasTauriRuntime()) {
    return [];
  }

  const db = await openMaintenanceSqliteDatabase();
  const safeLimit = Math.max(1, Math.min(25, Math.trunc(limit)));
  const rows = await db.select<InventoryMirrorSampleRow[]>(
    `SELECT id, item_name, part_number
    FROM inventory_items
    ORDER BY updated_at DESC, item_name ASC
    LIMIT ?`,
    [safeLimit]
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.item_name,
    partNumber: row.part_number ?? ""
  }));
}

export async function getSqliteInventoryMirrorStatus(
  items: InventoryItem[]
): Promise<SqliteInventoryMirrorStatus> {
  if (!hasTauriRuntime()) {
    return {
      inventoryMatch: false,
      jsonInventoryCount: items.length,
      samplePartNumbers: [],
      sqliteAvailable: false,
      sqliteInventoryCount: 0
    };
  }

  try {
    const sqliteInventoryCount = await syncInventoryToSqlite(items);
    const sample = await loadInventoryMirrorSample();

    return {
      inventoryMatch: sqliteInventoryCount === items.length,
      jsonInventoryCount: items.length,
      samplePartNumbers: sample.map((item) => item.partNumber).filter(Boolean),
      sqliteAvailable: true,
      sqliteInventoryCount
    };
  } catch (error) {
    return {
      error: errorMessage(error),
      inventoryMatch: false,
      jsonInventoryCount: items.length,
      samplePartNumbers: [],
      sqliteAvailable: false,
      sqliteInventoryCount: 0
    };
  }
}
