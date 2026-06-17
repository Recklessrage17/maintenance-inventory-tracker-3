import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AppData } from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const timestampedJsonPattern = /^maintenance-inventory-\d{4}-\d{2}-\d{2}-\d{6}\.json$/;
const timestampedJsonRetentionCount = 30;

type RecordLike = Record<string, unknown>;

type CsvBackupKey = "history" | "inventory" | "locations" | "requisition-lines" | "requisitions" | "vendors";

type BackupFileStatus = {
  exists: boolean;
  path: string;
  sizeBytes: number | null;
  updatedAt: string | null;
};

export type WebsiteBackupStatus = {
  backupFolder: "backend/backups";
  backupRoot: string;
  checkedAt: string;
  csvBackupDir: string;
  csvFiles: Record<CsvBackupKey, BackupFileStatus>;
  errors: string[];
  jsonBackupDir: string;
  jsonLatest: BackupFileStatus;
  lastCsvExportAt: string | null;
  lastJsonBackupAt: string | null;
  message: string;
  ok: boolean;
  status: "failed" | "healthy" | "warning";
  timestampedJsonCount: number;
};

const csvFiles: Record<CsvBackupKey, string> = {
  history: "history.csv",
  inventory: "inventory.csv",
  locations: "locations.csv",
  "requisition-lines": "requisition-lines.csv",
  requisitions: "requisitions.csv",
  vendors: "vendors.csv"
};

function nowIso() {
  return new Date().toISOString();
}

export function getBackendRoot() {
  let currentDir = __dirname;

  while (true) {
    const packageJsonPath = path.join(currentDir, "package.json");

    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { name?: unknown };

        if (packageJson.name === "maintenance-inventory-tracker-3-backend") {
          return currentDir;
        }
      } catch {
        // Keep walking; a malformed package file should not pin backups to the wrong directory.
      }
    }

    const parentDir = path.dirname(currentDir);

    if (parentDir === currentDir) {
      return path.resolve(__dirname, "..");
    }

    currentDir = parentDir;
  }
}

export function getBackupRoot() {
  return path.join(getBackendRoot(), "backups");
}

function getJsonBackupDir() {
  return path.join(getBackupRoot(), "json");
}

function getCsvBackupDir() {
  return path.join(getBackupRoot(), "csv");
}

function getLatestJsonFile() {
  return path.join(getJsonBackupDir(), "maintenance-inventory-latest.json");
}

function toTimestampFilePart(date = new Date()) {
  return date.toISOString().slice(0, 19).replace("T", "-").replace(/:/g, "");
}

function displayPath(filePath: string) {
  return `backend/${path.relative(getBackendRoot(), filePath).replace(/\\/g, "/")}`;
}

function asRecord(value: unknown): RecordLike {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RecordLike) : {};
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function text(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

function csvCell(value: unknown) {
  const raw = text(value);

  if (!/[",\r\n]/.test(raw)) {
    return raw;
  }

  return `"${raw.replace(/"/g, '""')}"`;
}

function rowsToCsv(headers: string[], rows: unknown[][]) {
  const lines = [
    headers.map(csvCell).join(","),
    ...rows.map((row) => row.map(csvCell).join(","))
  ];

  return `${lines.join("\r\n")}\r\n`;
}

function fileStatus(filePath: string): BackupFileStatus {
  try {
    const stat = fs.statSync(filePath);

    return {
      exists: true,
      path: displayPath(filePath),
      sizeBytes: stat.size,
      updatedAt: stat.mtime.toISOString()
    };
  } catch {
    return {
      exists: false,
      path: displayPath(filePath),
      sizeBytes: null,
      updatedAt: null
    };
  }
}

function maxIso(values: Array<string | null>) {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
}

function lookupName(records: RecordLike[], id: unknown) {
  const targetId = text(id);

  if (!targetId) {
    return "";
  }

  return text(records.find((record) => text(record.id) === targetId)?.name);
}

function backupReadmeText() {
  return [
    "Maintenance Inventory Tracker 3 website backups",
    "",
    "The website backend manages this folder automatically.",
    "",
    "json/maintenance-inventory-latest.json is refreshed after every successful app-data save.",
    "json/maintenance-inventory-YYYY-MM-DD-HHMMSS.json files are timestamped restore points; the backend keeps the latest 30.",
    "csv/*.csv files are refreshed after every successful app-data save for quick review and reporting.",
    "",
    "Do not edit generated files while the website is running. Use Settings > Backup Now to refresh backups manually."
  ].join("\r\n");
}

export function ensureBackupFolders() {
  const backupRoot = getBackupRoot();
  const jsonBackupDir = getJsonBackupDir();
  const csvBackupDir = getCsvBackupDir();

  fs.mkdirSync(jsonBackupDir, { recursive: true });
  fs.mkdirSync(csvBackupDir, { recursive: true });

  const readmePath = path.join(backupRoot, "README.txt");

  if (!fs.existsSync(readmePath)) {
    fs.writeFileSync(readmePath, backupReadmeText(), "utf8");
  }

  const gitkeepPath = path.join(backupRoot, ".gitkeep");

  if (!fs.existsSync(gitkeepPath)) {
    fs.writeFileSync(gitkeepPath, "", "utf8");
  }
}

function retentionTimestampedJsonFiles() {
  const jsonBackupDir = getJsonBackupDir();

  if (!fs.existsSync(jsonBackupDir)) {
    return [];
  }

  return fs
    .readdirSync(jsonBackupDir)
    .filter((fileName) => timestampedJsonPattern.test(fileName))
    .sort()
    .reverse();
}

function pruneOldTimestampedJsonBackups() {
  const jsonBackupDir = getJsonBackupDir();
  const oldFiles = retentionTimestampedJsonFiles().slice(timestampedJsonRetentionCount);

  for (const fileName of oldFiles) {
    fs.rmSync(path.join(jsonBackupDir, fileName), { force: true });
  }
}

export function writeJsonBackup(appData: AppData) {
  ensureBackupFolders();

  const jsonBackupDir = getJsonBackupDir();
  const latestJsonFile = getLatestJsonFile();
  const backupAt = nowIso();
  const timestampedJsonFile = path.join(jsonBackupDir, `maintenance-inventory-${toTimestampFilePart(new Date(backupAt))}.json`);
  const payload = {
    ...appData,
    deletedRecords: appData.deletedRecords ?? [],
    lastSavedAt: appData.lastSavedAt || backupAt
  };
  const contents = `${JSON.stringify(payload, null, 2)}\n`;

  fs.writeFileSync(latestJsonFile, contents, "utf8");
  fs.writeFileSync(timestampedJsonFile, contents, "utf8");
  pruneOldTimestampedJsonBackups();

  return {
    lastJsonBackupAt: backupAt,
    latestJsonPath: displayPath(latestJsonFile),
    timestampedJsonPath: displayPath(timestampedJsonFile)
  };
}

function buildInventoryCsv(appData: AppData) {
  const vendors = asArray(appData.vendors);
  const locations = asArray(appData.locations);
  const headers = [
    "id",
    "name",
    "partNumber",
    "description",
    "category",
    "quantityOnHand",
    "stockUnit",
    "minimumStockLevel",
    "lowStockAlertLevel",
    "locationId",
    "locationName",
    "vendorId",
    "vendorName",
    "costEach",
    "itemUrl",
    "notes",
    "reorderHold",
    "orderPlaced",
    "hiddenFromWatchList",
    "nonStocked",
    "createdAt",
    "updatedAt"
  ];
  const rows = asArray(appData.items).map((item) => [
    item.id,
    item.name,
    item.partNumber,
    item.description,
    item.category,
    item.quantityOnHand,
    item.stockUnit,
    item.minimumStockLevel,
    item.lowStockAlertLevel,
    item.locationId,
    lookupName(locations, item.locationId),
    item.vendorId,
    lookupName(vendors, item.vendorId),
    item.costEach,
    item.itemUrl,
    item.notes,
    item.reorderHold,
    item.orderPlaced,
    item.hiddenFromWatchList,
    item.nonStocked,
    item.createdAt,
    item.updatedAt
  ]);

  return rowsToCsv(headers, rows);
}

function buildVendorsCsv(appData: AppData) {
  const headers = ["id", "name", "contactName", "contactEmail", "phone", "email", "website", "notes", "createdAt", "updatedAt"];
  const rows = asArray(appData.vendors).map((vendor) => [
    vendor.id,
    vendor.name,
    vendor.contactName,
    vendor.contactEmail,
    vendor.phone,
    vendor.email,
    vendor.website,
    vendor.notes,
    vendor.createdAt,
    vendor.updatedAt
  ]);

  return rowsToCsv(headers, rows);
}

function buildLocationsCsv(appData: AppData) {
  const headers = ["id", "name", "description", "notes", "createdAt", "updatedAt"];
  const rows = asArray(appData.locations).map((location) => [
    location.id,
    location.name,
    location.description,
    location.notes,
    location.createdAt,
    location.updatedAt
  ]);

  return rowsToCsv(headers, rows);
}

function buildHistoryCsv(appData: AppData) {
  const headers = [
    "id",
    "itemId",
    "partNumber",
    "itemName",
    "vendorName",
    "actionType",
    "previousQuantity",
    "quantityChange",
    "newQuantity",
    "reason",
    "actor",
    "notes",
    "occurredAt",
    "createdAt"
  ];
  const rows = asArray(appData.stockChanges)
    .sort((left, right) => text(left.occurredAt).localeCompare(text(right.occurredAt)) || text(left.id).localeCompare(text(right.id)))
    .map((change) => [
      change.id,
      change.itemId,
      change.partNumberSnapshot,
      change.itemNameSnapshot,
      change.vendorNameSnapshot,
      change.actionType,
      change.previousQuantity,
      change.actionType === "Stock Out" ? -Math.abs(Number(change.quantity) || 0) : Math.abs(Number(change.quantity) || 0),
      change.newQuantity,
      change.reason,
      change.actor,
      change.notes,
      change.occurredAt,
      change.createdAt
    ]);

  return rowsToCsv(headers, rows);
}

function buildRequisitionsCsv(appData: AppData) {
  const headers = [
    "id",
    "vendorKey",
    "vendorName",
    "createdAt",
    "createdBy",
    "poNo",
    "totalCost",
    "requisitionType",
    "pdfGeneratedAt",
    "passedAt",
    "requisitionedBy",
    "status",
    "itemCount"
  ];
  const rows = asArray(appData.requisitionMadeRecords).map((requisition) => [
    requisition.id,
    requisition.vendorKey,
    requisition.vendorName,
    requisition.createdAt,
    requisition.createdBy,
    requisition.poNo,
    requisition.totalCost,
    requisition.requisitionType,
    requisition.pdfGeneratedAt,
    requisition.passedAt,
    requisition.requisitionedBy,
    requisition.status,
    Array.isArray(requisition.itemSnapshots) ? requisition.itemSnapshots.length : 0
  ]);

  return rowsToCsv(headers, rows);
}

function buildRequisitionLinesCsv(appData: AppData) {
  const headers = [
    "requisitionId",
    "lineNumber",
    "vendorName",
    "itemId",
    "itemName",
    "partNumber",
    "quantityRequested",
    "unitCost",
    "totalCost",
    "createdAt"
  ];
  const rows = asArray(appData.requisitionMadeRecords).flatMap((requisition) =>
    asArray(requisition.itemSnapshots).map((line, index) => [
      requisition.id,
      index + 1,
      requisition.vendorName,
      line.itemId,
      line.itemName,
      line.partNumber,
      line.quantityRequested,
      line.unitCost,
      line.totalCost,
      requisition.createdAt
    ])
  );

  return rowsToCsv(headers, rows);
}

export function writeCsvBackups(appData: AppData) {
  ensureBackupFolders();

  const csvBackupDir = getCsvBackupDir();
  const definitions: Array<{ contents: () => string; key: CsvBackupKey }> = [
    { key: "inventory", contents: () => buildInventoryCsv(appData) },
    { key: "vendors", contents: () => buildVendorsCsv(appData) },
    { key: "locations", contents: () => buildLocationsCsv(appData) },
    { key: "history", contents: () => buildHistoryCsv(appData) },
    { key: "requisitions", contents: () => buildRequisitionsCsv(appData) },
    { key: "requisition-lines", contents: () => buildRequisitionLinesCsv(appData) }
  ];
  const errors: string[] = [];

  for (const definition of definitions) {
    try {
      fs.writeFileSync(path.join(csvBackupDir, csvFiles[definition.key]), definition.contents(), "utf8");
    } catch (error) {
      errors.push(`${csvFiles[definition.key]}: ${error instanceof Error ? error.message : "CSV export failed."}`);
    }
  }

  return {
    errors,
    lastCsvExportAt: nowIso()
  };
}

export function getBackupStatus(extraErrors: string[] = []): WebsiteBackupStatus {
  ensureBackupFolders();

  const backupRoot = getBackupRoot();
  const jsonBackupDir = getJsonBackupDir();
  const csvBackupDir = getCsvBackupDir();
  const latestJsonFile = getLatestJsonFile();
  const jsonLatest = fileStatus(latestJsonFile);
  const csvStatuses = Object.fromEntries(
    Object.entries(csvFiles).map(([key, fileName]) => [key, fileStatus(path.join(csvBackupDir, fileName))])
  ) as Record<CsvBackupKey, BackupFileStatus>;
  const missingCsvFiles = Object.entries(csvStatuses)
    .filter(([, status]) => !status.exists)
    .map(([key]) => key);
  const errors = [...extraErrors];
  const timestampedJsonCount = retentionTimestampedJsonFiles().length;
  const lastCsvExportAt = maxIso(Object.values(csvStatuses).map((status) => status.updatedAt));

  let status: WebsiteBackupStatus["status"] = "healthy";
  let message = "Healthy";

  if (!jsonLatest.exists) {
    status = "warning";
    message = "No JSON backup has run yet.";
  }

  if (missingCsvFiles.length > 0) {
    status = "warning";
    message = `Missing CSV backup files: ${missingCsvFiles.join(", ")}.`;
  }

  if (errors.length > 0) {
    status = "warning";
    message = `Backup completed with warnings: ${errors.join("; ")}`;
  }

  return {
    backupFolder: "backend/backups",
    backupRoot,
    checkedAt: nowIso(),
    csvBackupDir,
    csvFiles: csvStatuses,
    errors,
    jsonBackupDir,
    jsonLatest,
    lastCsvExportAt,
    lastJsonBackupAt: jsonLatest.updatedAt,
    message,
    ok: true,
    status,
    timestampedJsonCount
  };
}

export function runWebsiteBackup(appData: AppData) {
  writeJsonBackup(appData);
  const csvResult = writeCsvBackups(appData);

  return getBackupStatus(csvResult.errors);
}

export function getBackupDownloadPath(kind: "history" | "inventory" | "json") {
  ensureBackupFolders();

  if (kind === "json") {
    return getLatestJsonFile();
  }

  return path.join(getCsvBackupDir(), csvFiles[kind]);
}
