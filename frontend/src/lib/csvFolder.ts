import type { AppData, StockChange } from "../types";
import { rowsToCsv } from "./export";

export const CSV_RECOMMENDED_FOLDER = "D:\\Maintenance Inventory Tracker CSV Exports";

export type CsvFolderSelection = {
  directoryName: string;
  directoryPath: string;
};

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type TauriWindow = Window & {
  __TAURI__?: {
    core?: {
      invoke?: TauriInvoke;
    };
  };
};

type TauriCsvFileReadResult = {
  contents: string;
  exists: boolean;
  lastModifiedMs: number | null;
};

type TauriCsvFileWriteResult = {
  lastModifiedMs: number | null;
};

export type CsvFolderFileReadResult = {
  contents: string;
  exists: boolean;
  lastModifiedAt: string | null;
};

export type CsvFolderExportResult = {
  exportedAt: string;
  historyExportedAt: string;
  historyFilesWritten: number;
  filesWritten: number;
};

const getTauriInvoke = (): TauriInvoke | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }

  return (window as TauriWindow).__TAURI__?.core?.invoke;
};

export const isCsvFolderSupported = () => Boolean(getTauriInvoke());

export const chooseCsvFolder = async (): Promise<CsvFolderSelection> => {
  const invoke = getTauriInvoke();

  if (!invoke) {
    throw new Error("CSV folder selection is available in the desktop app.");
  }

  const directoryPath = await invoke<string | null>("choose_csv_directory");

  if (!directoryPath) {
    throw new Error("No CSV folder selected.");
  }

  return {
    directoryName: directoryPath,
    directoryPath
  };
};

export const checkCsvFolderExists = async (directoryPath: string) => {
  const invoke = getTauriInvoke();

  if (!invoke) {
    return false;
  }

  return invoke<boolean>("check_csv_folder_exists", { directoryPath });
};

async function writeCsvFile(directoryPath: string, relativePath: string[], contents: string) {
  const invoke = getTauriInvoke();

  if (!invoke) {
    throw new Error("CSV folder export is available in the desktop app.");
  }

  const result = await invoke<TauriCsvFileWriteResult>("write_csv_file", {
    contents,
    directoryPath,
    relativePath
  });

  return {
    lastModifiedAt: result.lastModifiedMs ? new Date(result.lastModifiedMs).toISOString() : null
  };
}

export async function readCsvFile(directoryPath: string, relativePath: string[]): Promise<CsvFolderFileReadResult> {
  const invoke = getTauriInvoke();

  if (!invoke) {
    throw new Error("CSV folder import is available in the desktop app.");
  }

  const result = await invoke<TauriCsvFileReadResult>("read_csv_file", {
    directoryPath,
    relativePath
  });

  return {
    contents: result.contents,
    exists: result.exists,
    lastModifiedAt: result.lastModifiedMs ? new Date(result.lastModifiedMs).toISOString() : null
  };
}

function signedQuantityChange(change: StockChange) {
  return change.actionType === "Stock Out" ? -Math.abs(change.quantity) : Math.abs(change.quantity);
}

function monthKeyFromIso(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 7);
  }

  return date.toISOString().slice(0, 7);
}

function getLocationName(data: AppData, locationId: string) {
  return data.locations.find((location) => location.id === locationId)?.name ?? "";
}

function getVendorName(data: AppData, vendorId: string) {
  return data.vendors.find((vendor) => vendor.id === vendorId)?.name ?? "";
}

export function getInventoryCsv(data: AppData) {
  const headers = [
    "id",
    "partNumber",
    "itemName",
    "description",
    "category",
    "vendor",
    "vendorId",
    "location",
    "locationId",
    "stockOnHand",
    "unit",
    "minimum",
    "lowAlert",
    "cost",
    "url",
    "notes",
    "orderPlaced",
    "reorderHold",
    "hiddenFromWatchList",
    "nonStocked",
    "createdAt",
    "updatedAt"
  ];
  const rows = data.items.map((item) => [
    item.id,
    item.partNumber,
    item.name,
    item.description,
    item.category,
    getVendorName(data, item.vendorId),
    item.vendorId,
    getLocationName(data, item.locationId),
    item.locationId,
    item.quantityOnHand,
    item.stockUnit,
    item.minimumStockLevel,
    item.lowStockAlertLevel,
    item.costEach,
    item.itemUrl,
    item.notes,
    item.orderPlaced === true,
    item.reorderHold === true,
    item.hiddenFromWatchList === true,
    item.nonStocked === true,
    item.createdAt,
    item.updatedAt
  ]);

  return rowsToCsv(headers, rows);
}

export function getVendorsCsv(data: AppData) {
  const headers = [
    "id",
    "name",
    "contact",
    "phone",
    "email",
    "contactEmail",
    "website",
    "address",
    "notes",
    "createdAt",
    "updatedAt"
  ];
  const rows = data.vendors.map((vendor) => [
    vendor.id,
    vendor.name,
    vendor.contactName,
    vendor.phone,
    vendor.email,
    vendor.contactEmail,
    vendor.website,
    "",
    vendor.notes,
    vendor.createdAt,
    vendor.updatedAt
  ]);

  return rowsToCsv(headers, rows);
}

export function getLocationsCsv(data: AppData) {
  const headers = ["id", "name", "description", "area", "department", "notes", "createdAt", "updatedAt"];
  const rows = data.locations.map((location) => [
    location.id,
    location.name,
    location.description,
    "",
    "",
    location.notes,
    location.createdAt,
    location.updatedAt
  ]);

  return rowsToCsv(headers, rows);
}

export function getHistoryCsvForMonth(data: AppData, monthKey: string) {
  const headers = [
    "id",
    "itemId",
    "partNumber",
    "itemName",
    "description",
    "actionType",
    "oldQuantity",
    "quantityChange",
    "newQuantity",
    "reason",
    "usedBy",
    "addedBy",
    "notes",
    "dateTime",
    "createdAt"
  ];
  const itemById = new Map(data.items.map((item) => [item.id, item]));
  const rows = data.stockChanges
    .filter((change) => monthKeyFromIso(change.occurredAt) === monthKey)
    .slice()
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id))
    .map((change) => {
      const item = itemById.get(change.itemId);

      return [
        change.id,
        change.itemId,
        change.partNumberSnapshot || item?.partNumber || "",
        change.itemNameSnapshot || item?.name || "",
        item?.description || "",
        change.actionType,
        change.previousQuantity,
        signedQuantityChange(change),
        change.newQuantity,
        change.reason,
        change.actor,
        change.actor,
        change.notes,
        change.occurredAt,
        change.createdAt
      ];
    });

  return rowsToCsv(headers, rows);
}

function historyRelativePath(monthKey: string) {
  const year = monthKey.slice(0, 4);

  return ["History Logs", year, monthKey, `stock-history-${monthKey}.csv`];
}

export async function exportHistoryMonthCsv(data: AppData, directoryPath: string, monthKey: string) {
  return writeCsvFile(directoryPath, historyRelativePath(monthKey), getHistoryCsvForMonth(data, monthKey));
}

export async function exportCsvFolder(data: AppData, directoryPath: string): Promise<CsvFolderExportResult> {
  const exportedAt = new Date().toISOString();
  let filesWritten = 0;

  await writeCsvFile(directoryPath, ["Inventory", "inventory.csv"], getInventoryCsv(data));
  filesWritten += 1;
  await writeCsvFile(directoryPath, ["Vendors", "vendors.csv"], getVendorsCsv(data));
  filesWritten += 1;
  await writeCsvFile(directoryPath, ["Locations", "locations.csv"], getLocationsCsv(data));
  filesWritten += 1;

  const monthKeys = Array.from(new Set(data.stockChanges.map((change) => monthKeyFromIso(change.occurredAt)))).sort();
  let historyFilesWritten = 0;

  for (const monthKey of monthKeys) {
    await exportHistoryMonthCsv(data, directoryPath, monthKey);
    historyFilesWritten += 1;
    filesWritten += 1;
  }

  return {
    exportedAt,
    filesWritten,
    historyExportedAt: historyFilesWritten > 0 ? new Date().toISOString() : "",
    historyFilesWritten
  };
}

export async function readCsvFolderImportFiles(directoryPath: string) {
  const [inventory, vendors, locations] = await Promise.all([
    readCsvFile(directoryPath, ["Inventory", "inventory.csv"]),
    readCsvFile(directoryPath, ["Vendors", "vendors.csv"]),
    readCsvFile(directoryPath, ["Locations", "locations.csv"])
  ]);

  return {
    inventory,
    locations,
    vendors
  };
}
