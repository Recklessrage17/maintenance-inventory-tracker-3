import type { InventoryItem } from "../types";
import { openMaintenanceSqliteDatabase } from "./sqliteRuntime";

type SqliteDatabase = Awaited<ReturnType<typeof openMaintenanceSqliteDatabase>>;

type CountRow = {
  count: number;
};

type InventoryMirrorSampleRow = {
  id: string;
  item_name: string;
  part_number: string | null;
};

type SqliteInventoryRow = {
  barcode_placeholder: string | null;
  category: string | null;
  cost: number | string | null;
  created_at: string;
  description: string | null;
  id: string;
  image_data_url: string | null;
  image_placeholder: string | null;
  hidden_from_watchlist: number | boolean | null;
  non_stocked: number | boolean | null;
  is_demo: number | boolean | null;
  item_name: string;
  item_url: string | null;
  location_id: string | null;
  low_alert: number | boolean | null;
  low_stock_alert_level: number | string | null;
  minimum: number | string | null;
  notes: string | null;
  order_placed: number | boolean | null;
  order_requisition_id: string | null;
  part_number: string | null;
  reorder_hold: number | boolean | null;
  stock_on_hand: number | string | null;
  unit: string | null;
  updated_at: string;
  vendor_id: string | null;
};

export type InventoryMirrorSample = {
  id: string;
  name: string;
  partNumber: string;
};

export type SqliteInventoryMirrorStatus = {
  activeInventorySource: "json" | "sqlite";
  error?: string;
  inventoryMatch: boolean;
  jsonInventoryCount: number;
  samplePartNumbers: string[];
  sqliteAvailable: boolean;
  sqliteInventoryCount: number;
};

export type SqliteInventoryActivationResult = SqliteInventoryMirrorStatus & {
  items: InventoryItem[];
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

function itemHasLowAlert(item: InventoryItem) {
  return !item.nonStocked && item.lowStockAlertLevel > 0 && item.quantityOnHand <= item.lowStockAlertLevel;
}

function itemFromSqlite(row: SqliteInventoryRow): InventoryItem {
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

function orderBySource<T extends { id: string }>(source: T[], loaded: T[]) {
  const sourceOrder = new Map(source.map((record, index) => [record.id, index]));

  return [...loaded].sort((left, right) => {
    const leftIndex = sourceOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = sourceOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER;

    return leftIndex - rightIndex || left.id.localeCompare(right.id);
  });
}

function hasJsonFieldsMissingFromSqlite(jsonItems: InventoryItem[], sqliteItems: InventoryItem[]) {
  const sqliteById = new Map(sqliteItems.map((item) => [item.id, item]));

  return jsonItems.some((jsonItem) => {
    const sqliteItem = sqliteById.get(jsonItem.id);

    if (!sqliteItem) {
      return true;
    }

    return (
      jsonItem.lowStockAlertLevel !== sqliteItem.lowStockAlertLevel ||
      jsonItem.itemUrl !== sqliteItem.itemUrl ||
      jsonItem.imagePlaceholder !== sqliteItem.imagePlaceholder ||
      jsonItem.imageDataUrl !== sqliteItem.imageDataUrl ||
      jsonItem.barcodePlaceholder !== sqliteItem.barcodePlaceholder ||
      (jsonItem.orderRequisitionId ?? "") !== (sqliteItem.orderRequisitionId ?? "") ||
      Boolean(jsonItem.hiddenFromWatchList) !== Boolean(sqliteItem.hiddenFromWatchList) ||
      Boolean(jsonItem.nonStocked) !== Boolean(sqliteItem.nonStocked) ||
      Boolean(jsonItem.isDemo) !== Boolean(sqliteItem.isDemo)
    );
  });
}

function shouldBackfillJsonInventory(jsonItems: InventoryItem[], sqliteItems: InventoryItem[]) {
  return sqliteItems.length !== jsonItems.length || hasJsonFieldsMissingFromSqlite(jsonItems, sqliteItems);
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

async function saveInventoryItemWithDb(db: SqliteDatabase, item: InventoryItem) {
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
      low_stock_alert_level,
      cost,
      item_url,
      notes,
      image_placeholder,
      image_data_url,
      barcode_placeholder,
      order_placed,
      reorder_hold,
      order_requisition_id,
      hidden_from_watchlist,
      non_stocked,
      is_demo,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      low_stock_alert_level = excluded.low_stock_alert_level,
      cost = excluded.cost,
      item_url = excluded.item_url,
      notes = excluded.notes,
      image_placeholder = excluded.image_placeholder,
      image_data_url = excluded.image_data_url,
      barcode_placeholder = excluded.barcode_placeholder,
      order_placed = excluded.order_placed,
      reorder_hold = excluded.reorder_hold,
      order_requisition_id = excluded.order_requisition_id,
      hidden_from_watchlist = excluded.hidden_from_watchlist,
      non_stocked = excluded.non_stocked,
      is_demo = excluded.is_demo,
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
      item.lowStockAlertLevel,
      item.costEach,
      item.itemUrl,
      item.notes,
      item.imagePlaceholder,
      item.imageDataUrl,
      item.barcodePlaceholder,
      boolToSqlite(item.orderPlaced),
      boolToSqlite(item.reorderHold),
      item.orderRequisitionId || null,
      boolToSqlite(item.hiddenFromWatchList),
      boolToSqlite(item.nonStocked),
      boolToSqlite(item.isDemo),
      item.createdAt,
      item.updatedAt
    ]
  );
}

export async function loadInventoryFromSqlite(): Promise<InventoryItem[]> {
  if (!hasTauriRuntime()) {
    return [];
  }

  const db = await openMaintenanceSqliteDatabase();
  const rows = await db.select<SqliteInventoryRow[]>(
    `SELECT
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
      low_stock_alert_level,
      cost,
      item_url,
      notes,
      image_placeholder,
      image_data_url,
      barcode_placeholder,
      order_placed,
      reorder_hold,
      order_requisition_id,
      hidden_from_watchlist,
      non_stocked,
      is_demo,
      created_at,
      updated_at
    FROM inventory_items`
  );

  return rows.map(itemFromSqlite);
}

export async function saveInventoryItemToSqlite(item: InventoryItem) {
  if (!hasTauriRuntime()) {
    return;
  }

  const db = await openMaintenanceSqliteDatabase();
  await saveInventoryItemWithDb(db, item);
}

export async function deleteInventoryItemFromSqlite(itemId: string) {
  if (!hasTauriRuntime()) {
    return;
  }

  const db = await openMaintenanceSqliteDatabase();
  await db.execute("DELETE FROM inventory_items WHERE id = ?", [itemId]);
}

export async function syncInventoryToSqlite(items: InventoryItem[]) {
  if (!hasTauriRuntime()) {
    return 0;
  }

  await deleteInventoryRowsNotIn(items.map((item) => item.id));

  const db = await openMaintenanceSqliteDatabase();

  for (const item of items) {
    await saveInventoryItemWithDb(db, item);
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

export async function activateInventorySqliteState(
  jsonItems: InventoryItem[]
): Promise<SqliteInventoryActivationResult> {
  if (!hasTauriRuntime()) {
    return {
      activeInventorySource: "json",
      inventoryMatch: false,
      items: jsonItems,
      jsonInventoryCount: jsonItems.length,
      samplePartNumbers: [],
      sqliteAvailable: false,
      sqliteInventoryCount: 0
    };
  }

  try {
    let sqliteItems = await loadInventoryFromSqlite();

    if (shouldBackfillJsonInventory(jsonItems, sqliteItems)) {
      await syncInventoryToSqlite(jsonItems);
      sqliteItems = await loadInventoryFromSqlite();
    }

    const orderedSqliteItems = orderBySource(jsonItems, sqliteItems);

    return {
      activeInventorySource: "sqlite",
      inventoryMatch: orderedSqliteItems.length === jsonItems.length,
      items: orderedSqliteItems,
      jsonInventoryCount: jsonItems.length,
      samplePartNumbers: orderedSqliteItems.map((item) => item.partNumber).filter(Boolean).slice(0, 5),
      sqliteAvailable: true,
      sqliteInventoryCount: orderedSqliteItems.length
    };
  } catch (error) {
    return {
      activeInventorySource: "json",
      error: errorMessage(error),
      inventoryMatch: false,
      items: jsonItems,
      jsonInventoryCount: jsonItems.length,
      samplePartNumbers: [],
      sqliteAvailable: false,
      sqliteInventoryCount: 0
    };
  }
}

export async function getSqliteInventoryMirrorStatus(
  items: InventoryItem[]
): Promise<SqliteInventoryMirrorStatus> {
  if (!hasTauriRuntime()) {
    return {
      activeInventorySource: "json",
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
      activeInventorySource: "sqlite",
      inventoryMatch: sqliteInventoryCount === items.length,
      jsonInventoryCount: items.length,
      samplePartNumbers: sample.map((item) => item.partNumber).filter(Boolean),
      sqliteAvailable: true,
      sqliteInventoryCount
    };
  } catch (error) {
    return {
      activeInventorySource: "json",
      error: errorMessage(error),
      inventoryMatch: false,
      jsonInventoryCount: items.length,
      samplePartNumbers: [],
      sqliteAvailable: false,
      sqliteInventoryCount: 0
    };
  }
}
