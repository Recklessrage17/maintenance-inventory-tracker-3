import { type Dispatch, FormEvent, type SetStateAction, useEffect, useMemo, useRef, useState } from "react";
import {
  APP_VERSION,
  checkManualInstallerFolder,
  chooseManualInstallerFolder,
  DEFAULT_MANUAL_UPDATE_FOLDER,
  getCurrentAppVersion,
  getManualInstallerFolder,
  type ManualInstallerCheckResult,
  openInstallerFolder
} from "./lib/appUpdate";
import {
  BACKUP_LATEST_FILENAME,
  BACKUP_RECOMMENDED_FOLDER,
  type BackupDirectorySelection,
  type BackupFileReadResult,
  chooseBackupDirectory,
  createBackupPayload,
  getBackupUpdatedAt,
  getLocalDataUpdatedAt,
  isFileSystemBackupSupported,
  isBackupNewerThanLocal,
  isMissingBackupFileError,
  readBackupFile,
  type InventoryBackupPayload,
  validateBackupPayload,
  writeBackupFile
} from "./lib/backup";
import {
  createAuthRecord,
  formatRecoveryCode,
  isAuthSessionUnlocked,
  readAuthRecord,
  resetPasswordWithRecovery,
  rotateRecoveryCode,
  setAuthSessionUnlocked,
  verifyPassword,
  verifyRecoveryCode
} from "./lib/auth";
import { loadAppData, saveAppData } from "./lib/db";
import { downloadTextFile, parseCsv, rowsToCsv } from "./lib/export";
import { checkPdfExportEngines, type PdfEngineStatus } from "./lib/pdfEngineStatus";
import type {
  AppData,
  AppSettings,
  AuditEntry,
  AuditEntityType,
  BackupIndicatorState,
  BackupInterval,
  InventoryItem,
  InventoryStatus,
  LocationRecord,
  PageId,
  RequisitionHeaderDraft,
  RequisitionLineDraft,
  RequisitionMadeRecord,
  RequisitionVendorGroup,
  StockActionType,
  StockChange,
  VendorRecord
} from "./types";

const DEFAULT_HEADER_BADGE_TEXT = "Private Local Desktop App";
const RECENT_ACTIVITY_WINDOW_MS = 5 * 60 * 1000;
const TIMED_BACKUP_INTERVAL_MS: Record<Extract<BackupInterval, "5min" | "15min">, number> = {
  "5min": 5 * 60 * 1000,
  "15min": 15 * 60 * 1000
};

const pages: Array<{ id: PageId; label: string }> = [
  { id: "dashboard", label: "Dashboard" },
  { id: "inventory", label: "Inventory" },
  { id: "locations", label: "Locations" },
  { id: "vendors", label: "Vendors" },
  { id: "reorder", label: "Reorder List" },
  { id: "history", label: "History Logs" }
];

const categoryOptions = [
  "Filters",
  "Belts",
  "Bearings",
  "Sensors",
  "Electrical",
  "Lubricants",
  "Pneumatics",
  "Hydraulics",
  "Fasteners",
  "Tools",
  "Other"
];

const stockUnitOptions = ["Each", "Ft"] as const;
const DEFAULT_STOCK_UNIT = stockUnitOptions[0];

type NumericInputValue = number | string;

type ItemFormState = {
  name: string;
  partNumber: string;
  description: string;
  category: string;
  quantityOnHand: NumericInputValue;
  stockUnit: string;
  minimumStockLevel: NumericInputValue;
  lowStockAlertLevel: NumericInputValue;
  locationId: string;
  vendorId: string;
  costEach: NumericInputValue;
  itemUrl: string;
  notes: string;
  imagePlaceholder: string;
  barcodePlaceholder: string;
};

type StockFormState = {
  itemId: string;
  actionType: StockActionType | "";
  quantity: NumericInputValue;
  reason: string;
  actor: string;
  notes: string;
  occurredAt: string;
};

type LocationFormState = {
  name: string;
  description: string;
  notes: string;
};

type VendorFormState = {
  name: string;
  contactName: string;
  contactEmail: string;
  phone: string;
  email: string;
  website: string;
  notes: string;
};

type VendorAiPromptState = {
  draft?: string;
  source: "form" | "inline";
  vendorId?: string;
};

type WebsitePreview = {
  finalUrl: string;
  title: string;
  description: string;
};

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type ToastState = {
  tone: "success" | "warning" | "danger";
  text: string;
} | null;

type ToastTone = NonNullable<ToastState>["tone"];

type CsvImportResult = {
  created: number;
  locationsCreated: number;
  rowsFound: number;
  updated: number;
  vendorsCreated: number;
};

type CsvImportRecord = {
  category: string;
  costEach: number | null;
  description: string;
  itemUrl: string;
  locationName: string;
  lowStockAlertLevel: number | null;
  minimumStockLevel: number | null;
  name: string;
  notes: string;
  partNumber: string;
  quantityOnHand: number | null;
  stockUnit: string;
  vendorName: string;
};

type CsvImportPreview = {
  contents: string;
  fileName: string;
  headerRowNumber: number;
  locationsToCreate: string[];
  newItems: number;
  records: CsvImportRecord[];
  rowsFound: number;
  updatedItems: number;
  vendorsToCreate: string[];
};

type CsvColumnIndexes = {
  asset: number;
  category: number;
  cost: number;
  dept: number;
  description: number;
  itemUrl: number;
  location: number;
  lowStockAlert: number;
  minimum: number;
  name: number;
  notes: number;
  partNumber: number;
  quantity: number;
  stockUnit: number;
  vendor: number;
};

type HealthTone = "good" | "warning" | "danger";

type SaveHealthRow = {
  label: string;
  tone: HealthTone;
  value: string;
};

type BackupStatusInfo = {
  pulse: boolean;
  tone: HealthTone;
  tooltip: string;
};

type RecentAddAlert = {
  id: string;
  label: string;
  name: string;
  occurredAt: string;
};

type BackupImportSource = "folder" | "manual" | "auto";

type BackupDialogState =
  | { kind: "setup" }
  | {
      kind: "existing-file";
      backupRead: BackupFileReadResult;
      localTimestamp: string | null;
      selection: BackupDirectorySelection;
    }
  | { kind: "no-file"; selection: BackupDirectorySelection }
  | {
      kind: "confirm-import";
      backupTimestamp: string | null;
      fileLastModifiedAt: string | null;
      fileName: string;
      localTimestamp: string | null;
      payload: InventoryBackupPayload;
      source: Exclude<BackupImportSource, "auto">;
    };

const createId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const nowIso = () => new Date().toISOString();

const toDateTimeLocal = (value = new Date()) => {
  const offsetMs = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offsetMs).toISOString().slice(0, 16);
};

const toDateInput = (value = new Date()) => toDateTimeLocal(value).slice(0, 10);

const dateTimeLocalToIso = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? nowIso() : date.toISOString();
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const stringValue = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : value === undefined || value === null ? fallback : String(value);

const numberValue = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const wholeNumberValue = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
};

const normalizeWholeNumberInput = (value: string, options: { allowNegative?: boolean } = {}) => {
  const text = value.trim();

  if (!text) {
    return "";
  }

  const isNegative = Boolean(options.allowNegative && text.startsWith("-"));
  const digits = text.replace(/\D/g, "");

  if (!digits) {
    return isNegative ? "-" : "";
  }

  const normalizedDigits = digits.replace(/^0+(?=\d)/, "");

  return isNegative && normalizedDigits !== "0" ? `-${normalizedDigits}` : normalizedDigits;
};

const normalizeDecimalInput = (value: string) => {
  const text = value.trim();

  if (!text) {
    return "";
  }

  const cleaned = text.replace(/[^\d.]/g, "");

  if (!cleaned) {
    return "";
  }

  const hasDecimal = cleaned.includes(".");
  const [integerSource, ...decimalSources] = cleaned.split(".");
  const decimalText = decimalSources.join("");
  const integerDigits = integerSource.replace(/\D/g, "");
  const normalizedInteger = integerDigits ? integerDigits.replace(/^0+(?=\d)/, "") : hasDecimal ? "0" : "";

  return hasDecimal ? `${normalizedInteger || "0"}.${decimalText}` : normalizedInteger;
};

const normalizeStockUnit = (value: unknown) => {
  const text = stringValue(value, DEFAULT_STOCK_UNIT).trim();
  const normalizedText = text.toLowerCase().replace(/[^a-z]/g, "");
  const unitAliases: Record<string, (typeof stockUnitOptions)[number]> = {
    ea: "Each",
    each: "Each",
    pcs: "Each",
    piece: "Each",
    pieces: "Each",
    ft: "Ft",
    foot: "Ft",
    feet: "Ft"
  };
  const matchedUnit = stockUnitOptions.find((unit) => unit.toLowerCase() === text.toLowerCase());

  return matchedUnit ?? unitAliases[normalizedText] ?? DEFAULT_STOCK_UNIT;
};

const formatStockQuantity = (item: Pick<InventoryItem, "quantityOnHand" | "stockUnit">) =>
  `${formatNumber(item.quantityOnHand)} ${normalizeStockUnit(item.stockUnit)}`;

function normalizeStockAction(value: unknown): StockActionType {
  if (value === "Stock Out") {
    return "Stock Out";
  }

  if (value === "Set Stock On Hand" || value === "Stock Count") {
    return "Set Stock On Hand";
  }

  return "Stock In";
}

function getStockActionLabel(actionType: StockActionType) {
  switch (actionType) {
    case "Stock In":
      return "Add Stock";
    case "Stock Out":
      return "Pull Stock";
    case "Set Stock On Hand":
      return "Set Stock On Hand";
  }
}

function getStockQuantityLabel(actionType: StockActionType | "") {
  switch (actionType) {
    case "Stock In":
      return "Quantity to Add";
    case "Stock Out":
      return "Quantity to Pull";
    case "Set Stock On Hand":
      return "New Stock On Hand";
    default:
      return "Quantity";
  }
}

function getStockQuantityPlaceholder(actionType: StockActionType | "") {
  return actionType === "Set Stock On Hand" ? "Enter actual counted quantity" : "";
}

function calculateStockQuantity(previousQuantity: number, actionType: StockActionType, quantity: number) {
  switch (actionType) {
    case "Stock In":
      return previousQuantity + quantity;
    case "Stock Out":
      return previousQuantity - quantity;
    case "Set Stock On Hand":
      return quantity;
  }
}

const csvNumberValue = (value: unknown) => {
  const text = stringValue(value).replace(/\$/g, "").replace(/,/g, "").trim();

  if (!text) {
    return null;
  }

  const numericText = text.replace(/[^0-9.-]/g, "");
  const parsed = Number(numericText);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);

const formatDateTime = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not saved yet" : date.toLocaleString();
};

const formatNumber = (value: number) =>
  Number.isFinite(value) ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value) : "0";

const defaultLowStockAlertLevel = () => 0;

const normalizeLowStockAlertLevel = (_minimumStockLevel: number, value: unknown) => {
  const parsed = wholeNumberValue(value, defaultLowStockAlertLevel());

  return parsed >= 0 ? parsed : defaultLowStockAlertLevel();
};

const blankLocationForm = (): LocationFormState => ({
  name: "",
  description: "",
  notes: ""
});

const blankVendorForm = (): VendorFormState => ({
  name: "",
  contactName: "",
  contactEmail: "",
  phone: "",
  email: "",
  website: "",
  notes: ""
});

const blankItemForm = (defaultLocationId = ""): ItemFormState => ({
  name: "",
  partNumber: "",
  description: "",
  category: "Other",
  quantityOnHand: 0,
  stockUnit: DEFAULT_STOCK_UNIT,
  minimumStockLevel: 0,
  lowStockAlertLevel: 0,
  locationId: defaultLocationId,
  vendorId: "",
  costEach: 0,
  itemUrl: "",
  notes: "",
  imagePlaceholder: "",
  barcodePlaceholder: ""
});

const blankStockForm = (itemId = ""): StockFormState => ({
  itemId,
  actionType: "",
  quantity: 1,
  reason: "",
  actor: "",
  notes: "",
  occurredAt: toDateTimeLocal()
});

function createDefaultSettings(now = nowIso()): AppSettings {
  return {
    id: "appSettings",
    companyShopName: "JBT USA Maintenance",
    headerBadgeText: DEFAULT_HEADER_BADGE_TEXT,
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
    lastBackupTimestamp: "",
    lastAutoImportTimestamp: "",
    backupStatus: "Choose backup folder to enable auto backup and auto import.",
    createdAt: now,
    updatedAt: now
  };
}

function createLocation(name: string, details: Partial<LocationRecord> = {}): LocationRecord {
  const now = nowIso();

  return {
    id: details.id ?? createId(),
    name,
    description: details.description ?? "",
    notes: details.notes ?? "",
    isDemo: details.isDemo,
    createdAt: details.createdAt ?? now,
    updatedAt: details.updatedAt ?? now
  };
}

function createVendor(name: string, details: Partial<VendorRecord> = {}): VendorRecord {
  const now = nowIso();

  return {
    id: details.id ?? createId(),
    name,
    contactName: details.contactName ?? "",
    contactEmail: details.contactEmail ?? "",
    phone: details.phone ?? "",
    email: details.email ?? "",
    website: details.website ?? "",
    notes: details.notes ?? "",
    isDemo: details.isDemo,
    createdAt: details.createdAt ?? now,
    updatedAt: details.updatedAt ?? now
  };
}

function createAuditEntry(
  entityType: AuditEntityType,
  entityId: string,
  action: string,
  summary: string,
  actor = "System",
  occurredAt = nowIso(),
  isDemo = false
): AuditEntry {
  return {
    id: createId(),
    entityType,
    entityId,
    action,
    summary,
    actor: actor || "System",
    occurredAt,
    isDemo
  };
}

function createDemoData(): AppData {
  const now = nowIso();
  const locations = [
    createLocation("Main Shop Cabinet", {
      description: "Primary maintenance storage",
      notes: "Top bins for high-use parts",
      isDemo: true
    }),
    createLocation("Line 2 Tool Crib", {
      description: "Near production line 2",
      notes: "Shared with second shift",
      isDemo: true
    }),
    createLocation("Maintenance Cart", {
      description: "Mobile emergency cart",
      notes: "Keep critical spares stocked",
      isDemo: true
    })
  ];
  const vendors = [
    createVendor("Grainger", {
      contactName: "Account Desk",
      website: "https://www.grainger.com",
      notes: "General industrial supply",
      isDemo: true
    }),
    createVendor("McMaster-Carr", {
      website: "https://www.mcmaster.com",
      notes: "Fasteners and mechanical parts",
      isDemo: true
    }),
    createVendor("Local Electrical Supply", {
      contactName: "Counter Sales",
      phone: "555-0142",
      notes: "Sensors, fuses, wiring",
      isDemo: true
    })
  ];
  const itemSeed: Array<Partial<InventoryItem> & Pick<InventoryItem, "name" | "partNumber">> = [
    {
      name: "Air Filter Element",
      partNumber: "AF-2040",
      description: "Panel filter for intake cabinet",
      category: "Filters",
      quantityOnHand: 4,
      minimumStockLevel: 2,
      lowStockAlertLevel: 3,
      locationId: locations[0].id,
      vendorId: vendors[0].id,
      costEach: 18.75,
      notes: "Check fit before reordering"
    },
    {
      name: "Drive Belt B-56",
      partNumber: "B-56",
      description: "Replacement V-belt",
      category: "Belts",
      quantityOnHand: 1,
      minimumStockLevel: 2,
      lowStockAlertLevel: 3,
      locationId: locations[1].id,
      vendorId: vendors[1].id,
      costEach: 12.4,
      notes: "Low stock sample"
    },
    {
      name: "M12 Proximity Sensor",
      partNumber: "PX-M12-NPN",
      description: "NPN prox sensor with quick disconnect",
      category: "Sensors",
      quantityOnHand: 0,
      minimumStockLevel: 1,
      lowStockAlertLevel: 2,
      locationId: locations[2].id,
      vendorId: vendors[2].id,
      costEach: 42.95,
      notes: "Out of stock sample"
    },
    {
      name: "Food Grade Grease Cartridge",
      partNumber: "FG-2-14OZ",
      description: "14 oz tube",
      category: "Lubricants",
      quantityOnHand: 12,
      minimumStockLevel: 6,
      lowStockAlertLevel: 8,
      locationId: locations[0].id,
      vendorId: vendors[0].id,
      costEach: 9.8,
      notes: "Use for weekly PMs"
    }
  ];
  const items = itemSeed.map<InventoryItem>((seed) => ({
    id: createId(),
    name: seed.name,
    partNumber: seed.partNumber,
    description: seed.description ?? "",
    category: seed.category ?? "Other",
    quantityOnHand: seed.quantityOnHand ?? 0,
    stockUnit: normalizeStockUnit(seed.stockUnit),
    minimumStockLevel: seed.minimumStockLevel ?? 1,
    lowStockAlertLevel: seed.lowStockAlertLevel ?? defaultLowStockAlertLevel(),
    locationId: seed.locationId ?? "",
    vendorId: seed.vendorId ?? "",
    costEach: seed.costEach ?? 0,
    itemUrl: "",
    notes: seed.notes ?? "",
    imagePlaceholder: "",
    barcodePlaceholder: "",
    isDemo: true,
    createdAt: now,
    updatedAt: now
  }));
  const stockChanges: StockChange[] = [
    {
      id: createId(),
      itemId: items[0].id,
      itemNameSnapshot: items[0].name,
      partNumberSnapshot: items[0].partNumber,
      vendorNameSnapshot: vendors.find((vendor) => vendor.id === items[0].vendorId)?.name || "Unassigned",
      actionType: "Stock In",
      quantity: 4,
      reason: "Initial count",
      actor: "System",
      notes: "Demo setup",
      occurredAt: now,
      previousQuantity: 0,
      newQuantity: 4,
      isDemo: true,
      createdAt: now
    },
    {
      id: createId(),
      itemId: items[2].id,
      itemNameSnapshot: items[2].name,
      partNumberSnapshot: items[2].partNumber,
      vendorNameSnapshot: vendors.find((vendor) => vendor.id === items[2].vendorId)?.name || "Unassigned",
      actionType: "Stock Out",
      quantity: 1,
      reason: "Line sensor replacement",
      actor: "Maintenance",
      notes: "Demo outage",
      occurredAt: now,
      previousQuantity: 1,
      newQuantity: 0,
      isDemo: true,
      createdAt: now
    }
  ];
  const settings = createDefaultSettings(now);

  settings.defaultLocationId = locations[0].id;

  return {
    app: "maintenance-inventory-tracker",
    version: APP_VERSION,
    lastSavedAt: now,
    items,
    locations,
    vendors,
    stockChanges,
    requisitionMadeRecords: [],
    auditLog: [
      createAuditEntry("Import", "demo", "Demo Data Loaded", "Starter maintenance inventory was created.", "System", now, true),
      createAuditEntry("Stock", stockChanges[1].id, "Stock Out", "M12 Proximity Sensor moved to Out of Stock.", "Maintenance", now, true)
    ],
    settings
  };
}

function normalizeSettings(value: unknown): AppSettings {
  const raw = asRecord(value);
  const defaults = createDefaultSettings(stringValue(raw.createdAt, nowIso()));
  const backupInterval: BackupInterval =
    raw.backupInterval === "manual"
      ? "manual"
      : raw.backupInterval === "5min"
        ? "5min"
        : raw.backupInterval === "15min"
          ? "15min"
          : "change";

  return {
    ...defaults,
    companyShopName: stringValue(raw.companyShopName, defaults.companyShopName),
    headerBadgeText: stringValue(raw.headerBadgeText, defaults.headerBadgeText),
    defaultLocationId: stringValue(raw.defaultLocationId),
    lowStockWarningsEnabled: raw.lowStockWarningsEnabled !== false,
    lowStockIncludeEqual: raw.lowStockIncludeEqual !== false,
    allowNegativeStockOverride: raw.allowNegativeStockOverride === true,
    backupEnabled: raw.backupEnabled === true,
    backupInterval,
    autoImportEnabled: raw.autoImportEnabled !== false,
    backupDirectoryName: stringValue(raw.backupDirectoryName),
    backupDirectoryPath: stringValue(raw.backupDirectoryPath),
    backupDirectoryHandle:
      "backupDirectoryHandle" in raw ? (raw.backupDirectoryHandle as AppSettings["backupDirectoryHandle"]) : null,
    lastBackupTimestamp: stringValue(raw.lastBackupTimestamp),
    lastAutoImportTimestamp: stringValue(raw.lastAutoImportTimestamp),
    backupStatus: stringValue(raw.backupStatus, defaults.backupStatus),
    updatedAt: stringValue(raw.updatedAt, defaults.updatedAt)
  };
}

function normalizeLocation(value: unknown): LocationRecord {
  const raw = asRecord(value);
  const now = nowIso();

  return {
    id: stringValue(raw.id, createId()),
    name: stringValue(raw.name, "Unnamed Location"),
    description: stringValue(raw.description),
    notes: stringValue(raw.notes),
    isDemo: raw.isDemo === true,
    createdAt: stringValue(raw.createdAt, now),
    updatedAt: stringValue(raw.updatedAt, now)
  };
}

function normalizeVendor(value: unknown): VendorRecord {
  const raw = asRecord(value);
  const now = nowIso();

  return {
    id: stringValue(raw.id, createId()),
    name: stringValue(raw.name, "Unnamed Vendor"),
    contactName: stringValue(raw.contactName),
    contactEmail: stringValue(raw.contactEmail),
    phone: stringValue(raw.phone),
    email: stringValue(raw.email),
    website: stringValue(raw.website),
    notes: stringValue(raw.notes),
    isDemo: raw.isDemo === true,
    createdAt: stringValue(raw.createdAt, now),
    updatedAt: stringValue(raw.updatedAt, now)
  };
}

function normalizeItem(value: unknown): InventoryItem {
  const raw = asRecord(value);
  const now = nowIso();
  const minimumStockLevel = Math.max(0, numberValue(raw.minimumStockLevel, 0));
  const lowStockAlertLevel = normalizeLowStockAlertLevel(minimumStockLevel, raw.lowStockAlertLevel);

  return {
    id: stringValue(raw.id, createId()),
    name: stringValue(raw.name, "Unnamed Item"),
    partNumber: stringValue(raw.partNumber),
    description: stringValue(raw.description),
    category: stringValue(raw.category, "Other"),
    quantityOnHand: numberValue(raw.quantityOnHand),
    stockUnit: normalizeStockUnit(raw.stockUnit ?? raw.quantityUnit),
    minimumStockLevel,
    lowStockAlertLevel,
    locationId: stringValue(raw.locationId),
    vendorId: stringValue(raw.vendorId),
    costEach: Math.max(0, numberValue(raw.costEach)),
    itemUrl: stringValue(raw.itemUrl),
    notes: stringValue(raw.notes),
    imagePlaceholder: stringValue(raw.imagePlaceholder),
    barcodePlaceholder: stringValue(raw.barcodePlaceholder),
    isDemo: raw.isDemo === true,
    createdAt: stringValue(raw.createdAt, now),
    updatedAt: stringValue(raw.updatedAt, now)
  };
}

function normalizeStockChange(value: unknown): StockChange {
  const raw = asRecord(value);
  const now = nowIso();
  const actionType = normalizeStockAction(raw.actionType);

  return {
    id: stringValue(raw.id, createId()),
    itemId: stringValue(raw.itemId),
    itemNameSnapshot: stringValue(raw.itemNameSnapshot, "Unknown Item"),
    partNumberSnapshot: stringValue(raw.partNumberSnapshot),
    vendorNameSnapshot: stringValue(raw.vendorNameSnapshot),
    actionType,
    quantity: Math.max(0, numberValue(raw.quantity)),
    reason: stringValue(raw.reason),
    actor: stringValue(raw.actor, "System"),
    notes: stringValue(raw.notes),
    occurredAt: stringValue(raw.occurredAt, now),
    previousQuantity: numberValue(raw.previousQuantity),
    newQuantity: numberValue(raw.newQuantity),
    isDemo: raw.isDemo === true,
    createdAt: stringValue(raw.createdAt, now)
  };
}

function normalizeRequisitionMadeRecord(value: unknown): RequisitionMadeRecord {
  const raw = asRecord(value);
  const now = nowIso();
  const itemSnapshots = Array.isArray(raw.itemSnapshots)
    ? raw.itemSnapshots.map((snapshot) => {
        const item = asRecord(snapshot);
        const quantityRequested = Math.max(0, wholeNumberValue(item.quantityRequested));
        const unitCost = Math.max(0, numberValue(item.unitCost));

        return {
          itemId: stringValue(item.itemId),
          itemName: stringValue(item.itemName, "Unknown Item"),
          partNumber: stringValue(item.partNumber),
          quantityRequested,
          unitCost,
          totalCost: Math.max(0, numberValue(item.totalCost, quantityRequested * unitCost))
        };
      })
    : [];
  const itemIds = Array.isArray(raw.itemIds)
    ? raw.itemIds.map((itemId) => stringValue(itemId)).filter(Boolean)
    : itemSnapshots.map((snapshot) => snapshot.itemId).filter(Boolean);

  return {
    id: stringValue(raw.id, createId()),
    vendorKey: stringValue(raw.vendorKey),
    vendorName: stringValue(raw.vendorName, "Unassigned Vendor"),
    itemIds,
    itemSnapshots,
    totalCost: Math.max(
      0,
      numberValue(
        raw.totalCost,
        itemSnapshots.reduce((sum, snapshot) => sum + snapshot.totalCost, 0)
      )
    ),
    requisitionType: raw.requisitionType === "over100" ? "over100" : "under100",
    pdfGeneratedAt: stringValue(raw.pdfGeneratedAt, now),
    passedAt: stringValue(raw.passedAt, now),
    status: "Made"
  };
}

function normalizeAuditEntry(value: unknown): AuditEntry {
  const raw = asRecord(value);
  const now = nowIso();

  return {
    id: stringValue(raw.id, createId()),
    entityType: stringValue(raw.entityType, "Import") as AuditEntityType,
    entityId: stringValue(raw.entityId),
    action: stringValue(raw.action, "Imported"),
    summary: stringValue(raw.summary),
    actor: stringValue(raw.actor, "System"),
    occurredAt: stringValue(raw.occurredAt, now),
    isDemo: raw.isDemo === true
  };
}

function normalizeAppData(value: unknown): AppData {
  if (!value) {
    return createDemoData();
  }

  const raw = asRecord(value);
  const now = nowIso();
  const settings = normalizeSettings(raw.settings);
  const locations = Array.isArray(raw.locations) ? raw.locations.map(normalizeLocation) : [];
  const vendors = Array.isArray(raw.vendors) ? raw.vendors.map(normalizeVendor) : [];
  const items = Array.isArray(raw.items) ? raw.items.map(normalizeItem) : [];

  if (!settings.defaultLocationId && locations[0]) {
    settings.defaultLocationId = locations[0].id;
  }

  return {
    app: "maintenance-inventory-tracker",
    version: stringValue(raw.version ?? raw.appVersion, APP_VERSION),
    lastSavedAt: stringValue(raw.lastSavedAt ?? raw.lastUpdated, now),
    items,
    locations,
    vendors,
    stockChanges: Array.isArray(raw.stockChanges) ? raw.stockChanges.map(normalizeStockChange) : [],
    requisitionMadeRecords: Array.isArray(raw.requisitionMadeRecords)
      ? raw.requisitionMadeRecords.map(normalizeRequisitionMadeRecord)
      : [],
    auditLog: Array.isArray(raw.auditLog) ? raw.auditLog.map(normalizeAuditEntry) : [],
    settings
  };
}

function getInventoryStatus(item: InventoryItem, _settings?: AppSettings): InventoryStatus {
  if (item.quantityOnHand <= 0) {
    return "Out of Stock";
  }

  const lowStockAlertLevel = normalizeLowStockAlertLevel(item.minimumStockLevel, item.lowStockAlertLevel);

  if (lowStockAlertLevel > 0 && item.quantityOnHand <= lowStockAlertLevel) {
    return "Low Stock";
  }

  return "In Stock";
}

function isReorderNeeded(item: InventoryItem, settings: AppSettings) {
  const status = getInventoryStatus(item, settings);
  return status === "Low Stock" || status === "Out of Stock";
}

function pruneRequisitionMadeRecords(data: AppData): AppData {
  const lowStockItemIds = new Set(data.items.filter((item) => isReorderNeeded(item, data.settings)).map((item) => item.id));
  const requisitionMadeRecords = data.requisitionMadeRecords
    .map((record) => ({
      ...record,
      itemIds: record.itemIds.filter((itemId) => lowStockItemIds.has(itemId)),
      itemSnapshots: record.itemSnapshots.filter((snapshot) => lowStockItemIds.has(snapshot.itemId))
    }))
    .filter((record) => record.itemIds.length > 0);

  return {
    ...data,
    requisitionMadeRecords
  };
}

function addAudit(data: AppData, entry: AuditEntry): AppData {
  return {
    ...data,
    auditLog: [entry, ...data.auditLog].slice(0, 600)
  };
}

function stampData(data: AppData): AppData {
  return {
    ...data,
    version: APP_VERSION,
    lastSavedAt: nowIso()
  };
}

function getLocationName(data: AppData, id: string) {
  return data.locations.find((location) => location.id === id)?.name || "Unassigned";
}

function getVendorName(data: AppData, id: string) {
  return data.vendors.find((vendor) => vendor.id === id)?.name || "Unassigned";
}

function statusTagClassName(status: string) {
  switch (status) {
    case "In Stock":
      return "tag-in-stock";
    case "Low Stock":
      return "tag-low-stock";
    case "Out of Stock":
      return "tag-out-of-stock";
    case "Stock In":
      return "tag-stock-in";
    case "Stock Out":
      return "tag-stock-out";
    case "Set Stock On Hand":
      return "tag-stock-count";
    default:
      return "tag-default";
  }
}

function statusCardClassName(status: InventoryStatus) {
  switch (status) {
    case "Out of Stock":
      return "status-card-out-of-stock";
    case "Low Stock":
      return "status-card-low-stock";
    case "In Stock":
      return "status-card-in-stock";
  }
}

function statusMetricClassName(status: InventoryStatus) {
  switch (status) {
    case "Out of Stock":
      return "status-metric-card-out-of-stock";
    case "Low Stock":
      return "status-metric-card-low-stock";
    case "In Stock":
      return "status-metric-card-in-stock";
  }
}

function stockQuantityClassName(status: InventoryStatus) {
  switch (status) {
    case "Out of Stock":
      return "stock-quantity-out-of-stock";
    case "Low Stock":
      return "stock-quantity-low-stock";
    case "In Stock":
      return "stock-quantity-in-stock";
  }
}

function getItemUrlHref(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  return /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function getExternalHref(value: string) {
  return getItemUrlHref(value);
}

function getWebsiteDisplayText(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  try {
    const href = getExternalHref(trimmed);
    const parsed = new URL(href);
    const host = parsed.hostname.replace(/^www\./, "");
    const path = parsed.pathname && parsed.pathname !== "/" ? parsed.pathname.replace(/\/$/, "") : "";

    return path ? `${host}${path}` : host;
  } catch {
    return trimmed.length > 34 ? `${trimmed.slice(0, 34)}...` : trimmed;
  }
}

function getMailHref(value: string) {
  const trimmed = value.trim();

  return trimmed ? `mailto:${trimmed}` : "";
}

function getTauriInvoke(): TauriInvoke | undefined {
  const tauriWindow = window as Window & {
    __TAURI__?: {
      core?: {
        invoke?: TauriInvoke;
      };
    };
  };

  return tauriWindow.__TAURI__?.core?.invoke;
}

async function readVendorWebsitePreview(website: string): Promise<WebsitePreview | null> {
  const trimmedWebsite = website.trim();

  if (!trimmedWebsite) {
    return null;
  }

  const invoke = getTauriInvoke();

  if (!invoke) {
    return null;
  }

  try {
    return await invoke<WebsitePreview>("fetch_website_preview", { url: trimmedWebsite });
  } catch {
    return null;
  }
}

type VendorNoteContext = Pick<VendorRecord, "name" | "website" | "email" | "contactName" | "contactEmail" | "notes">;

function vendorFormNoteContext(form: VendorFormState): VendorNoteContext {
  return {
    name: form.name,
    website: form.website,
    email: form.email,
    contactName: form.contactName,
    contactEmail: form.contactEmail,
    notes: form.notes
  };
}

function vendorRecordNoteContext(vendor: VendorRecord, notes = vendor.notes): VendorNoteContext {
  return {
    name: vendor.name,
    website: vendor.website,
    email: vendor.email,
    contactName: vendor.contactName,
    contactEmail: vendor.contactEmail,
    notes
  };
}

function suggestVendorNoteFromContext({
  userPurpose,
  vendor,
  websitePreview
}: {
  userPurpose?: string;
  vendor: VendorNoteContext;
  websitePreview?: WebsitePreview | null;
}) {
  const source = [
    vendor.name,
    vendor.website,
    vendor.email,
    vendor.contactName,
    vendor.contactEmail,
    vendor.notes,
    websitePreview?.title,
    websitePreview?.description,
    userPurpose
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (userPurpose?.trim()) {
    return `Maintenance supplier used for ${userPurpose.trim()}.`;
  }

  if (/grainger|mcmaster|msc|fastenal|industrial|supply|zoro/.test(source)) {
    return "General industrial parts and maintenance supplies.";
  }

  if (/sensor|automation|keyence|sick|ifm|banner|omron|photoeye|proximity|prox/.test(source)) {
    return "Sensors, automation, and machine control components.";
  }

  if (/hydraulic|hose|parker|gates|fluid power|cylinder|seal|fitting/.test(source)) {
    return "Hydraulic hoses, fittings, seals, cylinders, and fluid power parts.";
  }

  if (/pneumatic|smc|festo|air|valve|solenoid|regulator|cylinder/.test(source)) {
    return "Pneumatic fittings, valves, cylinders, regulators, and air components.";
  }

  if (/electrical|fuse|wire|cable|controls|relay|breaker|terminal|panel|contactor/.test(source)) {
    return "Electrical controls, wiring, fuses, terminals, relays, and panel components.";
  }

  if (/bearing|belt|motion|drive|pulley|gearbox|chain|sprocket/.test(source)) {
    return "Bearings, belts, power transmission, and mechanical drive parts.";
  }

  if (/heater|thermocouple|temperature|temp|cartridge heater|band heater|controller/.test(source)) {
    return "Heaters, thermocouples, and temperature control parts.";
  }

  if (/mold|tooling|injection|ejector|nozzle|barrel|screw|plunger/.test(source)) {
    return "Injection molding tooling, machine components, and mold support parts.";
  }

  if (/vacuum|ejector|gripper|emi|robot|eoat|end of arm/.test(source)) {
    return "Robot EOAT, vacuum components, grippers, and automation support parts.";
  }

  return "";
}

function suggestVendorNote(vendor: VendorNoteContext) {
  return (
    suggestVendorNoteFromContext({ vendor }) || "Supplier used for maintenance parts and shop support. Review and adjust as needed."
  );
}

function cleanMaintenanceNote(value: string) {
  const original = value.trim();

  if (!original) {
    return "";
  }

  let cleaned = original
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/,+/g, ",")
    .trim();

  const wordFixes: Array<[RegExp, string]> = [
    [/\broobot\b/gi, "robot"],
    [/\broboot\b/gi, "robot"],
    [/\brobott\b/gi, "robot"],
    [/\bprats\b/gi, "parts"],
    [/\bparst\b/gi, "parts"],
    [/\bpartss\b/gi, "parts"],
    [/\bmaint\b/gi, "maintenance"],
    [/\bmaintance\b/gi, "maintenance"],
    [/\bmaintenace\b/gi, "maintenance"],
    [/\bmechancial\b/gi, "mechanical"],
    [/\bmechaincal\b/gi, "mechanical"],
    [/\belectrial\b/gi, "electrical"],
    [/\belectricl\b/gi, "electrical"],
    [/\bpnumatic\b/gi, "pneumatic"],
    [/\bpnuematic\b/gi, "pneumatic"],
    [/\bhyrdraulic\b/gi, "hydraulic"],
    [/\bhydralic\b/gi, "hydraulic"],
    [/\bsenser\b/gi, "sensor"],
    [/\bsensers\b/gi, "sensors"],
    [/\bwirring\b/gi, "wiring"],
    [/\bfiting\b/gi, "fitting"],
    [/\bfittingss\b/gi, "fittings"],
    [/\bgriper\b/gi, "gripper"],
    [/\bgripers\b/gi, "grippers"],
    [/\bthermocupple\b/gi, "thermocouple"],
    [/\bthermocoupple\b/gi, "thermocouple"],
    [/\btemperture\b/gi, "temperature"],
    [/\btemprature\b/gi, "temperature"],
    [/\beoat\b/gi, "EOAT"],
    [/\bai\b/gi, "AI"]
  ];

  wordFixes.forEach(([pattern, replacement]) => {
    cleaned = cleaned.replace(pattern, replacement);
  });

  cleaned = cleaned
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s{2,}/g, " ")
    .trim();

  const normalized = cleaned.toLowerCase();

  const phraseFixes: Array<[RegExp, string]> = [
    [/^robot,?\s*parts?\.?$/i, "Robot parts."],
    [/^robot,?\s*grippers?\.?$/i, "Robot grippers and EOAT support parts."],
    [/^sensors?,?\s*fuses?,?\s*wiring\.?$/i, "Sensors, fuses, wiring, and electrical maintenance parts."],
    [/^hydraulic,?\s*hoses?\.?$/i, "Hydraulic hoses and fittings."],
    [/^pneumatic,?\s*fittings?\.?$/i, "Pneumatic fittings and air components."],
    [/^heater,?\s*thermocouples?\.?$/i, "Heaters, thermocouples, and temperature control parts."]
  ];

  for (const [pattern, replacement] of phraseFixes) {
    if (pattern.test(normalized)) {
      return replacement;
    }
  }

  cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);

  if (!/[.!?]$/.test(cleaned)) {
    cleaned += ".";
  }

  return cleaned;
}

function isQrCellActive(value: string, index: number) {
  const size = 9;
  const row = Math.floor(index / size);
  const column = index % size;
  const inFinder =
    (row < 3 && column < 3) ||
    (row < 3 && column > size - 4) ||
    (row > size - 4 && column < 3);

  if (inFinder) {
    return row === 0 || row === 2 || column === 0 || column === 2;
  }

  const source = value.trim() || "QR";
  const seed = Array.from(source).reduce((total, character, characterIndex) => {
    return total + character.charCodeAt(0) * (characterIndex + 3);
  }, 17);

  return (seed + row * 11 + column * 7 + index * 3) % 5 < 2;
}

function getSaveHealthRows(
  data: AppData,
  backupSupported: boolean,
  lastBackupAt: string | null,
  lastAutoImportAt: string | null,
  backupIndicator: BackupIndicatorState,
  backupMessage: string
): SaveHealthRow[] {
  const hasBackupFolder = Boolean(
    data.settings.backupDirectoryName || data.settings.backupDirectoryPath || data.settings.backupDirectoryHandle
  );
  const failed = backupIndicator === "failed";
  const failureMessage = backupMessage.toLowerCase();
  const saveFailed = failed && (failureMessage.includes("save") || failureMessage.includes("load") || failureMessage.includes("local"));
  const backupFailed = failed && !saveFailed;
  const folderAccessFailed = failed && /permission|denied|folder access|choose the folder again/i.test(backupMessage);
  const autoJsonValue = !data.settings.backupEnabled
    ? "Off"
    : data.settings.backupInterval === "manual"
      ? "Manual only"
      : data.settings.backupInterval === "5min"
        ? "Every 5 minutes"
        : data.settings.backupInterval === "15min"
          ? "Every 15 minutes"
          : "After every change";
  const autoJsonTone: HealthTone = backupFailed
    ? "danger"
    : data.settings.backupEnabled && data.settings.backupInterval !== "manual"
      ? "good"
      : "warning";
  const latestBackupAt = lastBackupAt || data.settings.lastBackupTimestamp || null;
  const latestAutoImportAt = lastAutoImportAt || data.settings.lastAutoImportTimestamp || null;
  const backupStatusText = data.settings.backupStatus || backupMessage;
  const backupStatusTone: HealthTone = failed
    ? "danger"
    : /choose backup folder|not selected|not checked|not backed|no backup/i.test(backupStatusText)
      ? "warning"
      : "good";

  return [
    {
      label: "IndexedDB",
      tone: saveFailed ? "danger" : "good",
      value: saveFailed ? backupMessage : `Saved ${formatDateTime(data.lastSavedAt)}`
    },
    {
      label: "Auto JSON",
      tone: autoJsonTone,
      value: autoJsonValue
    },
    {
      label: "Backup folder",
      tone: hasBackupFolder ? "good" : "warning",
      value: data.settings.backupDirectoryName || "No backup folder selected"
    },
    {
      label: "Last backup",
      tone: backupFailed ? "danger" : latestBackupAt ? "good" : "warning",
      value: backupFailed ? backupMessage : latestBackupAt ? formatDateTime(latestBackupAt) : "No backup has run yet"
    },
    {
      label: "Auto import",
      tone: data.settings.autoImportEnabled && latestAutoImportAt ? "good" : "warning",
      value: data.settings.autoImportEnabled
        ? latestAutoImportAt
          ? `Last checked ${formatDateTime(latestAutoImportAt)}`
          : "On; not checked yet"
        : "Off"
    },
    {
      label: "Folder access",
      tone: folderAccessFailed ? "danger" : backupSupported && hasBackupFolder ? "good" : "warning",
      value: folderAccessFailed
        ? "Permission missing"
        : backupSupported
          ? hasBackupFolder
            ? "Granted"
            : "Supported; choose folder"
          : "Manual export only"
    },
    {
      label: "Backup status",
      tone: backupStatusTone,
      value: failed ? backupMessage : backupStatusText
    }
  ];
}

function getOverallHealthTone(rows: SaveHealthRow[]): HealthTone {
  if (rows.some((row) => row.tone === "danger")) {
    return "danger";
  }

  return rows.some((row) => row.tone === "warning") ? "warning" : "good";
}

function getBackupStatusInfo(data: AppData, backupSupported: boolean, backupIndicator: BackupIndicatorState, backupMessage: string): BackupStatusInfo {
  const hasBackupFolder = Boolean(
    data.settings.backupDirectoryName || data.settings.backupDirectoryPath || data.settings.backupDirectoryHandle
  );

  if (backupIndicator === "failed") {
    return { pulse: false, tone: "danger", tooltip: backupMessage || "Backup failed" };
  }

  if (backupIndicator === "pending") {
    return { pulse: false, tone: "warning", tooltip: "Save pending" };
  }

  if (backupIndicator === "running") {
    return { pulse: true, tone: "good", tooltip: backupMessage || "Backup running" };
  }

  if (backupIndicator === "done") {
    return { pulse: true, tone: "good", tooltip: backupMessage.startsWith("Backed up") ? "Backed up" : "Saved locally" };
  }

  if (!backupSupported) {
    return { pulse: false, tone: "warning", tooltip: "Manual export only" };
  }

  if (!data.settings.backupEnabled) {
    return { pulse: false, tone: "warning", tooltip: "Auto JSON backup is off" };
  }

  if (!hasBackupFolder) {
    return { pulse: false, tone: "warning", tooltip: "Backup folder not selected" };
  }

  if (data.settings.backupInterval === "manual") {
    return { pulse: false, tone: "warning", tooltip: "Manual export only" };
  }

  return { pulse: false, tone: "good", tooltip: backupMessage.startsWith("Backed up") ? "Backed up" : "Saved locally" };
}

function getRecentAddAlerts(data: AppData, nowMs: number): RecentAddAlert[] {
  return data.auditLog
    .filter((entry) => {
      const occurredAt = new Date(entry.occurredAt).getTime();

      if (!Number.isFinite(occurredAt) || nowMs - occurredAt > RECENT_ACTIVITY_WINDOW_MS) {
        return false;
      }

      return (
        (entry.entityType === "Item" && entry.action.includes("Item Created")) ||
        (entry.entityType === "Vendor" && entry.action.includes("Vendor Created"))
      );
    })
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, 4)
    .map((entry) => {
      const name = entry.summary
        .replace(/\s+was\s+(added|created|imported).*$/i, "")
        .replace(/\.$/, "")
        .trim();

      return {
        id: entry.id,
        label: entry.entityType === "Vendor" ? "New vendor added" : "New item added",
        name: name || entry.summary || entry.entityType,
        occurredAt: entry.occurredAt
      };
    });
}

function normalizeCsvHeader(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function getCsvHeaderScore(headers: string[]) {
  const hasAny = (...names: string[]) => headers.some((header) => names.includes(header));
  let score = 0;

  if (hasAny("partnumber", "partno", "partnum", "part")) {
    score += 3;
  }

  if (hasAny("itemname", "name", "description", "desc")) {
    score += 2;
  }

  if (hasAny("vendor", "vendorname", "supplier")) {
    score += 1;
  }

  if (hasAny("qty", "quantity", "quantityonhand", "onhand", "qoh")) {
    score += 1;
  }

  if (hasAny("cost", "costeach", "unitcost", "unitprice", "price")) {
    score += 1;
  }

  return score;
}

function findCsvHeaderRow(rows: string[][]) {
  const headerRowIndex = rows.findIndex((row) => getCsvHeaderScore(row.map(normalizeCsvHeader)) >= 4);

  if (headerRowIndex < 0) {
    throw new Error("Could not find a CSV header row with part, description, vendor, quantity, or cost columns.");
  }

  return headerRowIndex;
}

function buildCsvColumnIndexes(headerRow: string[]): CsvColumnIndexes {
  const headers = headerRow.map(normalizeCsvHeader);
  const indexOf = (...names: string[]) => headers.findIndex((header) => names.includes(header));

  return {
    asset: indexOf("asset", "assetname", "equipment"),
    category: indexOf("category", "type"),
    cost: indexOf("costeach", "unitcost", "unitprice", "price", "cost"),
    dept: indexOf("dept", "department"),
    description: indexOf("description", "desc"),
    itemUrl: indexOf("itemurl", "url", "link", "hyperlink", "partinfourl", "hyperlinkpartinfourl", "website"),
    location: indexOf("location", "locationname"),
    lowStockAlert: indexOf("lowstockalertlevel", "lowstockalert", "alertlevel", "stockalertlevel", "warningstocklevel", "warninglevel"),
    minimum: indexOf("minimumstocklevel", "minimumstock", "minimum", "minstock", "min"),
    name: indexOf("itemname", "name", "partname"),
    notes: indexOf("notes", "note", "comments", "comment"),
    partNumber: indexOf("partnumber", "partno", "partnum", "part"),
    quantity: indexOf("quantityonhand", "quantity", "qty", "onhand", "qoh"),
    stockUnit: indexOf("stockunit", "quantityunit", "unit", "uom"),
    vendor: indexOf("vendor", "vendorname", "supplier")
  };
}

function cleanCsvText(value: unknown) {
  return stringValue(value).replace(/\s+/g, " ").trim();
}

function deriveCsvItemName(description: string, partNumber: string) {
  const descriptionName = description.split(",")[0]?.trim();
  return descriptionName || partNumber;
}

function isUsefulDeptLocation(value: string) {
  return /\b(row|bin|shelf|cabinet|crib|rack|aisle|bay|slot|drawer|line|cart|station)\b|\d/i.test(value);
}

function chooseCsvLocationName(dept: string, location: string) {
  if (dept && isUsefulDeptLocation(dept)) {
    return dept;
  }

  return location || dept;
}

function toCsvImportRecord(row: string[], indexes: CsvColumnIndexes): CsvImportRecord | null {
  const cell = (index: number) => (index >= 0 ? cleanCsvText(row[index]) : "");
  const partNumber = cell(indexes.partNumber);
  const description = cell(indexes.description);
  const name = cell(indexes.name) || deriveCsvItemName(description, partNumber);
  const asset = cell(indexes.asset);
  const notes = [cell(indexes.notes), asset ? `Asset: ${asset}` : ""].filter(Boolean).join(" | ");

  if (![name, partNumber, description, cell(indexes.vendor), cell(indexes.location), cell(indexes.dept)].some(Boolean)) {
    return null;
  }

  return {
    category: cell(indexes.category),
    costEach: csvNumberValue(cell(indexes.cost)),
    description,
    itemUrl: cell(indexes.itemUrl),
    locationName: chooseCsvLocationName(cell(indexes.dept), cell(indexes.location)),
    lowStockAlertLevel: csvNumberValue(cell(indexes.lowStockAlert)),
    minimumStockLevel: csvNumberValue(cell(indexes.minimum)),
    name: name || partNumber,
    notes,
    partNumber,
    quantityOnHand: csvNumberValue(cell(indexes.quantity)),
    stockUnit: normalizeStockUnit(cell(indexes.stockUnit)),
    vendorName: cell(indexes.vendor)
  };
}

function getItemImportKey(item: Pick<InventoryItem, "name" | "partNumber">) {
  const partNumber = item.partNumber.trim().toLowerCase();
  return partNumber ? `part:${partNumber}` : `name:${item.name.trim().toLowerCase()}`;
}

function buildCsvImportPreview(contents: string, data: AppData, fileName: string): CsvImportPreview {
  const rows = parseCsv(contents);

  if (rows.length < 2) {
    throw new Error("CSV file has no inventory rows.");
  }

  const headerRowIndex = findCsvHeaderRow(rows);
  const indexes = buildCsvColumnIndexes(rows[headerRowIndex]);
  const records = rows
    .slice(headerRowIndex + 1)
    .map((row) => toCsvImportRecord(row, indexes))
    .filter((record): record is CsvImportRecord => Boolean(record && (record.name || record.partNumber)));

  if (records.length === 0) {
    throw new Error("CSV file has no importable inventory rows.");
  }

  const existingItemKeys = new Set(data.items.map(getItemImportKey));
  const existingVendors = new Set(data.vendors.map((vendor) => vendor.name.trim().toLowerCase()).filter(Boolean));
  const existingLocations = new Set(data.locations.map((location) => location.name.trim().toLowerCase()).filter(Boolean));
  const vendorsToCreate = new Map<string, string>();
  const locationsToCreate = new Map<string, string>();
  let newItems = 0;
  let updatedItems = 0;

  records.forEach((record) => {
    const itemKey = getItemImportKey(record);

    if (existingItemKeys.has(itemKey)) {
      updatedItems += 1;
    } else {
      newItems += 1;
      existingItemKeys.add(itemKey);
    }

    const vendorKey = record.vendorName.trim().toLowerCase();
    if (vendorKey && !existingVendors.has(vendorKey) && !vendorsToCreate.has(vendorKey)) {
      vendorsToCreate.set(vendorKey, record.vendorName);
    }

    const locationKey = record.locationName.trim().toLowerCase();
    if (locationKey && !existingLocations.has(locationKey) && !locationsToCreate.has(locationKey)) {
      locationsToCreate.set(locationKey, record.locationName);
    }
  });

  return {
    contents,
    fileName,
    headerRowNumber: headerRowIndex + 1,
    locationsToCreate: Array.from(locationsToCreate.values()),
    newItems,
    records,
    rowsFound: records.length,
    updatedItems,
    vendorsToCreate: Array.from(vendorsToCreate.values())
  };
}

function itemFromForm(form: ItemFormState, existing?: InventoryItem): InventoryItem {
  const now = nowIso();
  const minimumStockLevel = Math.max(0, wholeNumberValue(form.minimumStockLevel));
  const lowStockAlertLevel = normalizeLowStockAlertLevel(minimumStockLevel, form.lowStockAlertLevel);

  return {
    id: existing?.id ?? createId(),
    name: form.name.trim(),
    partNumber: form.partNumber.trim(),
    description: form.description.trim(),
    category: form.category.trim() || "Other",
    quantityOnHand: wholeNumberValue(form.quantityOnHand),
    stockUnit: normalizeStockUnit(form.stockUnit),
    minimumStockLevel,
    lowStockAlertLevel,
    locationId: form.locationId,
    vendorId: form.vendorId,
    costEach: Math.max(0, numberValue(form.costEach)),
    itemUrl: form.itemUrl.trim(),
    notes: form.notes.trim(),
    imagePlaceholder: form.imagePlaceholder.trim(),
    barcodePlaceholder: form.barcodePlaceholder.trim(),
    isDemo: existing?.isDemo,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
}

function formFromItem(item: InventoryItem): ItemFormState {
  return {
    name: item.name,
    partNumber: item.partNumber,
    description: item.description,
    category: item.category,
    quantityOnHand: item.quantityOnHand,
    stockUnit: normalizeStockUnit(item.stockUnit),
    minimumStockLevel: item.minimumStockLevel,
    lowStockAlertLevel: item.lowStockAlertLevel,
    locationId: item.locationId,
    vendorId: item.vendorId,
    costEach: item.costEach,
    itemUrl: item.itemUrl,
    notes: item.notes,
    imagePlaceholder: item.imagePlaceholder,
    barcodePlaceholder: item.barcodePlaceholder
  };
}

type AuthStage =
  | "checking"
  | "setup"
  | "setup-code"
  | "login"
  | "loading"
  | "recovery-code"
  | "recovery-reset"
  | "recovery-complete"
  | "ready";

const PASSWORD_MIN_LENGTH = 6;

function App() {
  return (
    <AuthGate>
      <InventoryApp />
    </AuthGate>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const [stage, setStage] = useState<AuthStage>("checking");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newConfirmPassword, setNewConfirmPassword] = useState("");
  const [shownRecoveryCode, setShownRecoveryCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const authRecord = readAuthRecord();

    if (!authRecord) {
      setStage("setup");
    } else {
      setStage(isAuthSessionUnlocked() ? "ready" : "login");
    }
  }, []);

  const startUnlockLoading = () => {
    const authRecord = readAuthRecord();

    if (authRecord) {
      setAuthSessionUnlocked(authRecord);
    }

    setStage("ready");
  };

  const validatePasswordPair = (candidate: string, confirmation: string) => {
    if (candidate.length < PASSWORD_MIN_LENGTH) {
      return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
    }

    if (candidate !== confirmation) {
      return "Passwords do not match.";
    }

    return "";
  };

  async function handleSetupSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");

    const validationError = validatePasswordPair(password, confirmPassword);

    if (validationError) {
      setError(validationError);
      return;
    }

    setBusy(true);

    try {
      const result = await createAuthRecord(password, recoveryEmail);

      setShownRecoveryCode(result.recoveryCode);
      setPassword("");
      setConfirmPassword("");
      setStage("setup-code");
    } catch (setupError) {
      setError(setupError instanceof Error ? setupError.message : "Could not create the local password.");
    } finally {
      setBusy(false);
    }
  }

  async function handleLoginSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);

    try {
      if (!(await verifyPassword(password))) {
        setError("Password did not match this inventory system.");
        return;
      }

      setPassword("");
      startUnlockLoading();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Could not unlock the inventory system.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRecoveryCodeSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);

    try {
      if (!(await verifyRecoveryCode(recoveryCode))) {
        setError("Recovery code did not match this inventory system.");
        return;
      }

      setStage("recovery-reset");
    } catch (recoveryError) {
      setError(recoveryError instanceof Error ? recoveryError.message : "Could not verify the recovery code.");
    } finally {
      setBusy(false);
    }
  }

  async function handlePasswordResetSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");

    const validationError = validatePasswordPair(newPassword, newConfirmPassword);

    if (validationError) {
      setError(validationError);
      return;
    }

    setBusy(true);

    try {
      const result = await resetPasswordWithRecovery(recoveryCode, newPassword);

      if (!result) {
        setError("Recovery code expired or no longer matches.");
        setStage("recovery-code");
        return;
      }

      setShownRecoveryCode(result.recoveryCode);
      setNewPassword("");
      setNewConfirmPassword("");
      setRecoveryCode("");
      setStage("recovery-complete");
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Could not reset the password.");
    } finally {
      setBusy(false);
    }
  }

  if (stage === "checking") {
    return <MaintenanceLoadingScreen />;
  }

  if (stage === "loading") {
    return <MaintenanceLoadingScreen />;
  }

  if (stage === "ready") {
    return <>{children}</>;
  }

  const authRecord = readAuthRecord();

  return (
    <main className="auth-shell app-shell min-h-screen p-4 text-slate-100">
      <section className="auth-panel">
        <div className="auth-brand">
          <AppLogoMark />
          <div>
            <p className="eyebrow">Maintenance access control</p>
            <h1>Maintenance Inventory Tracker</h1>
          </div>
        </div>
        <div className="auth-security-strip" aria-hidden="true">
          <span>Secure local station</span>
          <span>Protected access</span>
        </div>

        {stage === "setup" && (
          <form className="auth-form" onSubmit={handleSetupSubmit}>
            <div>
              <h2>Create Local Password</h2>
              <p>Set the shop password before the inventory system opens on this device.</p>
            </div>
            <label className="field-label">
              Password
              <input
                className="input"
                autoComplete="new-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <label className="field-label">
              Confirm password
              <input
                className="input"
                autoComplete="new-password"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </label>
            <label className="field-label">
              Recovery email optional
              <input
                className="input"
                autoComplete="email"
                placeholder="future email-code recovery"
                type="email"
                value={recoveryEmail}
                onChange={(event) => setRecoveryEmail(event.target.value)}
              />
            </label>
            {error && <p className="auth-alert">{error}</p>}
            <button className="btn-primary" type="submit" disabled={busy}>
              Create Password
            </button>
          </form>
        )}

        {stage === "setup-code" && (
          <div className="auth-form">
            <div>
              <h2>Save Recovery Code</h2>
              <p>This code is shown one time. Save it before opening the inventory system.</p>
            </div>
            <div className="recovery-code-card" aria-label="One-time recovery code">
              {shownRecoveryCode}
            </div>
            <button className="btn-primary" type="button" onClick={startUnlockLoading}>
              I Saved This Code
            </button>
          </div>
        )}

        {stage === "login" && (
          <form className="auth-form" onSubmit={handleLoginSubmit}>
            <div>
              <h2>Unlock Inventory</h2>
              <p>Enter the local password for this maintenance inventory station.</p>
            </div>
            <label className="field-label">
              Password
              <input
                className="input"
                autoComplete="current-password"
                autoFocus
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {error && <p className="auth-alert">{error}</p>}
            <div className="auth-actions">
              <button className="btn-primary" type="submit" disabled={busy}>
                Unlock
              </button>
              <button
                className="btn-muted"
                type="button"
                onClick={() => {
                  setError("");
                  setRecoveryCode("");
                  setStage("recovery-code");
                }}
              >
                Forgot password?
              </button>
            </div>
          </form>
        )}

        {stage === "recovery-code" && (
          <form className="auth-form" onSubmit={handleRecoveryCodeSubmit}>
            <div>
              <h2>Password Recovery</h2>
              <p>Enter the saved recovery code for this local inventory lock.</p>
            </div>
            <label className="field-label">
              Recovery code
              <input
                className="input"
                autoComplete="one-time-code"
                placeholder="MT-XXXX-XXXX-XXXX"
                value={formatRecoveryCode(recoveryCode)}
                onChange={(event) => setRecoveryCode(event.target.value)}
              />
            </label>
            <p className="auth-note">
              Email recovery will be added later{authRecord?.recoveryEmail ? ` for ${authRecord.recoveryEmail}` : ""}.
            </p>
            {error && <p className="auth-alert">{error}</p>}
            <div className="auth-actions">
              <button className="btn-primary" type="submit" disabled={busy}>
                Verify Code
              </button>
              <button
                className="btn-muted"
                type="button"
                onClick={() => {
                  setError("");
                  setStage("login");
                }}
              >
                Back to Login
              </button>
            </div>
          </form>
        )}

        {stage === "recovery-reset" && (
          <form className="auth-form" onSubmit={handlePasswordResetSubmit}>
            <div>
              <h2>Set New Password</h2>
              <p>The recovery code matched. Create a new password for this device.</p>
            </div>
            <label className="field-label">
              New password
              <input
                className="input"
                autoComplete="new-password"
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
            <label className="field-label">
              Confirm new password
              <input
                className="input"
                autoComplete="new-password"
                type="password"
                value={newConfirmPassword}
                onChange={(event) => setNewConfirmPassword(event.target.value)}
              />
            </label>
            {error && <p className="auth-alert">{error}</p>}
            <button className="btn-primary" type="submit" disabled={busy}>
              Reset Password
            </button>
          </form>
        )}

        {stage === "recovery-complete" && (
          <div className="auth-form">
            <div>
              <h2>New Recovery Code</h2>
              <p>Your password was reset. Save this new recovery code now; the previous code no longer works.</p>
            </div>
            <div className="recovery-code-card" aria-label="New one-time recovery code">
              {shownRecoveryCode}
            </div>
            <button className="btn-primary" type="button" onClick={startUnlockLoading}>
              I Saved This Code
            </button>
          </div>
        )}
      </section>
    </main>
  );
}

function MaintenanceLoadingScreen() {
  const loadingStatusMessages = [
    "Loading inventory database...",
    "Checking local stock records...",
    "Preparing maintenance dashboard...",
    "Checking backup status..."
  ];
  const [statusIndex, setStatusIndex] = useState(0);

  useEffect(() => {
    const intervalId = window.setInterval(
      () => setStatusIndex((current) => (current + 1) % loadingStatusMessages.length),
      1400
    );

    return () => window.clearInterval(intervalId);
  }, [loadingStatusMessages.length]);

  return (
    <main className="industrial-loading-shell app-shell min-h-screen p-4 text-slate-100">
      <section className="loading-panel" aria-busy="true" aria-live="polite">
        <div className="industrial-loader-card">
          <div className="industrial-loader-grid" aria-hidden="true" />
          <div className="loader-header-row">
            <div className="inventory-loader-badge">
              <AppLogoMark />
              <span className="loader-badge-light" />
            </div>
            <div>
              <p className="eyebrow">Local desktop startup</p>
              <h1>Maintenance Inventory Tracker</h1>
            </div>
          </div>
          <div className="scanner-window" aria-hidden="true">
            <span className="scanner-rack" />
            <span className="scanner-crate scanner-crate-left" />
            <span className="scanner-crate scanner-crate-right" />
            <span className="scanner-beam" />
          </div>
          <div className="loader-status-row">
            <StatusDot state="running" />
            <p>{loadingStatusMessages[statusIndex]}</p>
          </div>
          <div className="loader-progress-track" aria-hidden="true">
            <span />
          </div>
        </div>
      </section>
    </main>
  );
}

function AppLogoMark() {
  return (
    <span className="tool-mark" aria-hidden="true">
      <img src="/brand/maintenance-inventory-logo.png" alt="" />
    </span>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-hidden="true">
      <path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6z" />
      <path d="M19.4 13.5a7.7 7.7 0 0 0 .1-1.5 7.7 7.7 0 0 0-.1-1.5l2-1.5-2-3.4-2.4 1a8.2 8.2 0 0 0-2.5-1.4L14.2 2h-4.4l-.4 2.7A8.2 8.2 0 0 0 7 6.1l-2.5-1-2 3.4 2.1 1.5a7.7 7.7 0 0 0-.1 1.5 7.7 7.7 0 0 0 .1 1.5l-2.1 1.5 2 3.4 2.5-1a8.2 8.2 0 0 0 2.4 1.4l.4 2.7h4.4l.3-2.7a8.2 8.2 0 0 0 2.5-1.4l2.4 1 2-3.4-2-1.5z" />
    </svg>
  );
}

function ReturnDashboardIcon() {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-hidden="true">
      <path d="M10 7l-5 5 5 5" />
      <path d="M6 12h9.5a4.5 4.5 0 0 1 0 9H13" />
    </svg>
  );
}

function CollapseHeaderIcon() {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-hidden="true">
      <path d="M6 15l6-6 6 6" />
    </svg>
  );
}

function ExpandHeaderIcon() {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function InventoryApp() {
  const [data, setData] = useState<AppData | null>(null);
  const [activePage, setActivePage] = useState<PageId>("dashboard");
  const [isChromeCollapsed, setIsChromeCollapsed] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [backupIndicator, setBackupIndicator] = useState<BackupIndicatorState>("saved");
  const [backupMessage, setBackupMessage] = useState("Loading local data");
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [lastAutoImportAt, setLastAutoImportAt] = useState<string | null>(null);
  const [newRecoveryCode, setNewRecoveryCode] = useState("");
  const [activityNow, setActivityNow] = useState(() => Date.now());
  const [isAddLocationOpen, setIsAddLocationOpen] = useState(false);
  const [isAddVendorOpen, setIsAddVendorOpen] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [backupDialog, setBackupDialog] = useState<BackupDialogState | null>(null);
  const [manualUpdateNotice, setManualUpdateNotice] = useState<ManualInstallerCheckResult | null>(null);
  const [csvImportPreview, setCsvImportPreview] = useState<CsvImportPreview | null>(null);
  const [itemForm, setItemForm] = useState<ItemFormState>(blankItemForm());
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [isItemFormOpen, setIsItemFormOpen] = useState(false);
  const [stockForm, setStockForm] = useState<StockFormState>(blankStockForm());
  const [locationForm, setLocationForm] = useState<LocationFormState>(blankLocationForm());
  const [vendorForm, setVendorForm] = useState<VendorFormState>(blankVendorForm());
  const [editingVendorId, setEditingVendorId] = useState<string | null>(null);
  const [vendorAiPrompt, setVendorAiPrompt] = useState<VendorAiPromptState | null>(null);
  const [vendorAiPromptText, setVendorAiPromptText] = useState("");
  const [recentlySavedVendorNoteId, setRecentlySavedVendorNoteId] = useState<string | null>(null);
  const [inventorySearch, setInventorySearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | InventoryStatus>("All");
  const [isEditingHeaderBadge, setIsEditingHeaderBadge] = useState(false);
  const [headerBadgeDraft, setHeaderBadgeDraft] = useState(DEFAULT_HEADER_BADGE_TEXT);
  const hasLoadedRef = useRef(false);
  const startupBackupCheckRef = useRef(false);
  const startupManualUpdateCheckRef = useRef(false);
  const setupPromptDismissedRef = useRef(false);
  const suppressNextAutoBackupRef = useRef(false);
  const pendingTimedBackupRef = useRef(false);
  const latestDataRef = useRef<AppData | null>(null);
  const skipHeaderBadgeSaveRef = useRef(false);
  const vendorAiPromptResolveRef = useRef<((note: string | null) => void) | null>(null);

  useEffect(() => {
    let cancelled = false;

    loadAppData()
      .then((savedData) => {
        if (cancelled) {
          return;
        }

        const normalized = normalizeAppData(savedData);

        setData(normalized);
        latestDataRef.current = normalized;
        setLastBackupAt(normalized.settings.lastBackupTimestamp || null);
        setLastAutoImportAt(normalized.settings.lastAutoImportTimestamp || null);
        setItemForm(blankItemForm(normalized.settings.defaultLocationId));
        setStockForm(blankStockForm(normalized.items[0]?.id ?? ""));
        setBackupMessage(normalized.settings.backupStatus || `Saved locally ${formatDateTime(normalized.lastSavedAt)}`);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        const fallback = createDemoData();

        setData(fallback);
        latestDataRef.current = fallback;
        setLastBackupAt(fallback.settings.lastBackupTimestamp || null);
        setLastAutoImportAt(fallback.settings.lastAutoImportTimestamp || null);
        setItemForm(blankItemForm(fallback.settings.defaultLocationId));
        setStockForm(blankStockForm(fallback.items[0]?.id ?? ""));
        setBackupIndicator("failed");
        setBackupMessage(error instanceof Error ? error.message : "Could not load local data.");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => setActivityNow(Date.now()), 30_000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    latestDataRef.current = data;
  }, [data]);

  useEffect(() => {
    if (!data || startupBackupCheckRef.current) {
      return;
    }

    startupBackupCheckRef.current = true;
    void runStartupBackupChecks(data);
  }, [data]);

  useEffect(() => {
    if (!data || startupManualUpdateCheckRef.current) {
      return;
    }

    startupManualUpdateCheckRef.current = true;
    checkManualInstallerFolder()
      .then((result) => {
        if (result.newerInstaller) {
          setManualUpdateNotice(result);
        }
      })
      .catch(() => {
        // Startup update checks stay quiet unless a newer local installer is found.
      });
  }, [data]);

  useEffect(() => {
    if (!data) {
      return;
    }

    if (!hasLoadedRef.current) {
      hasLoadedRef.current = true;
      return;
    }

    const skipAutoBackup = suppressNextAutoBackupRef.current;
    suppressNextAutoBackupRef.current = false;

    setBackupIndicator("pending");
    setBackupMessage("Change pending");

    const timeoutId = window.setTimeout(() => {
      saveAppData(data)
        .then(async () => {
          const hasBackupTarget = Boolean(data.settings.backupDirectoryPath || data.settings.backupDirectoryHandle);

          if (!skipAutoBackup && data.settings.backupEnabled && hasBackupTarget) {
            if (data.settings.backupInterval === "change") {
              await runBackup(data, false);
              return;
            }

            if (data.settings.backupInterval === "5min" || data.settings.backupInterval === "15min") {
              pendingTimedBackupRef.current = true;
            }
          }

          if (
            skipAutoBackup &&
            data.settings.backupStatus &&
            /failed|permission|denied|missing|no backup file|could not/i.test(data.settings.backupStatus)
          ) {
            setBackupIndicator("failed");
            setBackupMessage(data.settings.backupStatus);
            return;
          }

          setBackupIndicator("done");
          setBackupMessage(skipAutoBackup && data.settings.backupStatus ? data.settings.backupStatus : `Saved locally ${formatDateTime(data.lastSavedAt)}`);
          window.setTimeout(() => setBackupIndicator((current) => (current === "done" ? "saved" : current)), 2000);
        })
        .catch((error) => {
          setBackupIndicator("failed");
          setBackupMessage(error instanceof Error ? error.message : "Save failed");
        });
    }, 400);

    return () => window.clearTimeout(timeoutId);
  }, [data]);

  useEffect(() => {
    if (
      !data?.settings.backupEnabled ||
      (data.settings.backupInterval !== "5min" && data.settings.backupInterval !== "15min") ||
      !(data.settings.backupDirectoryPath || data.settings.backupDirectoryHandle)
    ) {
      return;
    }

    const intervalMs = TIMED_BACKUP_INTERVAL_MS[data.settings.backupInterval];
    const intervalId = window.setInterval(() => {
      const snapshot = latestDataRef.current;

      if (!snapshot || !pendingTimedBackupRef.current) {
        return;
      }

      pendingTimedBackupRef.current = false;
      void runBackup(snapshot, false);
    }, intervalMs);

    return () => window.clearInterval(intervalId);
  }, [
    data?.settings.backupDirectoryHandle,
    data?.settings.backupDirectoryPath,
    data?.settings.backupEnabled,
    data?.settings.backupInterval
  ]);

  const filteredItems = useMemo(() => {
    if (!data) {
      return [];
    }

    const search = inventorySearch.trim().toLowerCase();

    return data.items
      .filter((item) => {
        const status = getInventoryStatus(item, data.settings);

        if (statusFilter !== "All" && status !== statusFilter) {
          return false;
        }

        if (!search) {
          return true;
        }

        return [
          item.name,
          item.partNumber,
          item.category,
          item.stockUnit,
          item.description,
          item.notes,
          getLocationName(data, item.locationId),
          getVendorName(data, item.vendorId)
        ]
          .join(" ")
          .toLowerCase()
          .includes(search);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data, inventorySearch, statusFilter]);

  const reorderItems = useMemo(() => {
    if (!data) {
      return [];
    }

    return data.items
      .filter((item) => isReorderNeeded(item, data.settings))
      .sort((a, b) => a.quantityOnHand - b.quantityOnHand || a.name.localeCompare(b.name));
  }, [data]);

  function showToast(tone: ToastTone, text: string) {
    setToast({ tone, text });
    window.setTimeout(() => setToast(null), 4000);
  }

  async function openManualUpdateFolderFromNotice(updateCheck: ManualInstallerCheckResult) {
    try {
      await openInstallerFolder(updateCheck.folderPath);
      setManualUpdateNotice(null);
    } catch (error) {
      showToast("warning", error instanceof Error ? error.message : "Could not open installer folder.");
    }
  }

  function closeSettingsPanel() {
    setIsSettingsOpen(false);
    setNewRecoveryCode("");
  }

  function toggleSettingsPanel() {
    if (isSettingsOpen) {
      closeSettingsPanel();
      return;
    }

    setIsSettingsOpen(true);
  }

  function openPage(page: PageId) {
    setActivePage(page);
    setIsChromeCollapsed(page === "inventory");
    closeSettingsPanel();
  }

  function openInventoryForItemForm() {
    if (activePage !== "inventory") {
      openPage("inventory");
      return;
    }

    closeSettingsPanel();
  }

  function startAddItem() {
    setEditingItemId(null);
    setItemForm(blankItemForm(data?.settings.defaultLocationId ?? ""));
    setIsItemFormOpen(true);
    openInventoryForItemForm();
  }

  function closeItemForm() {
    setIsItemFormOpen(false);
    setEditingItemId(null);
    setItemForm(blankItemForm(data?.settings.defaultLocationId ?? ""));
    setActivePage("inventory");
    closeSettingsPanel();
  }

  function startHeaderBadgeEdit() {
    if (!data) {
      return;
    }

    skipHeaderBadgeSaveRef.current = false;
    setHeaderBadgeDraft(data.settings.headerBadgeText || DEFAULT_HEADER_BADGE_TEXT);
    setIsEditingHeaderBadge(true);
  }

  function saveHeaderBadge() {
    if (skipHeaderBadgeSaveRef.current) {
      skipHeaderBadgeSaveRef.current = false;
      return;
    }

    if (!data) {
      setIsEditingHeaderBadge(false);
      return;
    }

    const nextValue = headerBadgeDraft.trim() || DEFAULT_HEADER_BADGE_TEXT;

    setIsEditingHeaderBadge(false);

    if (nextValue !== data.settings.headerBadgeText) {
      updateSettings({ ...data.settings, headerBadgeText: nextValue }, "Header badge text was updated.");
    }
  }

  function cancelHeaderBadgeEdit() {
    skipHeaderBadgeSaveRef.current = true;
    setHeaderBadgeDraft(data?.settings.headerBadgeText || DEFAULT_HEADER_BADGE_TEXT);
    setIsEditingHeaderBadge(false);
  }

  function handleHeaderBadgeKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      saveHeaderBadge();
    }

    if (event.key === "Escape") {
      event.preventDefault();
      cancelHeaderBadgeEdit();
    }
  }

  function commitData(updater: (current: AppData) => AppData) {
    setData((current) => (current ? stampData(pruneRequisitionMadeRecords(updater(current))) : current));
  }

  function hasBackupTarget(settings: AppSettings) {
    return Boolean(settings.backupDirectoryPath || settings.backupDirectoryHandle);
  }

  function backupTargetFromSelection(selection: BackupDirectorySelection) {
    return {
      backupDirectoryHandle: selection.directoryHandle,
      backupDirectoryPath: selection.directoryPath
    };
  }

  function settingsWithBackupSelection(settings: AppSettings, selection: BackupDirectorySelection): AppSettings {
    return {
      ...settings,
      backupEnabled: true,
      autoImportEnabled: true,
      backupDirectoryHandle: selection.directoryHandle,
      backupDirectoryName: selection.directoryName,
      backupDirectoryPath: selection.directoryPath,
      backupStatus: "Backup folder selected.",
      updatedAt: nowIso()
    };
  }

  function dataWithBackupSelection(snapshot: AppData, selection: BackupDirectorySelection): AppData {
    return {
      ...snapshot,
      settings: settingsWithBackupSelection(snapshot.settings, selection)
    };
  }

  function applyBackupDirectorySelection(selection: BackupDirectorySelection) {
    const savedAt = nowIso();

    suppressNextAutoBackupRef.current = true;
    setData((current) =>
      current
        ? {
            ...current,
            lastSavedAt: savedAt,
            settings: {
              ...settingsWithBackupSelection(current.settings, selection),
              updatedAt: savedAt
            }
          }
        : current
    );
  }

  function updateBackupMetadata(partial: Partial<Pick<AppSettings, "backupStatus" | "lastAutoImportTimestamp" | "lastBackupTimestamp">>) {
    const savedAt = nowIso();

    suppressNextAutoBackupRef.current = true;
    setData((current) =>
      current
        ? {
            ...current,
            lastSavedAt: savedAt,
            settings: {
              ...current.settings,
              ...partial,
              updatedAt: savedAt
            }
          }
        : current
    );
  }

  function parseAndValidateBackup(contents: string, fileLastModifiedAt: string | null) {
    const payload = validateBackupPayload(JSON.parse(contents));

    return {
      backupTimestamp: getBackupUpdatedAt(payload, fileLastModifiedAt),
      payload
    };
  }

  async function runStartupBackupChecks(snapshot: AppData) {
    if (!hasBackupTarget(snapshot.settings)) {
      const message = "Choose backup folder to enable auto backup and auto import.";

      setBackupMessage(message);
      if (!setupPromptDismissedRef.current) {
        setBackupDialog({ kind: "setup" });
      }
      showToast("warning", message);
      return;
    }

    if (!snapshot.settings.autoImportEnabled) {
      return;
    }

    try {
      const backupRead = await readBackupFile(snapshot.settings, false);
      const { backupTimestamp, payload } = parseAndValidateBackup(backupRead.contents, backupRead.lastModifiedAt);
      const localTimestamp = getLocalDataUpdatedAt(snapshot);

      if (isBackupNewerThanLocal(backupTimestamp, localTimestamp)) {
        applyImportedBackup(payload, "auto", BACKUP_LATEST_FILENAME, "Backup imported successfully.");
        return;
      }

      const checkedAt = nowIso();
      const message = "Backup checked. Local data is already newer.";

      setLastAutoImportAt(checkedAt);
      setBackupMessage(message);
      updateBackupMetadata({ backupStatus: message, lastAutoImportTimestamp: checkedAt });
      showToast("success", message);
    } catch (error) {
      const message =
        error instanceof Error && error.message.includes("permission")
          ? "Backup folder permission is missing. Please choose the folder again."
          : error instanceof Error
            ? error.message
            : "Could not check backup file.";

      setBackupIndicator("failed");
      setBackupMessage(message);
      updateBackupMetadata({ backupStatus: message, lastAutoImportTimestamp: nowIso() });
      showToast(isMissingBackupFileError(error) ? "warning" : "danger", message);
    }
  }

  function applyImportedBackup(
    payload: InventoryBackupPayload,
    source: BackupImportSource,
    fileName: string,
    successMessage: string
  ) {
    try {
      const imported = normalizeAppData(payload);
      const importedAt = nowIso();
      const importAction =
        source === "auto" ? "Backup Auto Imported" : source === "folder" ? "Backup Imported" : "JSON Imported";
      const importActor = source === "auto" ? "Auto Import" : "User";

      suppressNextAutoBackupRef.current = true;
      setData((current) => {
        if (!current) {
          return current;
        }

        const nextSettings: AppSettings = {
          ...imported.settings,
          backupEnabled: current.settings.backupEnabled,
          backupInterval: current.settings.backupInterval,
          autoImportEnabled: current.settings.autoImportEnabled,
          backupDirectoryName: current.settings.backupDirectoryName,
          backupDirectoryPath: current.settings.backupDirectoryPath,
          backupDirectoryHandle: current.settings.backupDirectoryHandle,
          lastBackupTimestamp: current.settings.lastBackupTimestamp,
          lastAutoImportTimestamp: source === "manual" ? current.settings.lastAutoImportTimestamp : importedAt,
          backupStatus: successMessage,
          updatedAt: importedAt
        };

        return stampData(
          addAudit(
            {
              ...imported,
              settings: nextSettings
            },
            createAuditEntry("Import", source, importAction, `${fileName} was imported.`, importActor, importedAt)
          )
        );
      });

      if (source !== "manual") {
        setLastAutoImportAt(importedAt);
      }

      setItemForm(blankItemForm(imported.settings.defaultLocationId));
      setStockForm(blankStockForm(imported.items[0]?.id ?? ""));
      setBackupIndicator("done");
      setBackupMessage(successMessage);
      setBackupDialog(null);
      openPage("dashboard");
      showToast("success", successMessage);
    } catch (error) {
      showToast("danger", error instanceof Error ? error.message : "Backup import failed.");
    }
  }

  async function prepareFolderImportConfirmation(dialog: Extract<BackupDialogState, { kind: "existing-file" }>) {
    try {
      const target = backupTargetFromSelection(dialog.selection);
      const backupRead = await readBackupFile(target, true);
      const { backupTimestamp, payload } = parseAndValidateBackup(backupRead.contents, backupRead.lastModifiedAt);

      setBackupDialog({
        kind: "confirm-import",
        backupTimestamp,
        fileLastModifiedAt: backupRead.lastModifiedAt,
        fileName: BACKUP_LATEST_FILENAME,
        localTimestamp: dialog.localTimestamp,
        payload,
        source: "folder"
      });
    } catch (error) {
      showToast("danger", error instanceof Error ? error.message : "Could not import this backup.");
    }
  }

  async function runBackup(snapshot: AppData, manual: boolean, successMessage?: string) {
    setBackupIndicator("running");
    setBackupMessage(manual ? "Backup running" : "Auto backup running");

    try {
      const backupAt = nowIso();
      const completedMessage = successMessage || (manual ? "Backup saved." : `Backed up ${formatDateTime(backupAt)}`);

      await writeBackupFile(snapshot.settings, createBackupPayload(snapshot, backupAt));
      setLastBackupAt(backupAt);
      setBackupIndicator("done");
      setBackupMessage(completedMessage);
      updateBackupMetadata({ backupStatus: completedMessage, lastBackupTimestamp: backupAt });
      if (manual) {
        showToast("success", completedMessage);
      }
      window.setTimeout(() => setBackupIndicator((current) => (current === "done" ? "saved" : current)), 2000);
    } catch (error) {
      setBackupIndicator("failed");
      setBackupMessage(error instanceof Error ? error.message : "Backup failed");
      if (manual) {
        showToast("danger", error instanceof Error ? error.message : "Backup failed.");
      }
    }
  }

  function handleItemSubmit(event: FormEvent) {
    event.preventDefault();

    if (!data) {
      return;
    }

    if (!itemForm.name.trim()) {
      showToast("warning", "Item name is required.");
      return;
    }

    if (!data.settings.allowNegativeStockOverride && wholeNumberValue(itemForm.quantityOnHand) < 0) {
      showToast("warning", "Quantity on hand cannot be negative unless override is enabled in Settings.");
      return;
    }

    if (wholeNumberValue(itemForm.minimumStockLevel) < 0) {
      showToast("warning", "Minimum stock level cannot be negative.");
      return;
    }

    if (wholeNumberValue(itemForm.lowStockAlertLevel) < 0) {
      showToast("warning", "Low Stock Alert Level cannot be negative.");
      return;
    }

    if (numberValue(itemForm.costEach) < 0) {
      showToast("warning", "Cost each cannot be negative.");
      return;
    }

    const wasEditing = Boolean(editingItemId);

    commitData((current) => {
      const existing = editingItemId ? current.items.find((item) => item.id === editingItemId) : undefined;
      const item = itemFromForm(itemForm, existing);
      const nextItems = existing
        ? current.items.map((candidate) => (candidate.id === existing.id ? item : candidate))
        : [item, ...current.items];
      const action = existing ? "Item Updated" : "Item Created";
      const summary = `${item.name}${item.partNumber ? ` (${item.partNumber})` : ""} was ${
        existing ? "updated" : "created"
      }.`;

      return addAudit(
        {
          ...current,
          items: nextItems
        },
        createAuditEntry("Item", item.id, action, summary, "User")
      );
    });

    showToast("success", wasEditing ? "Item updated." : "Item added.");
    if (!wasEditing) {
      setActivityNow(Date.now());
    }
    setEditingItemId(null);
    setItemForm(blankItemForm(data?.settings.defaultLocationId ?? ""));
    setIsItemFormOpen(false);
    setActivePage("inventory");
    closeSettingsPanel();
  }

  function editItem(item: InventoryItem) {
    setEditingItemId(item.id);
    setItemForm(formFromItem(item));
    setIsItemFormOpen(true);
    openInventoryForItemForm();
  }

  function deleteItem(itemId: string) {
    if (!data) {
      return;
    }

    const item = data.items.find((candidate) => candidate.id === itemId);

    if (!item || !window.confirm(`Delete ${item.name}? This keeps existing audit history.`)) {
      return;
    }

    commitData((current) =>
      addAudit(
        {
          ...current,
          items: current.items.filter((candidate) => candidate.id !== itemId)
        },
        createAuditEntry("Item", itemId, "Item Deleted", `${item.name} was deleted.`, "User")
      )
    );
    showToast("success", "Item deleted.");
  }

  function startStockAction(itemId: string, actionType: StockActionType | "" = "") {
    setStockForm({ ...blankStockForm(itemId), actionType, quantity: actionType === "Set Stock On Hand" ? "" : 1 });
    openPage("stock");
  }

  function updateMinimumStockLevel(itemId: string, minimumStockLevel: number) {
    if (!data) {
      return;
    }

    const item = data.items.find((candidate) => candidate.id === itemId);

    if (!item) {
      showToast("warning", "Choose an item first.");
      return;
    }

    const nextMinimumStockLevel = Math.max(0, wholeNumberValue(minimumStockLevel));

    commitData((current) => {
      const currentItem = current.items.find((candidate) => candidate.id === itemId);

      if (!currentItem) {
        return current;
      }

      const updatedAt = nowIso();
      const updatedItem = {
        ...currentItem,
        minimumStockLevel: nextMinimumStockLevel,
        lowStockAlertLevel: normalizeLowStockAlertLevel(nextMinimumStockLevel, currentItem.lowStockAlertLevel),
        updatedAt
      };

      return addAudit(
        {
          ...current,
          items: current.items.map((candidate) => (candidate.id === itemId ? updatedItem : candidate))
        },
        createAuditEntry(
          "Item",
          itemId,
          "Minimum Stock Level Updated",
          `Minimum stock level changed from ${formatNumber(currentItem.minimumStockLevel)} to ${formatNumber(
            updatedItem.minimumStockLevel
          )} for ${updatedItem.partNumber || updatedItem.name}.`,
          "User",
          updatedAt
        )
      );
    });

    showToast("success", "Minimum stock level updated.");
  }

  function updateLowStockAlertLevel(itemId: string, lowStockAlertLevel: number) {
    if (!data) {
      return;
    }

    const item = data.items.find((candidate) => candidate.id === itemId);

    if (!item) {
      showToast("warning", "Choose an item first.");
      return;
    }

    const nextLowStockAlertLevel = normalizeLowStockAlertLevel(item.minimumStockLevel, lowStockAlertLevel);

    commitData((current) => {
      const currentItem = current.items.find((candidate) => candidate.id === itemId);

      if (!currentItem) {
        return current;
      }

      const updatedAt = nowIso();
      const updatedItem = {
        ...currentItem,
        lowStockAlertLevel: normalizeLowStockAlertLevel(currentItem.minimumStockLevel, nextLowStockAlertLevel),
        updatedAt
      };

      return addAudit(
        {
          ...current,
          items: current.items.map((candidate) => (candidate.id === itemId ? updatedItem : candidate))
        },
        createAuditEntry(
          "Item",
          itemId,
          "Low Stock Alert Level Updated",
          `Low Stock Alert Level changed to ${formatNumber(updatedItem.lowStockAlertLevel)} for ${
            updatedItem.partNumber || updatedItem.name
          }.`,
          "User",
          updatedAt
        )
      );
    });
  }

  function handleStockSubmit(event: FormEvent) {
    event.preventDefault();

    if (!data) {
      return;
    }

    const item = data.items.find((candidate) => candidate.id === stockForm.itemId);

    if (!item) {
      showToast("warning", "Choose an item first.");
      return;
    }

    if (!stockForm.actionType) {
      showToast("warning", "Choose Add, Pull, or Set Stock On Hand first.");
      return;
    }

    const actionType = stockForm.actionType;
    const quantityText = String(stockForm.quantity).trim();

    if (!quantityText) {
      showToast(
        "warning",
        actionType === "Set Stock On Hand" ? "Enter the actual counted quantity." : "Quantity must be greater than 0."
      );
      return;
    }

    const quantity = wholeNumberValue(stockForm.quantity, Number.NaN);

    if (!Number.isFinite(quantity)) {
      showToast("warning", "Enter a valid whole number quantity.");
      return;
    }

    if (actionType !== "Set Stock On Hand" && quantity <= 0) {
      showToast("warning", "Quantity must be greater than 0.");
      return;
    }

    const previousQuantity = item.quantityOnHand;
    const nextQuantity = calculateStockQuantity(previousQuantity, actionType, quantity);

    if (nextQuantity < 0 && !data.settings.allowNegativeStockOverride) {
      showToast("danger", "Stock would be below 0. Enable negative stock override in Settings to allow it.");
      return;
    }

    const occurredAt = dateTimeLocalToIso(stockForm.occurredAt);
    const reason = stockForm.reason.trim() || (actionType === "Set Stock On Hand" ? "Physical count adjustment." : "");

    commitData((current) => {
      const currentItem = current.items.find((candidate) => candidate.id === item.id);

      if (!currentItem) {
        return current;
      }

      const finalQuantity = calculateStockQuantity(currentItem.quantityOnHand, actionType, quantity);
      const updatedItem = {
        ...currentItem,
        quantityOnHand: finalQuantity,
        updatedAt: nowIso()
      };
      const movementQuantity =
        actionType === "Set Stock On Hand" ? Math.abs(finalQuantity - currentItem.quantityOnHand) : quantity;
      const stockChange: StockChange = {
        id: createId(),
        itemId: updatedItem.id,
        itemNameSnapshot: updatedItem.name,
        partNumberSnapshot: updatedItem.partNumber,
        vendorNameSnapshot: getVendorName(current, updatedItem.vendorId),
        actionType,
        quantity: movementQuantity,
        reason,
        actor: stockForm.actor.trim() || "User",
        notes: stockForm.notes.trim(),
        occurredAt,
        previousQuantity: currentItem.quantityOnHand,
        newQuantity: finalQuantity,
        createdAt: nowIso()
      };
      const summary = `${getStockActionLabel(actionType)}: ${formatNumber(currentItem.quantityOnHand)} -> ${formatNumber(
        finalQuantity
      )} ${normalizeStockUnit(updatedItem.stockUnit)} for ${updatedItem.name}.`;

      return addAudit(
        {
          ...current,
          items: current.items.map((candidate) => (candidate.id === updatedItem.id ? updatedItem : candidate)),
          stockChanges: [stockChange, ...current.stockChanges].slice(0, 600)
        },
        createAuditEntry("Stock", stockChange.id, actionType, summary, stockChange.actor, occurredAt)
      );
    });

    showToast("success", `${getStockActionLabel(actionType)} saved.`);
    setStockForm(blankStockForm(item.id));
  }

  function handleLocationSubmit(event: FormEvent) {
    event.preventDefault();

    if (!locationForm.name.trim()) {
      showToast("warning", "Location name is required.");
      return;
    }

    commitData((current) => {
      const location = createLocation(locationForm.name.trim(), {
        description: locationForm.description.trim(),
        notes: locationForm.notes.trim()
      });
      const nextSettings = current.settings.defaultLocationId
        ? current.settings
        : { ...current.settings, defaultLocationId: location.id, updatedAt: nowIso() };

      return addAudit(
        {
          ...current,
          locations: [...current.locations, location],
          settings: nextSettings
        },
        createAuditEntry("Location", location.id, "Location Created", `${location.name} was added.`, "User")
      );
    });
    setLocationForm(blankLocationForm());
    setIsAddLocationOpen(false);
    showToast("success", "Location added.");
  }

  function deleteLocation(locationId: string) {
    if (!data) {
      return;
    }

    const location = data.locations.find((candidate) => candidate.id === locationId);
    const inUse = data.items.some((item) => item.locationId === locationId);

    if (!location) {
      return;
    }

    if (inUse) {
      showToast("warning", "That location is assigned to inventory items.");
      return;
    }

    commitData((current) =>
      addAudit(
        {
          ...current,
          locations: current.locations.filter((candidate) => candidate.id !== locationId),
          settings:
            current.settings.defaultLocationId === locationId
              ? { ...current.settings, defaultLocationId: "", updatedAt: nowIso() }
              : current.settings
        },
        createAuditEntry("Location", locationId, "Location Deleted", `${location.name} was deleted.`, "User")
      )
    );
  }

  async function suggestVendorNoteWithWebsite(vendor: VendorNoteContext) {
    if (!vendor.website.trim()) {
      return "";
    }

    const websitePreview = await readVendorWebsitePreview(vendor.website);

    return suggestVendorNoteFromContext({ vendor, websitePreview });
  }

  function openVendorAiPurposePrompt(prompt: VendorAiPromptState, resolve?: (note: string | null) => void) {
    if (vendorAiPromptResolveRef.current) {
      vendorAiPromptResolveRef.current(null);
    }

    vendorAiPromptResolveRef.current = resolve ?? null;
    setVendorAiPromptText("");
    setVendorAiPrompt(prompt);
  }

  function closeVendorAiPurposePrompt(note: string | null = null) {
    const resolve = vendorAiPromptResolveRef.current;

    vendorAiPromptResolveRef.current = null;
    setVendorAiPrompt(null);
    setVendorAiPromptText("");

    if (resolve) {
      resolve(note);
    }
  }

  async function handleVendorFormAiHelp() {
    const vendor = vendorFormNoteContext(vendorForm);

    if (vendor.website.trim()) {
      const note = await suggestVendorNoteWithWebsite(vendor);

      if (note) {
        setVendorForm((current) => ({ ...current, notes: note }));
        return;
      }
    }

    openVendorAiPurposePrompt({ source: "form" });
  }

  async function handleInlineVendorAiHelp(vendor: VendorRecord, currentDraft: string) {
    const vendorContext = vendorRecordNoteContext(vendor, currentDraft);

    if (vendorContext.website.trim()) {
      const note = await suggestVendorNoteWithWebsite(vendorContext);

      if (note) {
        return note;
      }
    }

    return new Promise<string | null>((resolve) => {
      openVendorAiPurposePrompt({ source: "inline", vendorId: vendor.id, draft: currentDraft }, resolve);
    });
  }

  function applyVendorAiPurposeNote() {
    if (!vendorAiPrompt) {
      return;
    }

    const userPurpose = vendorAiPromptText.trim();

    if (!userPurpose) {
      showToast("warning", "Tell AI Help what this vendor is used for.");
      return;
    }

    if (vendorAiPrompt.source === "form") {
      const note = suggestVendorNoteFromContext({
        vendor: vendorFormNoteContext(vendorForm),
        userPurpose
      });

      setVendorForm((current) => ({ ...current, notes: note }));
      closeVendorAiPurposePrompt();
      return;
    }

    const vendor = data?.vendors.find((candidate) => candidate.id === vendorAiPrompt.vendorId);

    if (!vendor) {
      showToast("warning", "That vendor could not be found.");
      closeVendorAiPurposePrompt(null);
      return;
    }

    const note = suggestVendorNoteFromContext({
      vendor: vendorRecordNoteContext(vendor, vendorAiPrompt.draft ?? vendor.notes),
      userPurpose
    });

    closeVendorAiPurposePrompt(note);
  }

  function handleVendorSubmit(event: FormEvent) {
    event.preventDefault();

    const submittedVendorForm = {
      name: vendorForm.name.trim(),
      contactName: vendorForm.contactName.trim(),
      contactEmail: vendorForm.contactEmail.trim(),
      phone: vendorForm.phone.trim(),
      email: vendorForm.email.trim(),
      website: vendorForm.website.trim(),
      notes: vendorForm.notes.trim()
    };

    if (!submittedVendorForm.name) {
      showToast("warning", "Vendor name is required.");
      return;
    }

    if (editingVendorId && !data?.vendors.some((vendor) => vendor.id === editingVendorId)) {
      showToast("warning", "That vendor could not be found.");
      setEditingVendorId(null);
      setVendorForm(blankVendorForm());
      setIsAddVendorOpen(false);
      return;
    }

    const isEditingVendor = Boolean(editingVendorId);

    commitData((current) => {
      if (editingVendorId) {
        const updatedAt = nowIso();

        return addAudit(
          {
            ...current,
            vendors: current.vendors.map((vendor) =>
              vendor.id === editingVendorId
                ? {
                    ...vendor,
                    name: submittedVendorForm.name,
                    contactName: submittedVendorForm.contactName,
                    contactEmail: submittedVendorForm.contactEmail,
                    phone: submittedVendorForm.phone,
                    email: submittedVendorForm.email,
                    website: submittedVendorForm.website,
                    notes: submittedVendorForm.notes,
                    updatedAt
                  }
                : vendor
            )
          },
          createAuditEntry("Vendor", editingVendorId, "Vendor Updated", `${submittedVendorForm.name} was updated.`, "User", updatedAt)
        );
      }

      const vendor = createVendor(submittedVendorForm.name, {
        contactName: submittedVendorForm.contactName,
        contactEmail: submittedVendorForm.contactEmail,
        phone: submittedVendorForm.phone,
        email: submittedVendorForm.email,
        website: submittedVendorForm.website,
        notes: submittedVendorForm.notes
      });

      return addAudit(
        {
          ...current,
          vendors: [...current.vendors, vendor]
        },
        createAuditEntry("Vendor", vendor.id, "Vendor Created", `${vendor.name} was added.`, "User")
      );
    });
    setVendorForm(blankVendorForm());
    setEditingVendorId(null);
    setIsAddVendorOpen(false);
    setActivityNow(Date.now());
    showToast("success", isEditingVendor ? "Vendor updated." : "Vendor added.");
  }

  function startEditVendor(vendor: VendorRecord) {
    setEditingVendorId(vendor.id);
    setVendorForm({
      name: vendor.name,
      contactName: vendor.contactName,
      contactEmail: vendor.contactEmail,
      phone: vendor.phone,
      email: vendor.email,
      website: vendor.website,
      notes: vendor.notes
    });
    setIsAddVendorOpen(true);
  }

  function cancelVendorEdit() {
    setEditingVendorId(null);
    setVendorForm(blankVendorForm());
    setIsAddVendorOpen(false);
  }

  function toggleVendorAddPanel() {
    if (isAddVendorOpen) {
      if (editingVendorId) {
        cancelVendorEdit();
        return;
      }

      setIsAddVendorOpen(false);
      return;
    }

    setEditingVendorId(null);
    setIsAddVendorOpen(true);
  }

  function updateVendorNotes(vendorId: string, notes: string) {
    const vendor = data?.vendors.find((candidate) => candidate.id === vendorId);

    if (!vendor) {
      showToast("warning", "That vendor could not be found.");
      return;
    }

    const updatedAt = nowIso();
    const cleanNotes = notes.trim();

    commitData((current) =>
      addAudit(
        {
          ...current,
          vendors: current.vendors.map((candidate) =>
            candidate.id === vendorId ? { ...candidate, notes: cleanNotes, updatedAt } : candidate
          )
        },
        createAuditEntry("Vendor", vendorId, "Vendor Notes Updated", `${vendor.name} notes were updated.`, "User", updatedAt)
      )
    );
    setActivityNow(Date.now());
    setRecentlySavedVendorNoteId(vendorId);
    window.setTimeout(() => {
      setRecentlySavedVendorNoteId((current) => (current === vendorId ? null : current));
    }, 2500);
    showToast("success", "Vendor notes updated.");
  }

  function deleteVendor(vendorId: string) {
    if (!data) {
      return;
    }

    const vendor = data.vendors.find((candidate) => candidate.id === vendorId);
    const inUse = data.items.some((item) => item.vendorId === vendorId);

    if (!vendor) {
      return;
    }

    if (inUse) {
      showToast("warning", "That vendor is assigned to inventory items.");
      return;
    }

    commitData((current) =>
      addAudit(
        {
          ...current,
          vendors: current.vendors.filter((candidate) => candidate.id !== vendorId)
        },
        createAuditEntry("Vendor", vendorId, "Vendor Deleted", `${vendor.name} was deleted.`, "User")
      )
    );
  }

  function updateSettings(settings: AppSettings, auditSummary = "Settings were updated.") {
    commitData((current) =>
      addAudit(
        {
          ...current,
          settings: {
            ...settings,
            updatedAt: nowIso()
          }
        },
        createAuditEntry("Settings", "appSettings", "Settings Updated", auditSummary, "User")
      )
    );
  }

  async function handleChooseBackupFolder() {
    if (!data) {
      return;
    }

    try {
      setupPromptDismissedRef.current = true;
      setBackupDialog(null);
      const selection = await chooseBackupDirectory();
      const localTimestamp = getLocalDataUpdatedAt(data);

      applyBackupDirectorySelection(selection);

      try {
        const backupRead = await readBackupFile(backupTargetFromSelection(selection), true);

        setBackupDialog({
          kind: "existing-file",
          backupRead,
          localTimestamp,
          selection
        });
      } catch (error) {
        if (isMissingBackupFileError(error)) {
          setBackupDialog({ kind: "no-file", selection });
          return;
        }

        throw error;
      }
    } catch (error) {
      showToast("danger", error instanceof Error ? error.message : "Could not choose backup folder.");
    }
  }

  async function handleOverwriteSelectedBackup(selection: BackupDirectorySelection) {
    if (!data) {
      return;
    }

    setBackupDialog(null);
    await runBackup(
      dataWithBackupSelection(data, selection),
      true,
      "Backup folder set. Current inventory data saved to backup file."
    );
  }

  async function handleSaveBackupInEmptyFolder(selection: BackupDirectorySelection) {
    if (!data) {
      return;
    }

    setBackupDialog(null);
    await runBackup(
      dataWithBackupSelection(data, selection),
      true,
      "Backup folder set. Current inventory data saved to backup file."
    );
  }

  function handleImportConfirmation(dialog: Extract<BackupDialogState, { kind: "confirm-import" }>) {
    const message = dialog.source === "manual" ? "JSON import complete." : "Backup imported successfully.";

    applyImportedBackup(dialog.payload, dialog.source, dialog.fileName, message);
  }

  async function handleCreateRecoveryCode() {
    const confirmed = window.confirm(
      "Create a new recovery code? The old recovery code will no longer work. Your password will not be changed."
    );

    if (!confirmed) {
      return;
    }

    try {
      const result = await rotateRecoveryCode();

      if (!result) {
        throw new Error("No local auth record was found.");
      }

      setAuthSessionUnlocked(result.record);
      setNewRecoveryCode(result.recoveryCode);
      showToast("success", "New recovery code created. Save it now.");
    } catch (error) {
      showToast("danger", error instanceof Error ? error.message : "Could not create a new recovery code.");
    }
  }

  function handleExportJson() {
    if (!data) {
      return;
    }

    downloadTextFile(
      `maintenance-inventory-tracker-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(createBackupPayload(data), null, 2),
      "application/json"
    );
    setBackupIndicator("done");
    setBackupMessage("JSON export created");
    window.setTimeout(() => setBackupIndicator((current) => (current === "done" ? "saved" : current)), 2000);
  }

  async function handleImportJson(file: File) {
    try {
      const contents = await file.text();
      const fileLastModifiedAt = file.lastModified ? new Date(file.lastModified).toISOString() : null;
      const { backupTimestamp, payload } = parseAndValidateBackup(contents, fileLastModifiedAt);

      setBackupDialog({
        kind: "confirm-import",
        backupTimestamp,
        fileLastModifiedAt,
        fileName: file.name,
        localTimestamp: data ? getLocalDataUpdatedAt(data) : null,
        payload,
        source: "manual"
      });
    } catch (error) {
      showToast("danger", error instanceof Error ? error.message : "JSON import failed.");
    }
  }

  function getInventoryExportCsv() {
    if (!data) {
      return "";
    }

    const headers = [
      "Item Name",
      "Part Number",
      "Category",
      "Description",
      "Quantity On Hand",
      "Stock Unit",
      "Minimum Stock Level",
      "Low Stock Alert Level",
      "Location",
      "Vendor",
      "Cost Each",
      "Item URL",
      "Notes",
      "Created At",
      "Updated At"
    ];
    const rows = data.items.map((item) => [
      item.name,
      item.partNumber,
      item.category,
      item.description,
      item.quantityOnHand,
      normalizeStockUnit(item.stockUnit),
      item.minimumStockLevel,
      item.lowStockAlertLevel,
      getLocationName(data, item.locationId),
      getVendorName(data, item.vendorId),
      item.costEach,
      item.itemUrl,
      item.notes,
      item.createdAt,
      item.updatedAt
    ]);

    return rowsToCsv(headers, rows);
  }

  function handleExportCsv() {
    if (!data) {
      return;
    }

    downloadTextFile(
      `maintenance-inventory-export-${new Date().toISOString().slice(0, 10)}.csv`,
      getInventoryExportCsv(),
      "text/csv;charset=utf-8"
    );
    showToast("success", "CSV export downloaded.");
  }

  function handleExportExcelCsv() {
    if (!data) {
      return;
    }

    downloadTextFile(
      `maintenance-inventory-excel-export-${new Date().toISOString().slice(0, 10)}.csv`,
      getInventoryExportCsv(),
      "text/csv;charset=utf-8"
    );
    showToast("success", "CSV export downloaded.");
  }

  async function handleImportCsv(file: File) {
    if (!data) {
      return;
    }

    try {
      const contents = await file.text();
      const preview = buildCsvImportPreview(contents, data, file.name);

      setCsvImportPreview(preview);
      showToast("success", "CSV import ready.");
    } catch (error) {
      showToast("danger", error instanceof Error ? error.message : "CSV import failed.");
    }
  }

  function confirmCsvImport() {
    if (!data || !csvImportPreview) {
      return;
    }

    try {
      const preview = buildCsvImportPreview(csvImportPreview.contents, data, csvImportPreview.fileName);
      const result = importCsvRows(preview);

      setCsvImportPreview(null);
      if (result.created > 0 || result.vendorsCreated > 0) {
        setActivityNow(Date.now());
      }
      showToast("success", `CSV import complete. ${result.created} created, ${result.updated} updated.`);
    } catch (error) {
      showToast("danger", error instanceof Error ? error.message : "CSV import failed.");
    }
  }

  function importCsvRows(preview: CsvImportPreview): CsvImportResult {
    let result: CsvImportResult = {
      created: 0,
      locationsCreated: 0,
      rowsFound: preview.rowsFound,
      updated: 0,
      vendorsCreated: 0
    };

    if (!data) {
      return result;
    }

    const current = data;
    const nextLocations = [...current.locations];
    const nextVendors = [...current.vendors];
    const nextItems = [...current.items];
    const auditEntries: AuditEntry[] = [];

    const findOrCreateLocation = (name: string) => {
      const trimmed = name.trim();

      if (!trimmed) {
        return "";
      }

      const existing = nextLocations.find((location) => location.name.toLowerCase() === trimmed.toLowerCase());

      if (existing) {
        return existing.id;
      }

      const location = createLocation(trimmed);

      nextLocations.push(location);
      result = { ...result, locationsCreated: result.locationsCreated + 1 };
      auditEntries.push(createAuditEntry("Location", location.id, "Location Created", `${trimmed} was imported.`, "CSV Import"));
      return location.id;
    };

    const findOrCreateVendor = (name: string) => {
      const trimmed = name.trim();

      if (!trimmed) {
        return "";
      }

      const existing = nextVendors.find((vendor) => vendor.name.toLowerCase() === trimmed.toLowerCase());

      if (existing) {
        return existing.id;
      }

      const vendor = createVendor(trimmed);

      nextVendors.push(vendor);
      result = { ...result, vendorsCreated: result.vendorsCreated + 1 };
      auditEntries.push(createAuditEntry("Vendor", vendor.id, "Vendor Created", `${trimmed} was imported.`, "CSV Import"));
      return vendor.id;
    };

    preview.records.forEach((record) => {
      const existingIndex = nextItems.findIndex((item) =>
        record.partNumber
          ? item.partNumber.toLowerCase() === record.partNumber.toLowerCase()
          : item.name.toLowerCase() === record.name.toLowerCase()
      );
      const existing = existingIndex >= 0 ? nextItems[existingIndex] : undefined;
      const name = record.name || existing?.name || record.partNumber;
      const minimumStockLevel = Math.max(0, record.minimumStockLevel ?? existing?.minimumStockLevel ?? 0);
      const lowStockAlertLevel = normalizeLowStockAlertLevel(
        minimumStockLevel,
        record.lowStockAlertLevel ?? defaultLowStockAlertLevel()
      );
      const importedItem = itemFromForm(
        {
          name,
          partNumber: record.partNumber || existing?.partNumber || "",
          description: record.description || existing?.description || "",
          category: record.category || existing?.category || "Other",
          quantityOnHand: Math.max(0, record.quantityOnHand ?? existing?.quantityOnHand ?? 0),
          stockUnit: record.stockUnit || existing?.stockUnit || DEFAULT_STOCK_UNIT,
          minimumStockLevel,
          lowStockAlertLevel,
          locationId: findOrCreateLocation(record.locationName) || existing?.locationId || current.settings.defaultLocationId,
          vendorId: findOrCreateVendor(record.vendorName) || existing?.vendorId || "",
          costEach: Math.max(0, record.costEach ?? existing?.costEach ?? 0),
          itemUrl: record.itemUrl || existing?.itemUrl || "",
          notes: record.notes || existing?.notes || "",
          imagePlaceholder: existing?.imagePlaceholder || "",
          barcodePlaceholder: existing?.barcodePlaceholder || ""
        },
        existing
      );

      if (existing && existingIndex >= 0) {
        nextItems[existingIndex] = importedItem;
        result = { ...result, updated: result.updated + 1 };
        auditEntries.push(createAuditEntry("Item", importedItem.id, "CSV Item Updated", `${name} was updated from CSV.`, "CSV Import"));
      } else {
        nextItems.unshift(importedItem);
        result = { ...result, created: result.created + 1 };
        auditEntries.push(createAuditEntry("Item", importedItem.id, "CSV Item Created", `${name} was imported from CSV.`, "CSV Import"));
      }
    });

    auditEntries.push(
      createAuditEntry(
        "Import",
        "csv",
        "CSV Import Completed",
        `CSV import completed: ${result.created} created, ${result.updated} updated.`,
        "CSV Import"
      )
    );

    setData(
      stampData({
        ...current,
        items: nextItems,
        locations: nextLocations,
        vendors: nextVendors,
        auditLog: [...auditEntries.reverse(), ...current.auditLog].slice(0, 600)
      })
    );

    return result;
  }

  function clearDemoData() {
    if (!data) {
      return;
    }

    commitData((current) =>
      addAudit(
        {
          ...current,
          items: current.items.filter((item) => !item.isDemo),
          locations: current.locations.filter((location) => !location.isDemo),
          vendors: current.vendors.filter((vendor) => !vendor.isDemo),
          stockChanges: current.stockChanges.filter((change) => !change.isDemo),
          auditLog: current.auditLog.filter((entry) => !entry.isDemo)
        },
        createAuditEntry("Settings", "demo", "Demo Data Cleared", "Demo inventory data was removed.", "User")
      )
    );
    showToast("success", "Demo data cleared.");
  }

  if (!data) {
    return <MaintenanceLoadingScreen />;
  }

  const backupSupported = isFileSystemBackupSupported();
  const saveHealthRows = getSaveHealthRows(data, backupSupported, lastBackupAt, lastAutoImportAt, backupIndicator, backupMessage);
  const saveHealthTone = getOverallHealthTone(saveHealthRows);
  const backupStatusInfo = getBackupStatusInfo(data, backupSupported, backupIndicator, backupMessage);
  const recentAddAlerts = getRecentAddAlerts(data, activityNow);
  const canCollapseChrome = activePage !== "dashboard";
  const chromeCollapsed = canCollapseChrome && isChromeCollapsed;
  const isCompactChrome = activePage !== "dashboard";
  const isInventoryWorkspace = activePage === "inventory" && !isSettingsOpen;

  return (
    <main
      className={`app-shell min-h-screen p-3 text-slate-100 sm:p-5 ${isCompactChrome ? "compact-chrome" : ""} ${
        chromeCollapsed ? "chrome-collapsed" : ""
      } ${isInventoryWorkspace ? "inventory-workspace-mode" : ""} ${
        isInventoryWorkspace && chromeCollapsed ? "inventory-workspace-expanded" : ""
      }`}
    >
      <div className={`app-content flex flex-col gap-5 ${isCompactChrome ? "app-content-compact" : ""}`}>
        {chromeCollapsed && !isItemFormOpen && (
          <div className="floating-work-toolbar no-print" aria-label="Collapsed app controls">
            <button
              className="floating-toolbar-button"
              type="button"
              title="Show header"
              aria-label="Show header"
              onClick={() => setIsChromeCollapsed(false)}
            >
              <ExpandHeaderIcon />
            </button>
            <button
              className="floating-toolbar-button"
              type="button"
              title="Return to Dashboard"
              aria-label="Return to Dashboard"
              onClick={() => openPage("dashboard")}
            >
              <ReturnDashboardIcon />
            </button>
            <BackupStatusDot status={backupStatusInfo} />
            <button
              className={`settings-gear floating-settings-gear ${isSettingsOpen ? "settings-gear-active" : ""}`}
              type="button"
              title="Settings"
              aria-label="Open settings"
              onClick={toggleSettingsPanel}
            >
              <GearIcon />
              <span className={`gear-health-dot status-health-dot ${saveHealthTone}`} aria-hidden="true" />
            </button>
          </div>
        )}

        {!chromeCollapsed && (
        <header className={`header-panel ${isCompactChrome ? "header-panel-compact" : ""}`}>
          <div className="flex min-w-0 items-center gap-3">
            <AppLogoMark />
            <div className="min-w-0">
              {isEditingHeaderBadge ? (
                <input
                  className="header-badge-input"
                  autoFocus
                  value={headerBadgeDraft}
                  onBlur={saveHeaderBadge}
                  onChange={(event) => setHeaderBadgeDraft(event.target.value)}
                  onKeyDown={handleHeaderBadgeKeyDown}
                />
              ) : (
                <button className="header-badge-button" type="button" onClick={startHeaderBadgeEdit}>
                  {data.settings.headerBadgeText}
                </button>
              )}
              <h1 className="text-2xl font-black tracking-tight text-white md:text-3xl">
                Maintenance Inventory Tracker
              </h1>
            </div>
          </div>
          <div className="header-actions">
            <BackupStatusDot status={backupStatusInfo} />
            <button
              className={`settings-gear ${isSettingsOpen ? "settings-gear-active" : ""}`}
              type="button"
              title="Settings"
              aria-label="Open settings"
              onClick={toggleSettingsPanel}
            >
              <GearIcon />
              <span className={`gear-health-dot status-health-dot ${saveHealthTone}`} aria-hidden="true" />
            </button>
          </div>
        </header>
        )}

        {isSettingsOpen && (
          <SettingsPage
            backupSupported={backupSupported}
            backupMessage={backupMessage}
            clearDemoData={clearDemoData}
            data={data}
            lastBackupAt={lastBackupAt}
            lastAutoImportAt={lastAutoImportAt}
            onChooseBackupFolder={() => void handleChooseBackupFolder()}
            onClose={closeSettingsPanel}
            onCreateRecoveryCode={() => void handleCreateRecoveryCode()}
            onDismissRecoveryCode={() => setNewRecoveryCode("")}
            onExportCsv={handleExportCsv}
            onExportJson={handleExportJson}
            onImportCsv={(file) => void handleImportCsv(file)}
            onImportJson={(file) => void handleImportJson(file)}
            onRunBackup={() => void runBackup(data, true)}
            newRecoveryCode={newRecoveryCode}
            saveHealthRows={saveHealthRows}
            updateSettings={updateSettings}
          />
        )}

        {!chromeCollapsed && (
        <div className={`chrome-navigation no-print ${activePage === "dashboard" ? "chrome-navigation-dashboard" : ""}`}>
          {activePage !== "dashboard" && (
            <>
            <button
              className="dashboard-return-button"
              type="button"
              title="Return to Dashboard"
              aria-label="Return to Dashboard"
              onClick={() => openPage("dashboard")}
            >
              <ReturnDashboardIcon />
            </button>
            <button
              className="dashboard-return-button"
              type="button"
              title="Collapse header"
              aria-label="Collapse header"
              onClick={() => setIsChromeCollapsed(true)}
            >
              <CollapseHeaderIcon />
            </button>
            </>
          )}
          <nav className={`toolbar ${isCompactChrome ? "toolbar-compact" : ""}`} aria-label="Main pages">
            {pages.map((page) => (
              <button
                key={page.id}
                className={activePage === page.id ? "tab-active" : "tab-button"}
                type="button"
                onClick={() => openPage(page.id)}
              >
                {page.label}
              </button>
            ))}
          </nav>
        </div>
        )}

        {toast && <Toast tone={toast.tone} text={toast.text} />}
        {backupDialog && (
          <BackupWorkflowDialog
            backupSupported={backupSupported}
            dialog={backupDialog}
            onCancel={() => setBackupDialog(null)}
            onChooseFolder={() => void handleChooseBackupFolder()}
            onConfirmImport={(dialogState) => handleImportConfirmation(dialogState)}
            onImportExisting={(dialogState) => void prepareFolderImportConfirmation(dialogState)}
            onNotNow={() => {
              setBackupDialog(null);
              showToast("success", "Backup folder selected. No backup was written.");
            }}
            onOverwrite={(selection) => void handleOverwriteSelectedBackup(selection)}
            onRemindLater={() => {
              setupPromptDismissedRef.current = true;
              setBackupDialog(null);
            }}
            onSaveBackupNow={(selection) => void handleSaveBackupInEmptyFolder(selection)}
          />
        )}
        {!backupDialog && manualUpdateNotice?.newerInstaller && (
          <ManualUpdateNoticeDialog
            updateCheck={manualUpdateNotice}
            onLater={() => setManualUpdateNotice(null)}
            onOpenFolder={() => void openManualUpdateFolderFromNotice(manualUpdateNotice)}
          />
        )}
        {csvImportPreview && (
          <CsvImportPreviewDialog
            preview={csvImportPreview}
            onCancel={() => setCsvImportPreview(null)}
            onConfirm={confirmCsvImport}
          />
        )}
        {vendorAiPrompt && (
          <VendorAiPurposeDialog
            promptText={vendorAiPromptText}
            onApply={applyVendorAiPurposeNote}
            onCancel={() => closeVendorAiPurposePrompt(null)}
            onChange={setVendorAiPromptText}
          />
        )}
        {isItemFormOpen && (
          <ItemFormDrawer
            data={data}
            editingItemId={editingItemId}
            form={itemForm}
            onCancel={closeItemForm}
            onChange={setItemForm}
            onSubmit={handleItemSubmit}
          />
        )}

        {activePage === "dashboard" && (
          <DashboardPage
            data={data}
            onStockAction={startStockAction}
            recentAddAlerts={recentAddAlerts}
            reorderItems={reorderItems}
            setActivePage={openPage}
          />
        )}
        {activePage === "inventory" && (
          <InventoryPage
            data={data}
            filteredItems={filteredItems}
            inventorySearch={inventorySearch}
            onDelete={deleteItem}
            onEdit={editItem}
            onExportCsv={handleExportCsv}
            onExportExcelCsv={handleExportExcelCsv}
            onImportCsv={(file) => void handleImportCsv(file)}
            onAddItem={startAddItem}
            onSearch={setInventorySearch}
            onStockAction={startStockAction}
            onStatusFilter={setStatusFilter}
            statusFilter={statusFilter}
          />
        )}
        {activePage === "add-item" && (
          <ItemFormPage
            data={data}
            editingItemId={editingItemId}
            form={itemForm}
            onCancel={closeItemForm}
            onChange={setItemForm}
            onSubmit={handleItemSubmit}
          />
        )}
        {activePage === "stock" && (
          <StockPage
            data={data}
            form={stockForm}
            onChange={setStockForm}
            onLowStockAlertChange={updateLowStockAlertLevel}
            onMinimumStockChange={updateMinimumStockLevel}
            onSubmit={handleStockSubmit}
          />
        )}
        {activePage === "locations" && (
          <LocationsPage
            data={data}
            form={locationForm}
            isAddOpen={isAddLocationOpen}
            onChange={setLocationForm}
            onDelete={deleteLocation}
            onSubmit={handleLocationSubmit}
            onToggleAdd={() => setIsAddLocationOpen((open) => !open)}
            updateSettings={updateSettings}
          />
        )}
        {activePage === "vendors" && (
          <VendorsPage
            data={data}
            editingVendorId={editingVendorId}
            form={vendorForm}
            isAddOpen={isAddVendorOpen}
            onCancelEdit={cancelVendorEdit}
            onFormAiHelp={() => void handleVendorFormAiHelp()}
            onInlineAiHelp={handleInlineVendorAiHelp}
            onChange={setVendorForm}
            onDelete={deleteVendor}
            onEdit={startEditVendor}
            onSubmit={handleVendorSubmit}
            onToggleAdd={toggleVendorAddPanel}
            onUpdateNotes={updateVendorNotes}
            recentlySavedVendorNoteId={recentlySavedVendorNoteId}
          />
        )}
        {activePage === "reorder" && (
          <ReorderPage data={data} items={reorderItems} onDataChange={commitData} onStockAction={startStockAction} />
        )}
        {activePage === "history" && <HistoryPage data={data} />}
      </div>
    </main>
  );
}

function DashboardPage({
  data,
  onStockAction,
  recentAddAlerts,
  reorderItems,
  setActivePage
}: {
  data: AppData;
  onStockAction: (itemId: string, actionType?: StockActionType | "") => void;
  recentAddAlerts: RecentAddAlert[];
  reorderItems: InventoryItem[];
  setActivePage: (page: PageId) => void;
}) {
  const visibleReorderItems = reorderItems.slice(0, 8);

  return (
    <section className="space-y-5">
      {recentAddAlerts.length > 0 && (
        <section className="panel">
          <SectionHeader kicker="Last 5 minutes" title="New Activity" />
          <div className="recent-alert-grid">
            {recentAddAlerts.map((alert) => (
              <div key={alert.id} className="recent-alert-card">
                <p>{alert.label}</p>
                <strong>{alert.name}</strong>
                <span>{formatDateTime(alert.occurredAt)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <SectionHeader
          action={
            <button className="btn-small" type="button" onClick={() => setActivePage("reorder")}>
              Open Reorder List
            </button>
          }
          kicker="Watch list"
          title="Items Needing Attention"
        />
        <div className="watch-list-grid">
          {visibleReorderItems.map((item) => {
            const status = getInventoryStatus(item, data.settings);

            const openStockEdit = () => onStockAction(item.id);
            const handleCardKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
              if (event.target !== event.currentTarget) {
                return;
              }

              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openStockEdit();
              }
            };
            return (
              <div
                key={item.id}
                className={`watch-card ${statusCardClassName(status)}`}
                role="button"
                tabIndex={0}
                aria-label={`Open stock edit for ${item.partNumber || item.name}`}
                onClick={openStockEdit}
                onKeyDown={handleCardKeyDown}
              >
                <div className="watch-card-top">
                  <StatusTag status={status} showOrb={false} />
                  <StockQuantity compact item={item} settings={data.settings} />
                </div>
                <div className="watch-card-body">
                  <h3>{item.name}</h3>
                  <p>{item.partNumber || "No part number"}</p>
                </div>
              </div>
            );
          })}
          {reorderItems.length === 0 && (
            <div className="mini-card watch-empty-card">
              <h3 className="text-base font-bold text-white">No reorder alerts</h3>
              <p className="mt-1 text-sm text-slate-400">No items are out of stock or inside the low-alert range.</p>
            </div>
          )}
        </div>
      </section>
    </section>
  );
}

function InventoryCsvMenu({
  onExportCsv,
  onExportExcelCsv,
  onImportCsv
}: {
  onExportCsv: () => void;
  onExportExcelCsv: () => void;
  onImportCsv: (file: File) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [isOpen]);

  const chooseImportFile = () => {
    setIsOpen(false);
    inputRef.current?.click();
  };

  return (
    <div ref={menuRef} className="inventory-transfer-menu">
      <button
        className="inventory-transfer-button"
        type="button"
        aria-expanded={isOpen}
        aria-label="Inventory CSV import and export"
        title="Import / Export CSV"
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className="transfer-icon" aria-hidden="true">
          <span className="transfer-folder" />
          <span className="transfer-paper" />
        </span>
      </button>
      {isOpen && (
        <div className="inventory-transfer-dropdown" role="menu">
          <button type="button" role="menuitem" onClick={chooseImportFile}>
            Import CSV
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsOpen(false);
              onExportCsv();
            }}
          >
            Export CSV
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsOpen(false);
              onExportExcelCsv();
            }}
          >
            Export Excel-friendly CSV
          </button>
        </div>
      )}
      <input
        ref={inputRef}
        hidden
        accept=".csv,text/csv"
        type="file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            onImportCsv(file);
          }
          event.currentTarget.value = "";
        }}
      />
    </div>
  );
}

function VendorAiPurposeDialog({
  onApply,
  onCancel,
  onChange,
  promptText
}: {
  onApply: () => void;
  onCancel: () => void;
  onChange: (value: string) => void;
  promptText: string;
}) {
  return (
    <div className="vendor-ai-dialog-backdrop" role="presentation">
      <section className="vendor-ai-dialog" role="dialog" aria-modal="true" aria-labelledby="vendor-ai-dialog-title">
        <SectionHeader kicker="Vendor AI Help" title="AI Help Needs More Info" />
        <p id="vendor-ai-dialog-title">
          I could not tell enough from the website/vendor info. What do you use this vendor for?
        </p>
        <textarea
          className="input"
          autoFocus
          placeholder={"hydraulic hoses and fittings\nsensors and machine controls\nrobot grippers and vacuum cups\nheater bands and thermocouples"}
          value={promptText}
          onChange={(event) => onChange(event.target.value)}
        />
        <div className="vendor-ai-dialog-actions">
          <button className="btn-muted" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn-primary" type="button" onClick={onApply}>
            Apply Note
          </button>
        </div>
      </section>
    </div>
  );
}

function ManualUpdateNoticeDialog({
  onLater,
  onOpenFolder,
  updateCheck
}: {
  onLater: () => void;
  onOpenFolder: () => void;
  updateCheck: ManualInstallerCheckResult;
}) {
  const installer = updateCheck.newerInstaller;

  if (!installer) {
    return null;
  }

  return (
    <div className="review-modal-backdrop" role="presentation">
      <section className="review-modal update-available-modal" role="dialog" aria-modal="true" aria-labelledby="manual-update-title">
        <h3 id="manual-update-title">New Installer Available</h3>
        <p>A newer Maintenance Inventory Tracker setup file was found.</p>
        <div className="review-modal-summary">
          <strong>Current version</strong>
          <span>{updateCheck.currentVersion}</span>
        </div>
        <div className="review-modal-summary">
          <strong>New installer version</strong>
          <span>{installer.version}</span>
        </div>
        <div className="review-modal-summary">
          <strong>Installer file name</strong>
          <span>{installer.fileName}</span>
        </div>
        <div className="review-modal-actions">
          <button className="btn-primary" type="button" onClick={onOpenFolder}>
            Open Installer Folder
          </button>
          <button className="btn-muted" type="button" onClick={onLater}>
            Later
          </button>
        </div>
      </section>
    </div>
  );
}

function BackupWorkflowDialog({
  backupSupported,
  dialog,
  onCancel,
  onChooseFolder,
  onConfirmImport,
  onImportExisting,
  onNotNow,
  onOverwrite,
  onRemindLater,
  onSaveBackupNow
}: {
  backupSupported: boolean;
  dialog: BackupDialogState;
  onCancel: () => void;
  onChooseFolder: () => void;
  onConfirmImport: (dialog: Extract<BackupDialogState, { kind: "confirm-import" }>) => void;
  onImportExisting: (dialog: Extract<BackupDialogState, { kind: "existing-file" }>) => void;
  onNotNow: () => void;
  onOverwrite: (selection: BackupDirectorySelection) => void;
  onRemindLater: () => void;
  onSaveBackupNow: (selection: BackupDirectorySelection) => void;
}) {
  if (dialog.kind === "setup") {
    return (
      <div className="csv-import-backdrop" role="presentation">
        <section className="csv-import-dialog" role="dialog" aria-modal="true" aria-labelledby="backup-setup-title">
          <SectionHeader kicker="Backup setup" title="Choose Backup Folder" />
          <p id="backup-setup-title" className="backup-dialog-message">
            Backup folder is not set up yet. Please choose a folder so your inventory tracker can save backups and restore data on another computer.
          </p>
          <div className="csv-import-actions">
            <button className="btn-muted" type="button" onClick={onRemindLater}>
              Remind Me Later
            </button>
            <button className="btn-primary" type="button" onClick={onChooseFolder} disabled={!backupSupported}>
              Choose Backup Folder
            </button>
          </div>
        </section>
      </div>
    );
  }

  if (dialog.kind === "existing-file") {
    return (
      <div className="csv-import-backdrop" role="presentation">
        <section className="csv-import-dialog" role="dialog" aria-modal="true" aria-labelledby="backup-existing-title">
          <SectionHeader kicker="Backup file found" title="Existing Backup" />
          <p id="backup-existing-title" className="backup-dialog-message">
            A backup file already exists in this folder. What would you like to do?
          </p>
          <div className="backup-dialog-detail">
            <span>File</span>
            <strong>{BACKUP_LATEST_FILENAME}</strong>
            <span>Modified</span>
            <strong>{dialog.backupRead.lastModifiedAt ? formatDateTime(dialog.backupRead.lastModifiedAt) : "Unknown"}</strong>
          </div>
          <div className="csv-import-actions">
            <button className="btn-muted" type="button" onClick={onCancel}>
              Cancel
            </button>
            <button className="btn-muted" type="button" onClick={() => onOverwrite(dialog.selection)}>
              Overwrite With Current Data
            </button>
            <button className="btn-primary" type="button" onClick={() => onImportExisting(dialog)}>
              Import Existing Backup
            </button>
          </div>
        </section>
      </div>
    );
  }

  if (dialog.kind === "no-file") {
    return (
      <div className="csv-import-backdrop" role="presentation">
        <section className="csv-import-dialog" role="dialog" aria-modal="true" aria-labelledby="backup-empty-title">
          <SectionHeader kicker="Backup folder" title="No Backup File" />
          <p id="backup-empty-title" className="backup-dialog-message">
            No backup file was found in this folder. Save current inventory data here now?
          </p>
          <div className="csv-import-actions">
            <button className="btn-muted" type="button" onClick={onNotNow}>
              Not Now
            </button>
            <button className="btn-primary" type="button" onClick={() => onSaveBackupNow(dialog.selection)}>
              Save Backup Now
            </button>
          </div>
        </section>
      </div>
    );
  }

  const backupIsNewer = isBackupNewerThanLocal(dialog.backupTimestamp, dialog.localTimestamp);

  return (
    <div className="csv-import-backdrop" role="presentation">
      <section className="csv-import-dialog" role="dialog" aria-modal="true" aria-labelledby="backup-confirm-title">
        <SectionHeader
          kicker={dialog.source === "manual" ? "Manual JSON import" : "Backup import"}
          title="Confirm Import"
        />
        <p id="backup-confirm-title" className="backup-dialog-message">
          Importing replaces the current local inventory data. The backup file has been validated as a Maintenance Inventory Tracker backup.
        </p>
        <div className="backup-dialog-detail">
          <span>File</span>
          <strong>{dialog.fileName}</strong>
          <span>Backup timestamp</span>
          <strong>{dialog.backupTimestamp ? formatDateTime(dialog.backupTimestamp) : "Unknown"}</strong>
          <span>Local timestamp</span>
          <strong>{dialog.localTimestamp ? formatDateTime(dialog.localTimestamp) : "Unknown"}</strong>
          <span>File modified</span>
          <strong>{dialog.fileLastModifiedAt ? formatDateTime(dialog.fileLastModifiedAt) : "Unknown"}</strong>
        </div>
        <p className={backupIsNewer ? "backup-dialog-recommend" : "backup-dialog-warning"}>
          {backupIsNewer
            ? "This backup appears newer than the local inventory data. Importing is recommended."
            : "Local data appears newer or the same age. Import only if you want this file to replace the current inventory data."}
        </p>
        <div className="csv-import-actions">
          <button className="btn-muted" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn-primary" type="button" onClick={() => onConfirmImport(dialog)}>
            Import Backup
          </button>
        </div>
      </section>
    </div>
  );
}

function CsvImportPreviewDialog({
  onCancel,
  onConfirm,
  preview
}: {
  onCancel: () => void;
  onConfirm: () => void;
  preview: CsvImportPreview;
}) {
  return (
    <div className="csv-import-backdrop" role="presentation">
      <section className="csv-import-dialog" role="dialog" aria-modal="true" aria-labelledby="csv-import-title">
        <SectionHeader
          action={
            <button className="settings-close" type="button" aria-label="Cancel CSV import" onClick={onCancel}>
              X
            </button>
          }
          kicker="CSV preview"
          title="Import Parts"
        />
        <div className="csv-import-file">
          <span>{preview.fileName}</span>
          <strong>Header row {preview.headerRowNumber}</strong>
        </div>
        <div className="csv-import-summary-grid">
          <ImportSummaryCard label="Rows found" value={preview.rowsFound} />
          <ImportSummaryCard label="New items" value={preview.newItems} />
          <ImportSummaryCard label="Existing updates" value={preview.updatedItems} />
          <ImportSummaryCard label="New vendors" value={preview.vendorsToCreate.length} />
          <ImportSummaryCard label="New locations" value={preview.locationsToCreate.length} />
        </div>
        <div className="csv-import-list-grid">
          <CsvImportNameList title="Vendors to create" names={preview.vendorsToCreate} />
          <CsvImportNameList title="Locations to create" names={preview.locationsToCreate} />
        </div>
        <div className="csv-import-actions">
          <button className="btn-muted" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn-primary" type="button" onClick={onConfirm}>
            Import Parts
          </button>
        </div>
      </section>
    </div>
  );
}

function ImportSummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="csv-import-summary-card">
      <span>{label}</span>
      <strong>{formatNumber(value)}</strong>
    </div>
  );
}

function CsvImportNameList({ names, title }: { names: string[]; title: string }) {
  return (
    <div className="csv-import-name-list">
      <span>{title}</span>
      {names.length > 0 ? (
        <p>{names.slice(0, 5).join(", ")}{names.length > 5 ? `, +${names.length - 5} more` : ""}</p>
      ) : (
        <p>None</p>
      )}
    </div>
  );
}

function InventoryPage({
  data,
  filteredItems,
  inventorySearch,
  onAddItem,
  onDelete,
  onEdit,
  onExportCsv,
  onExportExcelCsv,
  onImportCsv,
  onSearch,
  onStockAction,
  onStatusFilter,
  statusFilter
}: {
  data: AppData;
  filteredItems: InventoryItem[];
  inventorySearch: string;
  onAddItem: () => void;
  onDelete: (itemId: string) => void;
  onEdit: (item: InventoryItem) => void;
  onExportCsv: () => void;
  onExportExcelCsv: () => void;
  onImportCsv: (file: File) => void;
  onSearch: (value: string) => void;
  onStockAction: (itemId: string, actionType?: StockActionType | "") => void;
  onStatusFilter: (status: "All" | InventoryStatus) => void;
  statusFilter: "All" | InventoryStatus;
}) {
  return (
    <section className="panel inventory-panel">
      <div className="inventory-panel-header">
        <div className="inventory-title-block">
          <p className="eyebrow">Inventory</p>
          <h2>Parts Table</h2>
        </div>
        <div className="inventory-header-actions">
          <button className="inventory-add-button" type="button" onClick={onAddItem}>
            Add Item
          </button>
          <InventoryCsvMenu
            onExportCsv={onExportCsv}
            onExportExcelCsv={onExportExcelCsv}
            onImportCsv={onImportCsv}
          />
        </div>
      </div>
      <div className="inventory-controls">
        <input
          className="input"
          placeholder="Search item, part number, description, category, location, vendor, or notes"
          value={inventorySearch}
          onChange={(event) => onSearch(event.target.value)}
        />
        <div className="subtab-bar">
          {(["All", "In Stock", "Low Stock", "Out of Stock"] as const).map((status) => (
            <button
              key={status}
              className={statusFilter === status ? "subtab-active" : "subtab-button"}
              type="button"
              onClick={() => onStatusFilter(status)}
            >
              {status}
            </button>
          ))}
        </div>
      </div>
      <div className="inventory-table-desktop">
        <SimpleTable
          emptyText="No inventory items found."
          headers={[
            "Location",
            "Part Number",
            "Category",
            "Description",
            "Stock On Hand",
            "Status",
            "Vendor",
            "Cost",
            "Actions"
          ]}
          rows={filteredItems.map((item) => [
            getLocationName(data, item.locationId),
            <PartNumberCell key="part-number" item={item} />,
            item.category || "-",
            item.description || "-",
            <StockQuantity
              key="quantity"
              item={item}
              settings={data.settings}
              compact
              onClick={() => onStockAction(item.id, "Set Stock On Hand")}
              title="Edit stock"
              ariaLabel={`Edit stock for ${item.partNumber || item.name || "item"}`}
            />,
            <StatusTag
              key="status"
              status={getInventoryStatus(item, data.settings)}
              onClick={() => onStockAction(item.id)}
              title="Edit stock"
              ariaLabel={`Edit stock status for ${item.partNumber || item.name || "item"}`}
            />,
            getVendorName(data, item.vendorId),
            formatCurrency(item.costEach),
            <InventoryRowActions key="actions" item={item} onDelete={onDelete} onEdit={onEdit} />
          ])}
        />
      </div>
      <div className="inventory-card-list">
        {filteredItems.length === 0 && <div className="inventory-empty-card">No inventory items found.</div>}
        {filteredItems.map((item) => (
          <InventoryItemCard
            key={item.id}
            data={data}
            item={item}
            onDelete={onDelete}
            onEdit={onEdit}
            onStockAction={onStockAction}
          />
        ))}
      </div>
    </section>
  );
}

function InventoryRowActions({
  item,
  onDelete,
  onEdit
}: {
  item: InventoryItem;
  onDelete: (itemId: string) => void;
  onEdit: (item: InventoryItem) => void;
}) {
  return (
    <div className="inventory-actions">
      <button className="btn-small" type="button" onClick={() => onEdit(item)}>
        Edit
      </button>
      <button className="btn-danger" type="button" onClick={() => onDelete(item.id)}>
        Delete
      </button>
    </div>
  );
}

function InventoryItemCard({
  data,
  item,
  onDelete,
  onEdit,
  onStockAction
}: {
  data: AppData;
  item: InventoryItem;
  onDelete: (itemId: string) => void;
  onEdit: (item: InventoryItem) => void;
  onStockAction: (itemId: string, actionType?: StockActionType | "") => void;
}) {
  return (
    <article className="inventory-item-card">
      <div className="inventory-item-card-header">
        <div>
          <h3>{item.name}</h3>
          <p>{getLocationName(data, item.locationId)}</p>
        </div>
        <StatusTag
          status={getInventoryStatus(item, data.settings)}
          onClick={() => onStockAction(item.id)}
          title="Edit stock"
          ariaLabel={`Edit stock status for ${item.partNumber || item.name || "item"}`}
        />
      </div>
      <div className="inventory-item-card-grid">
        <InventoryCardField label="Part number" value={<PartNumberCell item={item} />} />
        <InventoryCardField
          label="Stock on hand"
          value={
            <StockQuantity
              item={item}
              settings={data.settings}
              compact
              onClick={() => onStockAction(item.id, "Set Stock On Hand")}
              title="Edit stock"
              ariaLabel={`Edit stock for ${item.partNumber || item.name || "item"}`}
            />
          }
        />
        <InventoryCardField label="Vendor" value={getVendorName(data, item.vendorId)} />
        <InventoryCardField label="Cost" value={formatCurrency(item.costEach)} />
      </div>
      <InventoryRowActions item={item} onDelete={onDelete} onEdit={onEdit} />
    </article>
  );
}

function InventoryCardField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="inventory-card-field">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

type ItemFormProps = {
  data: AppData;
  editingItemId: string | null;
  form: ItemFormState;
  onCancel: () => void;
  onChange: (form: ItemFormState) => void;
  onSubmit: (event: FormEvent) => void;
};

type ItemFormContentProps = ItemFormProps & {
  headerAction?: React.ReactNode;
};

function ItemFormDrawer({
  data,
  editingItemId,
  form,
  onCancel,
  onChange,
  onSubmit
}: ItemFormProps) {
  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };

    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onCancel]);

  return (
    <div
      className="item-form-drawer-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <section className="item-form-drawer" role="dialog" aria-modal="true" aria-label={editingItemId ? "Edit item" : "Add item"}>
        <ItemFormContent
          data={data}
          editingItemId={editingItemId}
          form={form}
          headerAction={
            <button className="settings-close item-form-close-button" type="button" aria-label="Close item form" onClick={onCancel}>
              X
            </button>
          }
          onCancel={onCancel}
          onChange={onChange}
          onSubmit={onSubmit}
        />
      </section>
    </div>
  );
}

function ItemFormPage(props: ItemFormProps) {
  return (
    <section className="space-y-5">
      <section className="panel">
        <ItemFormContent {...props} />
      </section>
    </section>
  );
}

function ItemFormContent({
  data,
  editingItemId,
  form,
  headerAction,
  onCancel,
  onChange,
  onSubmit
}: ItemFormContentProps) {
  return (
    <>
      <div className="item-form-header">
        <SectionHeader action={headerAction} kicker="Item master" title={editingItemId ? "Edit Item" : "Add Item"} />
      </div>
      <form className="item-form-grid" onSubmit={onSubmit}>
          <label className="field-label xl:col-span-2">
            Item name
            <input className="input" value={form.name} onChange={(event) => onChange({ ...form, name: event.target.value })} />
          </label>
          <label className="field-label">
            Part number
            <input
              className="input"
              value={form.partNumber}
              onChange={(event) => onChange({ ...form, partNumber: event.target.value })}
            />
          </label>
          <label className="field-label xl:col-span-2">
            Hyperlink / Part Info URL
            <input
              className="input"
              placeholder="https://vendor.example/part"
              value={form.itemUrl}
              onChange={(event) => onChange({ ...form, itemUrl: event.target.value })}
            />
          </label>
          <label className="field-label">
            Category
            <select
              className="input"
              value={form.category}
              onChange={(event) => onChange({ ...form, category: event.target.value })}
            >
              {categoryOptions.map((category) => (
                <option key={category}>{category}</option>
              ))}
            </select>
          </label>
          <label className="field-label md:col-span-2 xl:col-span-4">
            Description
            <textarea
              className="input min-h-24"
              value={form.description}
              onChange={(event) => onChange({ ...form, description: event.target.value })}
            />
          </label>
          <label className="field-label">
            Quantity on hand
            <input
              className="input"
              min={data.settings.allowNegativeStockOverride ? undefined : "0"}
              step="1"
              type="number"
              value={form.quantityOnHand}
              onChange={(event) =>
                onChange({
                  ...form,
                  quantityOnHand: normalizeWholeNumberInput(event.target.value, {
                    allowNegative: data.settings.allowNegativeStockOverride
                  })
                })
              }
            />
          </label>
          <label className="field-label">
            Stock unit
            <select
              className="input"
              value={normalizeStockUnit(form.stockUnit)}
              onChange={(event) => onChange({ ...form, stockUnit: normalizeStockUnit(event.target.value) })}
            >
              {stockUnitOptions.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            Minimum stock level
            <input
              className="input"
              min="0"
              step="1"
              type="number"
              value={form.minimumStockLevel}
              onChange={(event) => onChange({ ...form, minimumStockLevel: normalizeWholeNumberInput(event.target.value) })}
            />
          </label>
          <label className="field-label">
            Low Stock Alert Level
            <input
              className="input"
              min="0"
              step="1"
              type="number"
              value={form.lowStockAlertLevel}
              onChange={(event) =>
                onChange({
                  ...form,
                  lowStockAlertLevel: normalizeWholeNumberInput(event.target.value)
                })
              }
            />
            <span className="field-helper">Set to 0 to turn off low stock alerts.</span>
          </label>
          <label className="field-label">
            Location
            <select
              className="input"
              value={form.locationId}
              onChange={(event) => onChange({ ...form, locationId: event.target.value })}
            >
              <option value="">Unassigned</option>
              {data.locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            Vendor
            <select
              className="input"
              value={form.vendorId}
              onChange={(event) => onChange({ ...form, vendorId: event.target.value })}
            >
              <option value="">Unassigned</option>
              {data.vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            Cost each
            <input
              className="input"
              min="0"
              step="0.01"
              type="number"
              value={form.costEach}
              onChange={(event) => onChange({ ...form, costEach: normalizeDecimalInput(event.target.value) })}
            />
          </label>
          <label className="field-label md:col-span-2 xl:col-span-3">
            Notes
            <input className="input" value={form.notes} onChange={(event) => onChange({ ...form, notes: event.target.value })} />
          </label>
          <div className="media-placeholder md:col-span-1 xl:col-span-2">
            <span>Image / Photo</span>
            <strong>Placeholder</strong>
            <input
              aria-label="Image placeholder note"
              className="input mt-3"
              placeholder="Optional image note"
              value={form.imagePlaceholder}
              onChange={(event) => onChange({ ...form, imagePlaceholder: event.target.value })}
            />
          </div>
          <div className="qr-placeholder md:col-span-1 xl:col-span-2">
            <span>QR label preview</span>
            <QrPreview value={form.barcodePlaceholder} />
            <label className="field-label mt-3">
              QR Code Value
              <input
                className="input"
                placeholder="Optional QR value"
                value={form.barcodePlaceholder}
                onChange={(event) => onChange({ ...form, barcodePlaceholder: event.target.value })}
              />
            </label>
          </div>
          <div className="item-form-actions">
            <button className="btn-primary" type="submit">
              {editingItemId ? "Update Item" : "Add Item"}
            </button>
            <button className="btn-muted" type="button" onClick={onCancel}>
              {editingItemId ? "Cancel Edit" : "Cancel Add"}
            </button>
          </div>
        </form>
    </>
  );
}

function StockPage({
  data,
  form,
  onChange,
  onLowStockAlertChange,
  onMinimumStockChange,
  onSubmit
}: {
  data: AppData;
  form: StockFormState;
  onChange: (form: StockFormState) => void;
  onLowStockAlertChange: (itemId: string, lowStockAlertLevel: number) => void;
  onMinimumStockChange: (itemId: string, minimumStockLevel: number) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const selectedItem = data.items.find((item) => item.id === form.itemId);
  const selectedStatus = selectedItem ? getInventoryStatus(selectedItem, data.settings) : null;
  const [minimumEdit, setMinimumEdit] = useState<{ value: string; warning: string } | null>(null);
  const [lowAlertEdit, setLowAlertEdit] = useState("");
  const skipLowAlertBlurRef = useRef(false);
  const isSetStockOnHand = form.actionType === "Set Stock On Hand";
  const quantityText = String(form.quantity).trim();
  const parsedQuantity = quantityText ? wholeNumberValue(form.quantity, Number.NaN) : Number.NaN;
  const hasValidQuantity =
    selectedItem !== undefined &&
    form.actionType !== "" &&
    Number.isFinite(parsedQuantity) &&
    (form.actionType === "Set Stock On Hand" ? true : parsedQuantity > 0);
  const previewQuantity =
    selectedItem && form.actionType && hasValidQuantity
      ? calculateStockQuantity(selectedItem.quantityOnHand, form.actionType, parsedQuantity)
      : null;
  const validPreviewQuantity =
    previewQuantity !== null && (previewQuantity >= 0 || data.settings.allowNegativeStockOverride) ? previewQuantity : null;
  const previewQuantityItem =
    selectedItem && validPreviewQuantity !== null ? { ...selectedItem, quantityOnHand: validPreviewQuantity } : null;

  useEffect(() => {
    setMinimumEdit(null);
  }, [selectedItem?.id]);

  useEffect(() => {
    setLowAlertEdit(selectedItem ? String(selectedItem.lowStockAlertLevel) : "");
  }, [selectedItem?.id, selectedItem?.lowStockAlertLevel]);

  const saveMinimumEdit = () => {
    if (!selectedItem || !minimumEdit) {
      return;
    }

    const parsed = wholeNumberValue(minimumEdit.value, Number.NaN);

    if (!Number.isFinite(parsed) || parsed < 0) {
      setMinimumEdit({ ...minimumEdit, warning: "Minimum stock level cannot be negative." });
      return;
    }

    onMinimumStockChange(selectedItem.id, parsed);
    setMinimumEdit(null);
  };

  const saveLowAlertEdit = () => {
    if (skipLowAlertBlurRef.current) {
      skipLowAlertBlurRef.current = false;
      return;
    }

    if (!selectedItem) {
      return;
    }

    const nextLowAlert = Math.max(0, wholeNumberValue(lowAlertEdit));

    setLowAlertEdit(String(nextLowAlert));

    if (nextLowAlert !== selectedItem.lowStockAlertLevel) {
      onLowStockAlertChange(selectedItem.id, nextLowAlert);
    }
  };

  const handleLowAlertKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    }

    if (event.key === "Escape") {
      event.preventDefault();
      skipLowAlertBlurRef.current = true;
      setLowAlertEdit(selectedItem ? String(selectedItem.lowStockAlertLevel) : "");
      event.currentTarget.blur();
    }
  };

  const handleActionTypeChange = (actionType: StockActionType | "") => {
    const nextQuantity = actionType === "Set Stock On Hand" ? "" : form.quantity === "" ? 1 : form.quantity;

    onChange({ ...form, actionType, quantity: nextQuantity });
  };

  return (
    <section className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
      <section className="panel">
        <SectionHeader title="Stock Edit" />
        <form className="grid gap-4" onSubmit={onSubmit}>
          <label className="field-label">
            Select item
            <select className="input" value={form.itemId} onChange={(event) => onChange({ ...form, itemId: event.target.value })}>
              <option value="">Choose item</option>
              {data.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} {item.partNumber ? `- ${item.partNumber}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            Action type
            <select
              className="input"
              value={form.actionType}
              onChange={(event) => handleActionTypeChange(event.target.value as StockActionType | "")}
            >
              <option value="">Choose Add or Pull</option>
              <option value="Stock In">Add Stock</option>
              <option value="Stock Out">Pull Stock</option>
              <option value="Set Stock On Hand">Set Stock On Hand</option>
            </select>
          </label>
          <label className="field-label">
            {getStockQuantityLabel(form.actionType)}
            <input
              className="input"
              min={isSetStockOnHand ? (data.settings.allowNegativeStockOverride ? undefined : "0") : "1"}
              placeholder={getStockQuantityPlaceholder(form.actionType)}
              step="1"
              type="number"
              value={form.quantity}
              onChange={(event) =>
                onChange({
                  ...form,
                  quantity: normalizeWholeNumberInput(event.target.value, { allowNegative: isSetStockOnHand })
                })
              }
            />
          </label>
          {selectedItem && (
            <div className="stock-count-preview">
              <div>
                <span>Current Stock On Hand</span>
                <strong>{formatStockQuantity(selectedItem)}</strong>
              </div>
              {previewQuantityItem && (
                <div>
                  <span>New Stock On Hand</span>
                  <strong>{formatStockQuantity(previewQuantityItem)}</strong>
                </div>
              )}
            </div>
          )}
          <label className="field-label">
            Reason
            <input
              className="input"
              placeholder={isSetStockOnHand ? "Physical count adjustment." : ""}
              value={form.reason}
              onChange={(event) => onChange({ ...form, reason: event.target.value })}
            />
          </label>
          <label className="field-label">
            Used by / Added by
            <input className="input" value={form.actor} onChange={(event) => onChange({ ...form, actor: event.target.value })} />
          </label>
          <label className="field-label">
            Date/time
            <input
              className="input"
              type="datetime-local"
              value={form.occurredAt}
              onChange={(event) => onChange({ ...form, occurredAt: event.target.value })}
            />
          </label>
          <label className="field-label">
            Notes
            <textarea className="input min-h-24" value={form.notes} onChange={(event) => onChange({ ...form, notes: event.target.value })} />
          </label>
          <button className="btn-primary btn-stock-save" type="submit">
            {isSetStockOnHand ? "Save Actual Count" : "Save Stock Change"}
          </button>
        </form>
      </section>
      <section className="panel">
        <SectionHeader kicker="Selected item" title={selectedItem?.name ?? "No item selected"} />
        {selectedItem ? (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <StatCard label="Stock On Hand" tone="cyan" value={formatStockQuantity(selectedItem)} />
              <button
                className="metric-card metric-amber metric-action-card"
                type="button"
                aria-label={`Edit minimum stock level for ${selectedItem.partNumber || selectedItem.name}`}
                title="Edit minimum stock level"
                onClick={() => setMinimumEdit({ value: String(selectedItem.minimumStockLevel), warning: "" })}
              >
                <span className="block text-xs font-bold uppercase text-slate-400">Minimum</span>
                <span className="mt-2 block text-2xl font-black text-white">{formatNumber(selectedItem.minimumStockLevel)}</span>
              </button>
              <StatCard label="Low Alert" tone="amber" value={formatNumber(selectedItem.lowStockAlertLevel)} />
              <StatusStatCard status={selectedStatus ?? "In Stock"} />
            </div>
            {previewQuantityItem && (
              <div className="stock-preview-card">
                <span>New Quantity After Save</span>
                <strong>{formatStockQuantity(previewQuantityItem)}</strong>
              </div>
            )}
            {minimumEdit && (
              <div className="minimum-edit-popover" role="dialog" aria-label="Edit minimum stock level">
                <div>
                  <p className="eyebrow">Minimum Stock Level</p>
                  <h3>{selectedItem.partNumber || selectedItem.name}</h3>
                  <span>Current minimum: {formatNumber(selectedItem.minimumStockLevel)}</span>
                </div>
                <label className="field-label">
                  New minimum
                  <input
                    className="input"
                    min="0"
                    step="1"
                    type="number"
                    value={minimumEdit.value}
                    onChange={(event) =>
                      setMinimumEdit({ value: normalizeWholeNumberInput(event.target.value), warning: "" })
                    }
                  />
                </label>
                {minimumEdit.warning && <p className="warning-bar">{minimumEdit.warning}</p>}
                <div className="minimum-edit-actions">
                  <button className="btn-primary" type="button" onClick={saveMinimumEdit}>
                    Save
                  </button>
                  <button className="btn-muted" type="button" onClick={() => setMinimumEdit(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
            <label className="field-label">
              Low Stock Alert Level
              <input
                className="input"
                min="0"
                step="1"
                type="number"
                value={lowAlertEdit}
                onBlur={saveLowAlertEdit}
                onChange={(event) => setLowAlertEdit(normalizeWholeNumberInput(event.target.value))}
                onKeyDown={handleLowAlertKeyDown}
              />
              <span className="field-helper">Set to 0 to turn off low stock alerts.</span>
            </label>
            <div className="summary-strip">
              <span>{selectedItem.partNumber || "No part number"}</span>
              <span>{selectedItem.category || "No category"}</span>
              <span>{getLocationName(data, selectedItem.locationId)}</span>
              <span>{getVendorName(data, selectedItem.vendorId)}</span>
            </div>
            {!data.settings.allowNegativeStockOverride && (
              <p className="warning-bar">Stock cannot go below 0 unless override is enabled in Settings.</p>
            )}
          </div>
        ) : (
          <p className="text-sm font-semibold text-slate-400">Choose an item to preview quantity and status.</p>
        )}
      </section>
    </section>
  );
}

function LocationsPage({
  data,
  form,
  isAddOpen,
  onChange,
  onDelete,
  onSubmit,
  onToggleAdd,
  updateSettings
}: {
  data: AppData;
  form: LocationFormState;
  isAddOpen: boolean;
  onChange: (form: LocationFormState) => void;
  onDelete: (locationId: string) => void;
  onSubmit: (event: FormEvent) => void;
  onToggleAdd: () => void;
  updateSettings: (settings: AppSettings, auditSummary?: string) => void;
}) {
  return (
    <section className="space-y-5">
      <section className="collapsible-add-panel">
        <button className="collapsible-add-trigger" type="button" aria-expanded={isAddOpen} onClick={onToggleAdd}>
          <span>{isAddOpen ? "-" : "+"}</span>
          Add Location
        </button>
        {isAddOpen && (
          <form className="collapsible-add-form" onSubmit={onSubmit}>
            <label className="field-label">
              Location name
              <input className="input" value={form.name} onChange={(event) => onChange({ ...form, name: event.target.value })} />
            </label>
            <label className="field-label">
              Description
              <input
                className="input"
                value={form.description}
                onChange={(event) => onChange({ ...form, description: event.target.value })}
              />
            </label>
            <label className="field-label">
              Notes
              <textarea className="input min-h-24" value={form.notes} onChange={(event) => onChange({ ...form, notes: event.target.value })} />
            </label>
            <button className="btn-primary" type="submit">
              Add Location
            </button>
          </form>
        )}
      </section>
      <section className="panel">
        <SectionHeader kicker="Storage map" title="Locations" />
        <SimpleTable
          emptyText="No locations saved."
          headers={["Name", "Description", "Items", "Default", "Notes", "Actions"]}
          rows={data.locations.map((location) => {
            const itemCount = data.items.filter((item) => item.locationId === location.id).length;

            return [
              location.name,
              location.description || "-",
              formatNumber(itemCount),
              data.settings.defaultLocationId === location.id ? (
                <StatusTag key="default" status="Default" />
              ) : (
                <button
                  key="set-default"
                  className="btn-small"
                  type="button"
                  onClick={() =>
                    updateSettings(
                      { ...data.settings, defaultLocationId: location.id },
                      `${location.name} was set as the default location.`
                    )
                  }
                >
                  Set Default
                </button>
              ),
              location.notes || "-",
              <button key="delete" className="btn-danger" type="button" onClick={() => onDelete(location.id)}>
                Delete
              </button>
            ];
          })}
        />
      </section>
    </section>
  );
}

function VendorsPage({
  data,
  editingVendorId,
  form,
  isAddOpen,
  onCancelEdit,
  onChange,
  onDelete,
  onEdit,
  onFormAiHelp,
  onInlineAiHelp,
  onSubmit,
  onToggleAdd,
  onUpdateNotes,
  recentlySavedVendorNoteId
}: {
  data: AppData;
  editingVendorId: string | null;
  form: VendorFormState;
  isAddOpen: boolean;
  onCancelEdit: () => void;
  onChange: Dispatch<SetStateAction<VendorFormState>>;
  onDelete: (vendorId: string) => void;
  onEdit: (vendor: VendorRecord) => void;
  onFormAiHelp: () => void;
  onInlineAiHelp: (vendor: VendorRecord, currentDraft: string) => Promise<string | null>;
  onSubmit: (event: FormEvent) => void;
  onToggleAdd: () => void;
  onUpdateNotes: (vendorId: string, notes: string) => void;
  recentlySavedVendorNoteId: string | null;
}) {
  const isEditing = Boolean(editingVendorId);
  const panelTitle = isEditing ? "Edit Vendor" : "Add Vendor";

  return (
    <section className="space-y-5">
      <section className={`collapsible-add-panel vendor-add-panel${isAddOpen ? " vendor-add-panel-open" : ""}`}>
        <button className="collapsible-add-trigger vendor-add-trigger" type="button" aria-expanded={isAddOpen} onClick={onToggleAdd}>
          <span>{isAddOpen ? "-" : "+"}</span>
          {panelTitle}
        </button>
        {isAddOpen && (
          <form className="collapsible-add-form" onSubmit={onSubmit}>
            <div className="vendor-form-title">
              <p>{panelTitle}</p>
            </div>
            <label className="field-label">
              Vendor name
              <input className="input" value={form.name} onChange={(event) => onChange({ ...form, name: event.target.value })} />
            </label>
            <label className="field-label">
              Contact
              <input
                className="input"
                value={form.contactName}
                onChange={(event) => onChange({ ...form, contactName: event.target.value })}
              />
            </label>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="field-label">
                Phone
                <input className="input" value={form.phone} onChange={(event) => onChange({ ...form, phone: event.target.value })} />
              </label>
              <label className="field-label">
                Contact Email
                <input
                  className="input"
                  value={form.contactEmail}
                  onChange={(event) => onChange({ ...form, contactEmail: event.target.value })}
                />
              </label>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="field-label">
                General Email / Sales / Service
                <input className="input" value={form.email} onChange={(event) => onChange({ ...form, email: event.target.value })} />
              </label>
              <label className="field-label">
                Website
                <input className="input" value={form.website} onChange={(event) => onChange({ ...form, website: event.target.value })} />
              </label>
            </div>
            <div className="vendor-notes-form-block">
              <div className="vendor-notes-form-header">
                <span>Notes</span>
                <button
                  className="vendor-ai-help-button vendor-ai-help-form-button"
                  type="button"
                  title="Suggest what this vendor is used for."
                  onClick={onFormAiHelp}
                >
                  AI Suggest
                </button>
                <button
                  className="vendor-ai-help-button vendor-ai-grammar-button"
                  type="button"
                  title="Basic cleanup for spacing, punctuation, and common maintenance typos."
                  onClick={() =>
                    onChange((currentForm) => ({
                      ...currentForm,
                      notes: cleanMaintenanceNote(currentForm.notes)
                    }))
                  }
                  disabled={!form.notes.trim()}
                >
                  Clean Note
                </button>
              </div>
              <textarea className="input min-h-24" value={form.notes} onChange={(event) => onChange({ ...form, notes: event.target.value })} />
              <span className="field-helper">Clean Note is basic local cleanup. AI Suggest builds the vendor purpose note.</span>
            </div>
            <div className="vendor-form-actions">
              <button className="btn-primary" type="submit">
                {isEditing ? "Update Vendor" : "Add Vendor"}
              </button>
              {isEditing && (
                <button className="btn-muted" type="button" onClick={onCancelEdit}>
                  Cancel
                </button>
              )}
            </div>
          </form>
        )}
      </section>
      <section className="panel">
        <SectionHeader kicker="Supplier list" title="Vendors" />
        <div className="vendor-table">
          <SimpleTable
            emptyText="No vendors saved."
            headers={["Name", "Contact", "Phone", "General Email", "Website", "Items", "Notes", "Actions"]}
            rowKeys={data.vendors.map((vendor) => `${vendor.id}-${vendor.updatedAt}-${vendor.notes}`)}
            rows={data.vendors.map((vendor) => [
              vendor.name,
              <VendorContactCell key="contact" vendor={vendor} />,
              vendor.phone || "-",
              <VendorEmailCell key="email" email={vendor.email} />,
              <VendorWebsiteCell key="website" website={vendor.website} />,
              formatNumber(data.items.filter((item) => item.vendorId === vendor.id).length),
              <VendorNotesCell
                key="notes"
                isRecentlySaved={recentlySavedVendorNoteId === vendor.id}
                onAiHelp={onInlineAiHelp}
                onSave={onUpdateNotes}
                vendor={vendor}
              />,
              <div key="actions" className="vendor-action-group">
                <button className="vendor-edit-button" type="button" onClick={() => onEdit(vendor)}>
                  Edit
                </button>
                <button className="vendor-delete-button" type="button" onClick={() => onDelete(vendor.id)}>
                  Delete
                </button>
              </div>
            ])}
          />
        </div>
      </section>
    </section>
  );
}

function VendorContactCell({ vendor }: { vendor: VendorRecord }) {
  const contactName = vendor.contactName.trim();
  const contactEmail = vendor.contactEmail.trim();
  const mailHref = getMailHref(contactEmail);

  if (contactName && mailHref) {
    return (
      <a className="vendor-link" href={mailHref} title={contactEmail}>
        {contactName}
      </a>
    );
  }

  if (contactName) {
    return <span>{contactName}</span>;
  }

  if (mailHref) {
    return (
      <a className="vendor-link" href={mailHref}>
        {contactEmail}
      </a>
    );
  }

  return <span>-</span>;
}

function VendorEmailCell({ email }: { email: string }) {
  const trimmedEmail = email.trim();
  const mailHref = getMailHref(trimmedEmail);

  if (!mailHref) {
    return <span>-</span>;
  }

  return (
    <a className="vendor-link" href={mailHref}>
      {trimmedEmail}
    </a>
  );
}

function VendorWebsiteCell({ website }: { website: string }) {
  const trimmedWebsite = website.trim();
  const href = getExternalHref(trimmedWebsite);
  const displayText = getWebsiteDisplayText(trimmedWebsite);

  if (!href) {
    return <span>-</span>;
  }

  return (
    <a className="vendor-link vendor-website-link" href={href} target="_blank" rel="noreferrer" title={trimmedWebsite}>
      <span className="vendor-website-text">{displayText}</span>
    </a>
  );
}

function VendorNotesCell({
  isRecentlySaved,
  onAiHelp,
  onSave,
  vendor
}: {
  isRecentlySaved: boolean;
  onAiHelp: (vendor: VendorRecord, currentDraft: string) => Promise<string | null>;
  onSave: (vendorId: string, notes: string) => void;
  vendor: VendorRecord;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(vendor.notes);

  useEffect(() => {
    if (!isEditing) {
      setDraft(vendor.notes);
    }
  }, [isEditing, vendor.notes]);

  function openEditor() {
    setDraft(vendor.notes);
    setIsEditing(true);
  }

  function saveNotes() {
    onSave(vendor.id, draft.trim());
    setIsEditing(false);
  }

  function cancelNotes() {
    setDraft(vendor.notes);
    setIsEditing(false);
  }

  async function handleInlineAiHelp() {
    const suggestion = await onAiHelp(vendor, draft);

    if (suggestion) {
      setDraft(suggestion);
    }
  }

  if (isEditing) {
    return (
      <div className="vendor-notes-cell vendor-note-editor">
        <textarea className="input" value={draft} onChange={(event) => setDraft(event.target.value)} />
        <div className="vendor-note-actions">
          <button
            className="vendor-ai-help-button vendor-ai-help-inline-button"
            type="button"
            title="AI Help reviews the vendor website/name and suggests what this supplier is used for."
            onClick={() => void handleInlineAiHelp()}
          >
            AI Suggest
          </button>
          <button
            className="vendor-ai-help-button vendor-ai-grammar-button"
            type="button"
            title="Basic cleanup for spacing, punctuation, and common maintenance typos."
            onClick={() => setDraft(cleanMaintenanceNote(draft))}
            disabled={!draft.trim()}
          >
            Clean Note
          </button>
          <button className="vendor-note-button" type="button" onClick={saveNotes}>
            Save
          </button>
          <button className="vendor-note-button" type="button" onClick={cancelNotes}>
            Cancel
          </button>
        </div>
        <p className="vendor-note-helper">Clean Note is basic local cleanup. AI Suggest builds the vendor purpose note.</p>
      </div>
    );
  }

  return (
    <div className="vendor-notes-cell">
      <button
        className={`vendor-note-button vendor-note-display-button ${isRecentlySaved ? "vendor-note-saved-flash" : ""}`}
        type="button"
        title="Click to edit note"
        onClick={openEditor}
      >
        <span className="vendor-note-text">{vendor.notes || "-"}</span>
      </button>
    </div>
  );
}

function ReorderPage({
  data,
  items,
  onDataChange,
  onStockAction
}: {
  data: AppData;
  items: InventoryItem[];
  onDataChange: (updater: (current: AppData) => AppData) => void;
  onStockAction: (itemId: string, actionType?: StockActionType | "") => void;
}) {
  const [reorderView, setReorderView] = useState<"items" | "forms" | "made">("items");
  const [selectedReorderItemIds, setSelectedReorderItemIds] = useState<string[]>([]);
  const [requisitionLines, setRequisitionLines] = useState<Record<string, RequisitionLineDraft>>({});
  const [requisitionHeaders, setRequisitionHeaders] = useState<Record<string, RequisitionHeaderDraft>>({});
  const [activeRequisitionGroupIndex, setActiveRequisitionGroupIndex] = useState(0);
  const [completedRequisitionVendorKeys, setCompletedRequisitionVendorKeys] = useState<string[]>([]);
  const [pendingReviewVendorKey, setPendingReviewVendorKey] = useState<string | null>(null);
  const [pendingReviewPdfGeneratedAt, setPendingReviewPdfGeneratedAt] = useState("");
  const [reorderWarning, setReorderWarning] = useState("");

  const activeMadeRecords = useMemo(() => pruneRequisitionMadeRecords(data).requisitionMadeRecords, [data]);
  const activeRequisitionMadeItemIds = useMemo(() => getActiveRequisitionMadeItemIds(data), [data]);
  const selectedItemIdSet = useMemo(() => new Set(selectedReorderItemIds), [selectedReorderItemIds]);
  const selectedItems = useMemo(
    () => items.filter((item) => selectedItemIdSet.has(item.id) && !activeRequisitionMadeItemIds.has(item.id)),
    [activeRequisitionMadeItemIds, items, selectedItemIdSet]
  );
  const vendorGroups = useMemo(() => groupItemsByVendor(data, selectedItems), [data, selectedItems]);
  const activeVendorGroup = vendorGroups[activeRequisitionGroupIndex];
  const activeRequisitionHeader = activeVendorGroup
    ? (requisitionHeaders[activeVendorGroup.vendorKey] ?? createDefaultRequisitionHeader(activeVendorGroup.vendor))
    : null;
  const activeVendorGroupCompleted = activeVendorGroup ? completedRequisitionVendorKeys.includes(activeVendorGroup.vendorKey) : false;
  const allSelectedVendorFormsReviewed =
    vendorGroups.length > 0 && vendorGroups.every((group) => completedRequisitionVendorKeys.includes(group.vendorKey));
  const pendingReviewVendorGroup = pendingReviewVendorKey
    ? vendorGroups.find((group) => group.vendorKey === pendingReviewVendorKey)
    : null;
  const madeRows = useMemo(
    () =>
      activeMadeRecords.flatMap((record) =>
        record.itemSnapshots.map((snapshot) => ({
          record,
          snapshot
        }))
      ),
    [activeMadeRecords]
  );

  useEffect(() => {
    const reorderItemIds = new Set(items.filter((item) => !activeRequisitionMadeItemIds.has(item.id)).map((item) => item.id));
    setSelectedReorderItemIds((current) => current.filter((itemId) => reorderItemIds.has(itemId)));
  }, [activeRequisitionMadeItemIds, items]);

  useEffect(() => {
    const selectedIds = new Set(selectedReorderItemIds);
    const itemLookup = new Map(items.map((item) => [item.id, item]));

    setRequisitionLines((current) => {
      let changed = false;
      const next = { ...current };

      selectedReorderItemIds.forEach((itemId) => {
        const item = itemLookup.get(itemId);

        if (item && !next[itemId]) {
          next[itemId] = createRequisitionLineDraft(item);
          changed = true;
        }
      });

      Object.keys(next).forEach((itemId) => {
        if (!selectedIds.has(itemId)) {
          delete next[itemId];
          changed = true;
        }
      });

      return changed ? next : current;
    });
  }, [items, selectedReorderItemIds]);

  useEffect(() => {
    setActiveRequisitionGroupIndex((current) => {
      if (vendorGroups.length === 0) {
        return 0;
      }

      return Math.min(current, vendorGroups.length - 1);
    });
  }, [vendorGroups.length]);

  useEffect(() => {
    const vendorKeys = new Set(vendorGroups.map((group) => group.vendorKey));
    setCompletedRequisitionVendorKeys((current) => {
      const next = current.filter((vendorKey) => vendorKeys.has(vendorKey));
      return next.length === current.length ? current : next;
    });
  }, [vendorGroups]);

  useEffect(() => {
    const vendorKeys = new Set(vendorGroups.map((group) => group.vendorKey));

    setRequisitionHeaders((current) => {
      let changed = false;
      const next = { ...current };

      vendorGroups.forEach((group) => {
        if (!next[group.vendorKey]) {
          next[group.vendorKey] = createDefaultRequisitionHeader(group.vendor);
          changed = true;
        }
      });

      Object.keys(next).forEach((vendorKey) => {
        if (!vendorKeys.has(vendorKey)) {
          delete next[vendorKey];
          changed = true;
        }
      });

      return changed ? next : current;
    });
  }, [vendorGroups]);

  function toggleReorderItemSelection(itemId: string) {
    if (activeRequisitionMadeItemIds.has(itemId)) {
      setReorderWarning("This item already has a requisition made.");
      return;
    }

    setReorderWarning("");
    setSelectedReorderItemIds((current) =>
      current.includes(itemId) ? current.filter((selectedId) => selectedId !== itemId) : [...current, itemId]
    );
  }

  function selectAllReorderItems() {
    const selectableItemIds = items.filter((item) => !activeRequisitionMadeItemIds.has(item.id)).map((item) => item.id);

    setSelectedReorderItemIds(selectableItemIds);
    setReorderWarning(selectableItemIds.length === 0 && items.length > 0 ? "All reorder items already have requisitions made." : "");
  }

  function clearSelectedReorderItems() {
    setSelectedReorderItemIds([]);
    setReorderWarning("");
  }

  function createRequisitionForms() {
    if (selectedReorderItemIds.length === 0) {
      return;
    }

    const selectableItemIds = selectedReorderItemIds.filter((itemId) => !activeRequisitionMadeItemIds.has(itemId));

    if (selectableItemIds.length === 0) {
      setReorderWarning("Selected items already have requisitions made.");
      return;
    }

    if (selectableItemIds.length !== selectedReorderItemIds.length) {
      setSelectedReorderItemIds(selectableItemIds);
      setReorderWarning("Items with requisitions already made were left out.");
    } else {
      setReorderWarning("");
    }

    setReorderView("forms");
  }

  function updateRequisitionLine(itemId: string, patch: Partial<RequisitionLineDraft>) {
    const item = items.find((candidate) => candidate.id === itemId);

    if (!item) {
      return;
    }

    setRequisitionLines((current) => ({
      ...current,
      [itemId]: {
        ...(current[itemId] ?? createRequisitionLineDraft(item)),
        ...patch,
        itemId
      }
    }));
  }

  function updateRequisitionHeader(vendorKey: string, updater: SetStateAction<RequisitionHeaderDraft>) {
    const group = vendorGroups.find((candidate) => candidate.vendorKey === vendorKey);

    if (!group) {
      return;
    }

    setRequisitionHeaders((current) => {
      const currentHeader = current[vendorKey] ?? createDefaultRequisitionHeader(group.vendor);
      const nextHeader = typeof updater === "function" ? updater(currentHeader) : updater;

      return {
        ...current,
        [vendorKey]: nextHeader
      };
    });
  }

  function skipActiveVendor() {
    const activeGroup = vendorGroups[activeRequisitionGroupIndex];

    if (!activeGroup) {
      return;
    }

    if (activeRequisitionGroupIndex < vendorGroups.length - 1) {
      setActiveRequisitionGroupIndex((current) => current + 1);
      return;
    }

    setReorderView("items");
  }

  function passRequisitionForVendor(vendorKey: string) {
    const group = vendorGroups.find((candidate) => candidate.vendorKey === vendorKey);
    const header = group ? (requisitionHeaders[vendorKey] ?? createDefaultRequisitionHeader(group.vendor)) : null;

    if (!group || !header) {
      setPendingReviewVendorKey(null);
      setPendingReviewPdfGeneratedAt("");
      return;
    }

    const record = createRequisitionMadeRecord({
      group,
      header,
      lineDrafts: requisitionLines,
      pdfGeneratedAt: pendingReviewVendorKey === vendorKey ? pendingReviewPdfGeneratedAt : undefined
    });
    const passedItemIds = new Set(record.itemIds);
    const currentIndex = vendorGroups.findIndex((candidate) => candidate.vendorKey === vendorKey);
    const hasNextVendor = currentIndex >= 0 && currentIndex < vendorGroups.length - 1;

    onDataChange((current) =>
      pruneRequisitionMadeRecords({
        ...current,
        requisitionMadeRecords: [
          record,
          ...current.requisitionMadeRecords.filter((existingRecord) =>
            existingRecord.itemIds.every((itemId) => !passedItemIds.has(itemId))
          )
        ]
      })
    );

    setCompletedRequisitionVendorKeys((current) =>
      current.includes(group.vendorKey) ? current : [...current, group.vendorKey]
    );
    setPendingReviewVendorKey(null);
    setPendingReviewPdfGeneratedAt("");
    setSelectedReorderItemIds((current) => current.filter((itemId) => !passedItemIds.has(itemId)));

    if (hasNextVendor) {
      setActiveRequisitionGroupIndex(currentIndex);
      setReorderView("forms");
      return;
    }

    setActiveRequisitionGroupIndex(0);
    setReorderView("items");
    clearSelectedReorderItems();
  }

  return (
    <section className="panel reorder-panel">
      <div className="reorder-screen-header no-requisition-print">
        <SectionHeader kicker="Minimum stock" title="Reorder List" />
        <div className="reorder-page-tabs">
          <button
            className={`reorder-tab-button ${reorderView === "items" ? "reorder-tab-active" : ""}`}
            type="button"
            aria-pressed={reorderView === "items"}
            onClick={() => setReorderView("items")}
          >
            Reorder Items
          </button>
          <button
            className={`reorder-tab-button ${reorderView === "forms" ? "reorder-tab-active" : ""}`}
            type="button"
            aria-pressed={reorderView === "forms"}
            onClick={() => setReorderView("forms")}
          >
            Requisition Forms
          </button>
          <button
            className={`reorder-tab-button ${reorderView === "made" ? "reorder-tab-active" : ""}`}
            type="button"
            aria-pressed={reorderView === "made"}
            onClick={() => setReorderView("made")}
          >
            Requisition Made
          </button>
        </div>
        {reorderView !== "made" && (
          <div className="reorder-selection-toolbar no-print">
            <span>{selectedReorderItemIds.length} selected</span>
            <button className="btn-small" type="button" onClick={selectAllReorderItems} disabled={items.length === 0}>
              Select All Reorder Items
            </button>
            <button className="btn-small" type="button" onClick={clearSelectedReorderItems} disabled={selectedReorderItemIds.length === 0}>
              Clear Selected
            </button>
            <button
              className="btn-primary reorder-create-button"
              type="button"
              onClick={createRequisitionForms}
              disabled={selectedReorderItemIds.length === 0}
            >
              Create Requisition Forms
            </button>
          </div>
        )}
        {reorderView === "forms" && (
          <div className="requisition-auto-type-strip">Form type is selected automatically by vendor total.</div>
        )}
        {reorderWarning && <div className="warning-bar">{reorderWarning}</div>}
      </div>

      {reorderView === "items" && (
        <SimpleTable
          emptyText="No low or out of stock items."
          headers={[
            "Select",
            "Status",
            "Requisition",
            "Item",
            "Part number",
            "On hand",
            "Minimum",
            "Location",
            "Vendor",
            "Unit Cost",
            "Actions"
          ]}
          rowKeys={items.map((item) => item.id)}
          rows={items.map((item) => {
            const hasRequisitionMade = activeRequisitionMadeItemIds.has(item.id);

            return [
              <label
                key="select"
                className="reorder-select-cell"
                title={hasRequisitionMade ? "This item already has a requisition made." : undefined}
                onClick={(event) => {
                  if (hasRequisitionMade) {
                    event.preventDefault();
                    setReorderWarning("This item already has a requisition made.");
                  }
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedItemIdSet.has(item.id)}
                  disabled={hasRequisitionMade}
                  aria-label={`Select ${item.name} for requisition`}
                  onChange={() => toggleReorderItemSelection(item.id)}
                />
              </label>,
              <StatusTag key="status" status={getInventoryStatus(item, data.settings)} />,
              hasRequisitionMade ? (
                <span key="made" className="requisition-made-badge requisition-made-badge-green">
                  Requisition Made
                </span>
              ) : (
                "-"
              ),
              item.name,
              item.partNumber || "-",
              formatStockQuantity(item),
              formatNumber(item.minimumStockLevel),
              getLocationName(data, item.locationId),
              getVendorName(data, item.vendorId),
              formatCurrency(item.costEach),
              <button key="stock" className="btn-small" type="button" onClick={() => onStockAction(item.id)}>
                Stock Edit
              </button>
            ];
          })}
        />
      )}

      {reorderView === "made" && (
        <SimpleTable
          emptyText="No active requisitions have been marked made."
          headers={[
            "Status",
            "Vendor",
            "Item / Part Number",
            "Qty Requested",
            "Unit Cost",
            "Total Cost",
            "PDF Generated",
            "Passed Date",
            "Actions"
          ]}
          rowKeys={madeRows.map(({ record, snapshot }) => `${record.id}-${snapshot.itemId}`)}
          rows={madeRows.map(({ record, snapshot }) => [
            <span key="status" className="requisition-made-badge requisition-made-badge-green">
              Requisition Made
            </span>,
            record.vendorName,
            <span key="item" className="requisition-made-item">
              <strong>{snapshot.itemName}</strong>
              <span>{snapshot.partNumber || "-"}</span>
            </span>,
            formatNumber(snapshot.quantityRequested),
            formatCurrency(snapshot.unitCost),
            formatCurrency(snapshot.totalCost),
            formatDateTime(record.pdfGeneratedAt),
            formatDateTime(record.passedAt),
            <button key="stock" className="btn-small" type="button" onClick={() => onStockAction(snapshot.itemId)}>
              Stock Edit
            </button>
          ])}
        />
      )}

      {reorderView === "forms" && (
        <div className="requisition-builder">
          {selectedItems.length === 0 ? (
            <div className="warning-bar">Select reorder items first, then create requisition forms.</div>
          ) : activeVendorGroup && activeRequisitionHeader ? (
            <>
              <div className="requisition-workflow-toolbar no-requisition-print">
                <div className="requisition-workflow-info">
                  <span>
                    Form {activeRequisitionGroupIndex + 1} of {vendorGroups.length}
                  </span>
                  <strong>{activeVendorGroup.vendorName}</strong>
                  {allSelectedVendorFormsReviewed && <em>All selected vendor forms reviewed.</em>}
                </div>
                <div className="requisition-workflow-actions">
                  <button
                    className="btn-muted"
                    type="button"
                    onClick={() => setActiveRequisitionGroupIndex((current) => Math.max(0, current - 1))}
                    disabled={activeRequisitionGroupIndex === 0}
                  >
                    Previous Vendor
                  </button>
                  <button
                    className="btn-muted"
                    type="button"
                    onClick={() => setActiveRequisitionGroupIndex((current) => Math.min(vendorGroups.length - 1, current + 1))}
                    disabled={activeRequisitionGroupIndex >= vendorGroups.length - 1}
                  >
                    Next Vendor
                  </button>
                  <button className="btn-muted" type="button" onClick={skipActiveVendor}>
                    Skip Vendor
                  </button>
                  {activeVendorGroupCompleted && <span className="requisition-done-badge">Reviewed / Done</span>}
                </div>
              </div>
              <RequisitionFormPreview
                key={activeVendorGroup.vendorKey}
                group={activeVendorGroup}
                header={activeRequisitionHeader}
                isCompleted={activeVendorGroupCompleted}
                lineDrafts={requisitionLines}
                onHeaderChange={(updater) => updateRequisitionHeader(activeVendorGroup.vendorKey, updater)}
                onOfficialPdfGenerated={() => {
                  setPendingReviewPdfGeneratedAt(nowIso());
                  setPendingReviewVendorKey(activeVendorGroup.vendorKey);
                }}
                onLineChange={updateRequisitionLine}
              />
            </>
          ) : (
            <div className="warning-bar">Select reorder items first, then create requisition forms.</div>
          )}
        </div>
      )}

      {pendingReviewVendorKey && (
        <div className="review-modal-backdrop">
          <section className="review-modal" role="dialog" aria-modal="true" aria-labelledby="review-official-pdf-title">
            <div>
              <p className="eyebrow">Official requisition</p>
              <h3 id="review-official-pdf-title">Review Official PDF</h3>
            </div>
            <p>
              Open the generated PDF and review it. If it looks good, click Pass. If it needs changes, click Needs Fix and edit the form.
            </p>
            {pendingReviewVendorGroup && (
              <div className="review-modal-summary">
                <span>{pendingReviewVendorGroup.vendorName}</span>
                <strong>{pendingReviewVendorGroup.items.length} line item{pendingReviewVendorGroup.items.length === 1 ? "" : "s"}</strong>
              </div>
            )}
            <div className="review-modal-actions">
              <button
                className="btn-muted"
                type="button"
                onClick={() => {
                  setPendingReviewVendorKey(null);
                  setPendingReviewPdfGeneratedAt("");
                }}
              >
                Needs Fix
              </button>
              <button
                className="btn-primary review-pass-button"
                type="button"
                onClick={() => passRequisitionForVendor(pendingReviewVendorKey)}
              >
                Pass
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

function getRecommendedReorderQuantity(item: InventoryItem) {
  return Math.max(1, item.minimumStockLevel - item.quantityOnHand);
}

function createRequisitionLineDraft(item: InventoryItem): RequisitionLineDraft {
  return {
    dueDate: toDateInput(),
    itemId: item.id,
    quantity: String(getRecommendedReorderQuantity(item))
  };
}

function groupItemsByVendor(data: AppData, selectedItems: InventoryItem[]): RequisitionVendorGroup[] {
  const groups = new Map<string, InventoryItem[]>();

  selectedItems.forEach((item) => {
    const vendorName = item.vendorId ? getVendorName(data, item.vendorId) : "Unassigned Vendor";
    const key = item.vendorId || `unassigned-${vendorName}`;

    groups.set(key, [...(groups.get(key) ?? []), item]);
  });

  return Array.from(groups.entries()).map(([vendorKey, groupItems]) => {
    const vendorId = groupItems[0]?.vendorId || "";
    const vendor = data.vendors.find((candidate) => candidate.id === vendorId);

    return {
      vendorKey,
      vendor,
      vendorName: vendor?.name || "Unassigned Vendor",
      items: groupItems
    };
  });
}

function getVendorRequisitionDetails(vendor?: VendorRecord) {
  if (!vendor) {
    return "";
  }

  const details = [
    vendor.phone ? `Phone: ${vendor.phone}` : "",
    vendor.email ? `Email: ${vendor.email}` : "",
    vendor.website ? `Website: ${vendor.website}` : ""
  ].filter(Boolean);

  return details.join("\n");
}

function createDefaultRequisitionHeader(vendor?: VendorRecord): RequisitionHeaderDraft {
  return {
    assetNo: "",
    authorizedBy: "",
    codeNo: "",
    comments: "Maintenance inventory restock.",
    confirmedWith: vendor?.contactName || "",
    departmentManager: "",
    equipmentNo: "",
    fob: "",
    initials: "",
    jobNo: "",
    materialCert: "No",
    moldNo: "",
    partNo: "",
    poClass: "",
    poInitiator: "",
    poNo: "",
    priority: "Low",
    reqDate: toDateInput(),
    requisitionedBy: "",
    shipVia: "",
    taxExempt: "No",
    tsNo: "",
    vendorAddress: getVendorRequisitionDetails(vendor),
    vendorName: vendor?.name || "",
    workOrderNo: ""
  };
}

function getRequisitionLineQuantity(item: InventoryItem, lineDrafts: Record<string, RequisitionLineDraft>) {
  const value = lineDrafts[item.id]?.quantity;

  if (value === undefined || value.trim() === "") {
    return getRecommendedReorderQuantity(item);
  }

  const parsed = wholeNumberValue(value, Number.NaN);

  return Number.isFinite(parsed) ? Math.max(0, parsed) : getRecommendedReorderQuantity(item);
}

function getRequisitionTotal(items: InventoryItem[], lineDrafts: Record<string, RequisitionLineDraft>) {
  return items.reduce((total, item) => total + getRequisitionLineQuantity(item, lineDrafts) * item.costEach, 0);
}

function getAutoRequisitionType(total: number): "under100" | "over100" {
  return total <= 100 ? "under100" : "over100";
}

function getActiveRequisitionMadeItemIds(data: AppData) {
  return new Set(pruneRequisitionMadeRecords(data).requisitionMadeRecords.flatMap((record) => record.itemIds));
}

function createRequisitionMadeRecord({
  group,
  header,
  lineDrafts,
  pdfGeneratedAt
}: {
  group: RequisitionVendorGroup;
  header: RequisitionHeaderDraft;
  lineDrafts: Record<string, RequisitionLineDraft>;
  pdfGeneratedAt?: string;
}): RequisitionMadeRecord {
  const itemSnapshots = group.items.map((item) => {
    const quantityRequested = getRequisitionLineQuantity(item, lineDrafts);
    const unitCost = Number.isFinite(item.costEach) ? item.costEach : 0;

    return {
      itemId: item.id,
      itemName: item.name,
      partNumber: item.partNumber,
      quantityRequested,
      unitCost,
      totalCost: quantityRequested * unitCost
    };
  });
  const totalCost = itemSnapshots.reduce((sum, snapshot) => sum + snapshot.totalCost, 0);
  const passedAt = nowIso();

  return {
    id: createId(),
    vendorKey: group.vendorKey,
    vendorName: header.vendorName || group.vendorName,
    itemIds: itemSnapshots.map((snapshot) => snapshot.itemId),
    itemSnapshots,
    totalCost,
    requisitionType: getAutoRequisitionType(totalCost),
    pdfGeneratedAt: pdfGeneratedAt || passedAt,
    passedAt,
    status: "Made"
  };
}

function getRequisitionTitleFromTotal(total: number) {
  return getAutoRequisitionType(total) === "under100"
    ? "PURCHASE ORDER REQUISITION Under $100.00"
    : "PURCHASE ORDER REQUISITION";
}

function formatDateInputForDisplay(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value || "-" : date.toLocaleDateString();
}

function buildRequisitionFormText({
  group,
  header,
  lineDrafts
}: {
  group: RequisitionVendorGroup;
  header: RequisitionHeaderDraft;
  lineDrafts: Record<string, RequisitionLineDraft>;
}) {
  const title = getRequisitionTitleFromTotal(getRequisitionTotal(group.items, lineDrafts));
  const lines = group.items.map((item, index) => {
    const quantity = getRequisitionLineQuantity(item, lineDrafts);
    const itemNumber = item.partNumber || item.name;
    const description = item.description || item.name;
    const total = quantity * item.costEach;

    return `${index + 1}. ${quantity} ${normalizeStockUnit(item.stockUnit)} ${itemNumber} - ${description} - ${formatCurrency(
      item.costEach
    )} each - Total ${formatCurrency(total)}`;
  });

  return [
    title,
    `Vendor: ${header.vendorName || group.vendorName}`,
    `Priority: ${header.priority}`,
    `Req Date: ${formatDateInputForDisplay(header.reqDate)}`,
    `Confirmed With: ${header.confirmedWith || "-"}`,
    `Comments: ${header.comments || "-"}`,
    "",
    "Items:",
    ...lines,
    "",
    `Grand Total: ${formatCurrency(getRequisitionTotal(group.items, lineDrafts))}`
  ].join("\n");
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error) ?? "Official PDF could not be generated.";
  } catch {
    return "Official PDF could not be generated.";
  }
}

function isPossiblePdfEngineSetupError(message: string) {
  return (
    /excel|libreoffice|soffice/i.test(message) &&
    /not found|requires|system cannot find|com class factory|activex component|new-object/i.test(message)
  );
}

function RequisitionFormPreview({
  group,
  header,
  isCompleted,
  lineDrafts,
  onHeaderChange,
  onOfficialPdfGenerated,
  onLineChange
}: {
  group: RequisitionVendorGroup;
  header: RequisitionHeaderDraft;
  isCompleted: boolean;
  lineDrafts: Record<string, RequisitionLineDraft>;
  onHeaderChange: (updater: SetStateAction<RequisitionHeaderDraft>) => void;
  onOfficialPdfGenerated: () => void;
  onLineChange: (itemId: string, patch: Partial<RequisitionLineDraft>) => void;
}) {
  const [copyStatus, setCopyStatus] = useState("");
  const [copyStatusType, setCopyStatusType] = useState<"idle" | "success" | "error" | "working">("idle");
  const [isGeneratingOfficialPdf, setIsGeneratingOfficialPdf] = useState(false);
  const [pdfEngineStatus, setPdfEngineStatus] = useState<PdfEngineStatus | null>(null);
  const total = getRequisitionTotal(group.items, lineDrafts);
  const requisitionType = getAutoRequisitionType(total);
  const title = getRequisitionTitleFromTotal(total);
  const autoStatus =
    requisitionType === "under100" ? "Auto selected: Under $100 form" : "Auto selected: Over $100 form";
  const showPdfSetupWarning =
    pdfEngineStatus !== null && !pdfEngineStatus.ready && pdfEngineStatus.preferredEngine !== "Desktop app required";

  useEffect(() => {
    let cancelled = false;

    checkPdfExportEngines()
      .then((status) => {
        if (!cancelled) {
          setPdfEngineStatus(status);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPdfEngineStatus(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function updateHeader<K extends keyof RequisitionHeaderDraft>(field: K, value: RequisitionHeaderDraft[K]) {
    onHeaderChange((current) => ({ ...current, [field]: value }));
  }

  function updatePriority(priority: "Low" | "High") {
    onHeaderChange((current) => {
      const defaultComment = "Maintenance inventory restock.";
      const shouldAdjustComment =
        current.comments.trim() === defaultComment ||
        current.comments.trim() === "High priority maintenance inventory restock." ||
        current.comments.trim() === "Low priority maintenance inventory restock.";

      return {
        ...current,
        priority,
        comments: shouldAdjustComment
          ? priority === "High"
            ? "High priority maintenance inventory restock."
            : "Low priority maintenance inventory restock."
          : current.comments
      };
    });
  }

  function clearStatusAfterDelay() {
    window.setTimeout(() => {
      setCopyStatus("");
      setCopyStatusType("idle");
    }, 2500);
  }

  async function copyFormText() {
    const text = buildRequisitionFormText({ group, header, lineDrafts });

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      setCopyStatus("Copied form text.");
      setCopyStatusType("success");
      clearStatusAfterDelay();
      return;
    }

    window.prompt("Copy requisition text", text);
  }

  async function handleGenerateOfficialPdf() {
    if (isGeneratingOfficialPdf) {
      return;
    }

    try {
      setIsGeneratingOfficialPdf(true);
      const engineStatus = await checkPdfExportEngines();
      setPdfEngineStatus(engineStatus);

      if (!engineStatus.ready && engineStatus.preferredEngine !== "Desktop app required") {
        setCopyStatus("PDF export setup needed. Install LibreOffice from Settings > PDF Export Setup.");
        setCopyStatusType("error");
        return;
      }

      setCopyStatus("Building official requisition PDF. Large requisitions may take a little longer...");
      setCopyStatusType("working");

      const { generateOfficialPdfFromExcelTemplate } = await import("./lib/requisitionOfficialPdf");

      await generateOfficialPdfFromExcelTemplate({
        group,
        header,
        lineDrafts,
        requisitionType
      });

      setCopyStatus("Official PDF generated.");
      setCopyStatusType("success");
      onOfficialPdfGenerated();
      clearStatusAfterDelay();
    } catch (error) {
      console.error("Official PDF generation failed:", error);
      const errorMessage = getErrorMessage(error);

      if (isPossiblePdfEngineSetupError(errorMessage)) {
        try {
          const engineStatus = await checkPdfExportEngines();
          setPdfEngineStatus(engineStatus);

          if (!engineStatus.ready && engineStatus.preferredEngine !== "Desktop app required") {
            setCopyStatus("PDF export setup needed. Install LibreOffice from Settings > PDF Export Setup.");
            setCopyStatusType("error");
            return;
          }
        } catch {}
      }

      setCopyStatus(errorMessage);
      setCopyStatusType("error");
    } finally {
      setIsGeneratingOfficialPdf(false);
    }
  }

  return (
    <section className="requisition-form-card requisition-print-card">
      <div className="requisition-form-header">
        <div>
          <p className="eyebrow">{group.vendorName}</p>
          <h3>{title}</h3>
          <span>{group.items.length} line item{group.items.length === 1 ? "" : "s"}</span>
          <span className="requisition-auto-type-badge">{autoStatus}</span>
          {isCompleted && <span className="requisition-done-badge">Reviewed / Done</span>}
        </div>
        <div className="requisition-total-bar requisition-valid">
          <span>Grand Total</span>
          <strong>{formatCurrency(total)}</strong>
        </div>
      </div>

      {showPdfSetupWarning && (
        <div className="warning-bar">
          Official PDF export needs Microsoft Excel or LibreOffice. Go to Settings &gt; PDF Export Setup.
        </div>
      )}

      <div className="requisition-form-grid">
        <label className="field-label">
          P.O. No.
          <input className="input" value={header.poNo} onChange={(event) => updateHeader("poNo", event.target.value)} />
        </label>
        <label className="field-label">
          P.O. Initiator
          <input className="input" value={header.poInitiator} onChange={(event) => updateHeader("poInitiator", event.target.value)} />
        </label>
        <label className="field-label">
          Ship Via
          <input className="input" value={header.shipVia} onChange={(event) => updateHeader("shipVia", event.target.value)} />
        </label>
        <label className="field-label">
          P.O. Class
          <input className="input" value={header.poClass} onChange={(event) => updateHeader("poClass", event.target.value)} />
        </label>
        <label className="field-label">
          Tax Exempt?
          <select className="input" value={header.taxExempt} onChange={(event) => updateHeader("taxExempt", event.target.value as "Yes" | "No")}>
            <option>Yes</option>
            <option>No</option>
          </select>
        </label>
        <label className="field-label">
          F.O.B.
          <select className="input" value={header.fob} onChange={(event) => updateHeader("fob", event.target.value)}>
            <option value="">Blank</option>
            <option value="Origin">Origin</option>
            <option value="Destination">Destination</option>
          </select>
        </label>
        <label className="field-label">
          Req. Date
          <input className="input" type="date" value={header.reqDate} onChange={(event) => updateHeader("reqDate", event.target.value)} />
        </label>
        <label className="field-label">
          Material Cert?
          <select
            className="input"
            value={header.materialCert}
            onChange={(event) => updateHeader("materialCert", event.target.value as "Yes" | "No")}
          >
            <option>Yes</option>
            <option>No</option>
          </select>
        </label>
      </div>

      <div className="requisition-tooling-section">
        <span>Tooling Orders ONLY</span>
        <div className="requisition-form-grid">
          <label className="field-label">
            Asset No.
            <input className="input" value={header.assetNo} onChange={(event) => updateHeader("assetNo", event.target.value)} />
          </label>
          <label className="field-label">
            Mold No.
            <input className="input" value={header.moldNo} onChange={(event) => updateHeader("moldNo", event.target.value)} />
          </label>
          <label className="field-label">
            Equipment No.
            <input className="input" value={header.equipmentNo} onChange={(event) => updateHeader("equipmentNo", event.target.value)} />
          </label>
          <label className="field-label">
            Part No.
            <input className="input" value={header.partNo} onChange={(event) => updateHeader("partNo", event.target.value)} />
          </label>
          <label className="field-label">
            Job No.
            <input className="input" value={header.jobNo} onChange={(event) => updateHeader("jobNo", event.target.value)} />
          </label>
          <label className="field-label">
            Initials
            <input className="input" value={header.initials} onChange={(event) => updateHeader("initials", event.target.value)} />
          </label>
          <label className="field-label">
            T/S No.
            <input className="input" value={header.tsNo} onChange={(event) => updateHeader("tsNo", event.target.value)} />
          </label>
          <label className="field-label">
            Code No.
            <input className="input" value={header.codeNo} onChange={(event) => updateHeader("codeNo", event.target.value)} />
          </label>
          <label className="field-label">
            Work Order No.
            <input className="input" value={header.workOrderNo} onChange={(event) => updateHeader("workOrderNo", event.target.value)} />
          </label>
        </div>
      </div>

      <div className="requisition-vendor-section">
        <label className="field-label">
          Vendor Name
          <input className="input" value={header.vendorName} onChange={(event) => updateHeader("vendorName", event.target.value)} />
        </label>
        <label className="field-label">
          Vendor Address / Phone
          <textarea className="input min-h-24" value={header.vendorAddress} onChange={(event) => updateHeader("vendorAddress", event.target.value)} />
        </label>
        <label className="field-label">
          Confirmed With
          <input className="input" value={header.confirmedWith} onChange={(event) => updateHeader("confirmedWith", event.target.value)} />
        </label>
      </div>

      <div className="table-wrap requisition-line-table">
        <table className="data-table">
          <thead>
            <tr>
              <th>Quantity</th>
              <th>Unit of Measure</th>
              <th>Item Number</th>
              <th>Item Description / Revision</th>
              <th>Due Date</th>
              <th>Unit Price</th>
              <th>Total Price</th>
            </tr>
          </thead>
          <tbody>
            {group.items.map((item) => {
              const draft = lineDrafts[item.id] ?? createRequisitionLineDraft(item);
              const quantity = getRequisitionLineQuantity(item, lineDrafts);

              return (
                <tr key={item.id}>
                  <td>
                    <input
                      className="input requisition-line-input"
                      value={draft.quantity}
                      inputMode="numeric"
                      onChange={(event) => onLineChange(item.id, { quantity: normalizeWholeNumberInput(event.target.value) })}
                    />
                  </td>
                  <td>{normalizeStockUnit(item.stockUnit)}</td>
                  <td>{item.partNumber || item.name}</td>
                  <td>{item.description || item.name}</td>
                  <td>
                    <input
                      className="input requisition-date-input"
                      type="date"
                      value={draft.dueDate}
                      onChange={(event) => onLineChange(item.id, { dueDate: event.target.value })}
                    />
                  </td>
                  <td>{formatCurrency(item.costEach)}</td>
                  <td>{formatCurrency(quantity * item.costEach)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="requisition-bottom-grid">
        <label className="field-label requisition-comments">
          Comments
          <textarea className="input min-h-24" value={header.comments} onChange={(event) => updateHeader("comments", event.target.value)} />
        </label>
        <label className="field-label">
          Priority
          <div className="requisition-priority-toggle">
            <label>
              <input type="radio" checked={header.priority === "Low"} onChange={() => updatePriority("Low")} />
              Low Priority
            </label>
            <label>
              <input type="radio" checked={header.priority === "High"} onChange={() => updatePriority("High")} />
              High Priority
            </label>
          </div>
        </label>
        <label className="field-label">
          Department Manager
          <input className="input" value={header.departmentManager} onChange={(event) => updateHeader("departmentManager", event.target.value)} />
        </label>
        <label className="field-label">
          Requisitioned By
          <input className="input" value={header.requisitionedBy} onChange={(event) => updateHeader("requisitionedBy", event.target.value)} />
        </label>
        <label className="field-label">
          Authorized By
          <input className="input" value={header.authorizedBy} onChange={(event) => updateHeader("authorizedBy", event.target.value)} />
        </label>
      </div>

      <div className="requisition-actions">
        <button
          className="btn-primary reorder-create-button"
          type="button"
          disabled={isGeneratingOfficialPdf}
          onClick={() => void handleGenerateOfficialPdf()}
        >
          {isGeneratingOfficialPdf ? "Generating PDF..." : "Generate Official PDF"}
        </button>
        <button className="btn-muted" type="button" onClick={() => void copyFormText()}>
          Copy Form Text
        </button>
        {copyStatus && (
          <span className={`requisition-status-message requisition-status-${copyStatusType}`}>
            {copyStatus}
          </span>
        )}
      </div>
    </section>
  );
}

function getStockMovement(change: StockChange) {
  const delta = change.newQuantity - change.previousQuantity;

  if (delta === 0) {
    return "0";
  }

  const sign = delta > 0 ? "+" : "-";

  return `${sign}${formatNumber(Math.abs(delta))}`;
}

function StockMovementBadge({ change }: { change: StockChange }) {
  const delta = change.newQuantity - change.previousQuantity;
  const toneClass = delta === 0 ? "stock-movement-neutral" : delta > 0 ? "stock-movement-in" : "stock-movement-out";

  return (
    <span className={`stock-movement-badge ${toneClass}`}>
      {getStockMovement(change)}
    </span>
  );
}

function StockBeforeAfter({
  after,
  before
}: {
  after: number;
  before: number;
}) {
  const toneClass = after === before ? "stock-before-after-neutral" : after > before ? "stock-before-after-in" : "stock-before-after-out";

  return (
    <span className={`stock-before-after ${toneClass}`}>
      <span>{formatNumber(before)}</span>
      <span className="stock-before-after-arrow">â†’</span>
      <span>{formatNumber(after)}</span>
    </span>
  );
}

function HistoryPage({ data }: { data: AppData }) {
  const stockRows = data.stockChanges.slice().sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

  return (
    <section className="space-y-5">
      <section className="panel">
        <SectionHeader kicker="History logs" title="Stock Change Ledger" />
        <div className="history-table">
          <SimpleTable
            emptyText="No stock changes saved."
            headers={["Date / Time", "Item", "Vendor", "Action", "Change", "Before â†’ After", "Reason", "By"]}
            rows={stockRows.map((change) => {
              const item = data.items.find((candidate) => candidate.id === change.itemId);
              const vendorName = change.vendorNameSnapshot || (item ? getVendorName(data, item.vendorId) : "-");

              return [
                formatDateTime(change.occurredAt),
                change.itemNameSnapshot,
                vendorName,
                <StatusTag key={change.id} status={change.actionType} />,
                <StockMovementBadge key={`${change.id}-movement`} change={change} />,
                <StockBeforeAfter
                  key={`${change.id}-before-after`}
                  after={change.newQuantity}
                  before={change.previousQuantity}
                />,
                change.reason || "-",
                change.actor || "-"
              ];
            })}
          />
        </div>
      </section>
    </section>
  );
}

function SettingsPage({
  backupSupported,
  backupMessage,
  clearDemoData,
  data,
  lastBackupAt,
  lastAutoImportAt,
  newRecoveryCode,
  onChooseBackupFolder,
  onClose,
  onCreateRecoveryCode,
  onDismissRecoveryCode,
  onExportCsv,
  onExportJson,
  onImportCsv,
  onImportJson,
  onRunBackup,
  saveHealthRows,
  updateSettings
}: {
  backupSupported: boolean;
  backupMessage: string;
  clearDemoData: () => void;
  data: AppData;
  lastBackupAt: string | null;
  lastAutoImportAt: string | null;
  newRecoveryCode: string;
  onChooseBackupFolder: () => void;
  onClose: () => void;
  onCreateRecoveryCode: () => void;
  onDismissRecoveryCode: () => void;
  onExportCsv: () => void;
  onExportJson: () => void;
  onImportCsv: (file: File) => void;
  onImportJson: (file: File) => void;
  onRunBackup: () => void;
  saveHealthRows: SaveHealthRow[];
  updateSettings: (settings: AppSettings, auditSummary?: string) => void;
}) {
  const [pdfEngineStatus, setPdfEngineStatus] = useState<PdfEngineStatus | null>(null);
  const [isCheckingPdfEngine, setIsCheckingPdfEngine] = useState(false);
  const [pdfEngineError, setPdfEngineError] = useState("");
  const [appVersion, setAppVersion] = useState(APP_VERSION);
  const [updateFolderPath, setUpdateFolderPath] = useState(() => getManualInstallerFolder());
  const [updateCheck, setUpdateCheck] = useState<ManualInstallerCheckResult | null>(null);
  const [updateStatus, setUpdateStatus] = useState("Manual update mode is active.");
  const [isCheckingUpdateFolder, setIsCheckingUpdateFolder] = useState(false);
  const [isOpeningUpdateFolder, setIsOpeningUpdateFolder] = useState(false);
  const [isChoosingUpdateFolder, setIsChoosingUpdateFolder] = useState(false);
  const pdfStatusLabel = isCheckingPdfEngine ? "Checking..." : pdfEngineStatus ? (pdfEngineStatus.ready ? "Ready" : "Needs setup") : "Not checked";
  const pdfStatusClass = pdfEngineStatus?.ready ? "pdf-engine-ready" : "pdf-engine-warning";

  useEffect(() => {
    void refreshPdfEngineStatus();
    void getCurrentAppVersion()
      .then((version) => setAppVersion(version))
      .catch(() => setAppVersion(APP_VERSION));
  }, []);

  async function refreshPdfEngineStatus() {
    setIsCheckingPdfEngine(true);
    setPdfEngineError("");

    try {
      setPdfEngineStatus(await checkPdfExportEngines());
    } catch (error) {
      setPdfEngineError(error instanceof Error ? error.message : "Could not check PDF export engines.");
    } finally {
      setIsCheckingPdfEngine(false);
    }
  }

  function openLibreOfficeDownload() {
    const openedWindow = window.open("https://www.libreoffice.org/download/download-libreoffice/", "_blank", "noopener,noreferrer");

    if (openedWindow) {
      openedWindow.opener = null;
    }
  }

  async function handleCheckInstallerFolder() {
    setIsCheckingUpdateFolder(true);

    try {
      const result = await checkManualInstallerFolder(updateFolderPath);

      setUpdateCheck(result);
      setAppVersion(result.currentVersion);
      setUpdateStatus(result.statusMessage);
    } catch (error) {
      setUpdateStatus(error instanceof Error ? error.message : "Could not check installer folder.");
    } finally {
      setIsCheckingUpdateFolder(false);
    }
  }

  async function handleOpenInstallerFolder() {
    setIsOpeningUpdateFolder(true);

    try {
      await openInstallerFolder(updateFolderPath);
      setUpdateStatus("Installer folder opened.");
    } catch (error) {
      setUpdateStatus(error instanceof Error ? error.message : "Could not open installer folder.");
    } finally {
      setIsOpeningUpdateFolder(false);
    }
  }

  async function handleChooseUpdateFolder() {
    setIsChoosingUpdateFolder(true);

    try {
      const folderPath = await chooseManualInstallerFolder();

      setUpdateFolderPath(folderPath);
      setUpdateStatus("Update folder saved. Check the installer folder when ready.");
      setUpdateCheck(null);
    } catch (error) {
      setUpdateStatus(error instanceof Error ? error.message : "Could not choose update folder.");
    } finally {
      setIsChoosingUpdateFolder(false);
    }
  }

  return (
    <section className="settings-popout">
      <section className="panel">
        <SectionHeader
          action={
            <button className="settings-close" type="button" aria-label="Close settings" onClick={onClose}>
              X
            </button>
          }
          kicker="Shop profile"
          title="Settings"
        />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <label className="field-label">
            Company/shop name
            <input
              className="input"
              value={data.settings.companyShopName}
              onChange={(event) =>
                updateSettings({ ...data.settings, companyShopName: event.target.value }, "Company/shop name was updated.")
              }
            />
          </label>
          <label className="field-label">
            Default location
            <select
              className="input"
              value={data.settings.defaultLocationId}
              onChange={(event) =>
                updateSettings({ ...data.settings, defaultLocationId: event.target.value }, "Default location was updated.")
              }
            >
              <option value="">Unassigned</option>
              {data.locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            Low stock warning
            <select
              className="input"
              value={data.settings.lowStockWarningsEnabled ? "on" : "off"}
              onChange={(event) =>
                updateSettings(
                  { ...data.settings, lowStockWarningsEnabled: event.target.value === "on" },
                  "Low stock warning setting was updated."
                )
              }
            >
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </label>
          <label className="field-label">
            Minimum stock rule
            <select
              className="input"
              value={data.settings.lowStockIncludeEqual ? "at-or-below" : "below"}
              onChange={(event) =>
                updateSettings(
                  { ...data.settings, lowStockIncludeEqual: event.target.value === "at-or-below" },
                  "Low stock threshold rule was updated."
                )
              }
            >
              <option value="at-or-below">Low when at or below minimum</option>
              <option value="below">Low only below minimum</option>
            </select>
          </label>
          <label className="field-label">
            Negative stock override
            <select
              className="input"
              value={data.settings.allowNegativeStockOverride ? "on" : "off"}
              onChange={(event) =>
                updateSettings(
                  { ...data.settings, allowNegativeStockOverride: event.target.value === "on" },
                  "Negative stock override was updated."
                )
              }
            >
              <option value="off">Off</option>
              <option value="on">On</option>
            </select>
          </label>
        </div>
        <div className="settings-menu-row" aria-label="Settings sections">
          <a className="btn-muted" href="#app-update">
            App Update
          </a>
        </div>
      </section>

      <section className="panel">
        <SectionHeader kicker="Fresh PC setup" title="PDF Export Setup" />
        <div className={`settings-status-card ${pdfStatusClass}`}>
          <div className="pdf-engine-row">
            <span>Status</span>
            <strong>{pdfStatusLabel}</strong>
          </div>
          <div className="pdf-engine-row">
            <span>Microsoft Excel</span>
            <strong>{pdfEngineStatus ? (pdfEngineStatus.excelAvailable ? "Found" : "Not found") : "Not checked"}</strong>
          </div>
          <div className="pdf-engine-row">
            <span>LibreOffice</span>
            <strong>{pdfEngineStatus ? (pdfEngineStatus.libreOfficeAvailable ? "Found" : "Not found") : "Not checked"}</strong>
          </div>
          <div className="pdf-engine-row">
            <span>Preferred engine</span>
            <strong>{pdfEngineStatus?.preferredEngine ?? "Not checked"}</strong>
          </div>
          {pdfEngineStatus?.libreOfficePath && (
            <div className="pdf-engine-row">
              <span>LibreOffice path</span>
              <strong>{pdfEngineStatus.libreOfficePath}</strong>
            </div>
          )}
          <p>{pdfEngineStatus?.message ?? "Run the check to verify official requisition PDF export on this PC."}</p>
        </div>
        {pdfEngineError && <p className="warning-bar mt-3">{pdfEngineError}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn-primary" type="button" onClick={() => void refreshPdfEngineStatus()} disabled={isCheckingPdfEngine}>
            {isCheckingPdfEngine ? "Checking PDF Engine..." : "Check PDF Engine"}
          </button>
          <button className="btn-muted" type="button" onClick={openLibreOfficeDownload}>
            Install LibreOffice
          </button>
        </div>
      </section>

      <section className="panel update-check-card" id="app-update">
        <SectionHeader kicker="Release foundation" title="App Update" />
        <div className="settings-status-card update-settings-card">
          <div className="pdf-engine-row">
            <span>Current installed version</span>
            <strong>Maintenance Inventory Tracker v{appVersion}</strong>
          </div>
          <div className="pdf-engine-row">
            <span>Manual Update Mode</span>
            <strong>Manual update mode is active.</strong>
          </div>
          <div className="pdf-engine-row update-folder-row">
            <span>Installer folder</span>
            <strong>{updateFolderPath || DEFAULT_MANUAL_UPDATE_FOLDER}</strong>
          </div>
          {updateCheck?.newestInstaller && (
            <div className="pdf-engine-row">
              <span>Newest installer found</span>
              <strong>
                v{updateCheck.newestInstaller.version} - {updateCheck.newestInstaller.fileName}
              </strong>
            </div>
          )}
          <div className="update-instructions">
            <p>Manual update mode is active.</p>
            <p>To update, close Maintenance Inventory Tracker and run the newest setup installer.</p>
            <p>Your local app data will stay saved as long as you do not choose Delete application data during uninstall.</p>
            <p>Online signed updater can be added later if needed.</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn-primary" type="button" onClick={() => void handleCheckInstallerFolder()} disabled={isCheckingUpdateFolder}>
            {isCheckingUpdateFolder ? "Checking Installer Folder..." : "Check Installer Folder"}
          </button>
          <button className="btn-muted" type="button" onClick={() => void handleOpenInstallerFolder()} disabled={isOpeningUpdateFolder}>
            {isOpeningUpdateFolder ? "Opening Folder..." : "Open Installer Folder"}
          </button>
          <button className="btn-muted" type="button" onClick={() => void handleChooseUpdateFolder()} disabled={isChoosingUpdateFolder}>
            {isChoosingUpdateFolder ? "Choosing Folder..." : "Choose Update Folder"}
          </button>
          <div className="status-line update-status-line">{updateStatus}</div>
        </div>
      </section>

      <section className="panel">
        <SectionHeader kicker="Security" title="Recovery Access" />
        <div className="security-panel-content">
          <div>
            <p className="text-sm font-semibold text-slate-300">
              Create a fresh recovery code for this local inventory lock without changing the current password.
            </p>
            <p className="mt-1 text-xs font-bold text-amber-100">
              The previous recovery code stops working as soon as a new one is created.
            </p>
          </div>
          <button className="btn-primary" type="button" onClick={onCreateRecoveryCode}>
            Create New Recovery Code
          </button>
        </div>
        {newRecoveryCode && (
          <div className="settings-recovery-card">
            <div>
              <p className="eyebrow">Shown one time</p>
              <p className="mt-1 text-sm font-semibold text-slate-300">
                Save this code now. The old recovery code no longer works.
              </p>
            </div>
            <div className="recovery-code-card" aria-label="New one-time recovery code">
              {newRecoveryCode}
            </div>
            <button className="btn-muted" type="button" onClick={onDismissRecoveryCode}>
              I Saved This Code
            </button>
          </div>
        )}
      </section>

      <section className="panel">
        <SectionHeader kicker="Backup" title="Backup Settings" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <label className="field-label">
            Auto Backup
            <select
              className="input"
              value={data.settings.backupEnabled ? "on" : "off"}
              onChange={(event) =>
                updateSettings(
                  { ...data.settings, backupEnabled: event.target.value === "on" },
                  "Auto JSON backup setting was updated."
                )
              }
            >
              <option value="off">Off</option>
              <option value="on">On</option>
            </select>
          </label>
          <label className="field-label">
            Auto Import
            <select
              className="input"
              value={data.settings.autoImportEnabled ? "on" : "off"}
              onChange={(event) =>
                updateSettings(
                  { ...data.settings, autoImportEnabled: event.target.value === "on" },
                  "Auto import setting was updated."
                )
              }
            >
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </label>
          <label className="field-label">
            Backup interval
            <select
              className="input"
              value={data.settings.backupInterval}
              onChange={(event) =>
                updateSettings(
                  { ...data.settings, backupInterval: event.target.value as BackupInterval },
                  "Backup interval was updated."
                )
              }
            >
              <option value="change">After every change</option>
              <option value="5min">Every 5 minutes</option>
              <option value="15min">Every 15 minutes</option>
              <option value="manual">Manual only</option>
            </select>
          </label>
          <div className="field-label">
            Current selected backup folder
            <div className="status-line min-h-10">{data.settings.backupDirectoryName || "No folder selected"}</div>
          </div>
          <div className="field-label">
            Last backup time
            <div className="status-line min-h-10">
              {lastBackupAt || data.settings.lastBackupTimestamp
                ? formatDateTime(lastBackupAt || data.settings.lastBackupTimestamp)
                : "No backup has run yet"}
            </div>
          </div>
          <div className="field-label">
            Last auto import time
            <div className="status-line min-h-10">
              {lastAutoImportAt || data.settings.lastAutoImportTimestamp
                ? formatDateTime(lastAutoImportAt || data.settings.lastAutoImportTimestamp)
                : "Auto import has not run yet"}
            </div>
          </div>
          <div className="field-label xl:col-span-3">
            Backup status
            <div className="status-line min-h-10">{data.settings.backupStatus || backupMessage}</div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn-primary" type="button" onClick={onChooseBackupFolder} disabled={!backupSupported}>
            Choose Backup Folder
          </button>
          <button className="btn-muted" type="button" onClick={onRunBackup}>
            Backup Now
          </button>
          <label className="btn-muted cursor-pointer">
            Import JSON
            <input
              hidden
              accept=".json,application/json"
              type="file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  onImportJson(file);
                }
                event.currentTarget.value = "";
              }}
            />
          </label>
          <p className="w-full text-xs font-semibold text-slate-500">
            Recommended folder: {BACKUP_RECOMMENDED_FOLDER}
          </p>
          <p className="w-full text-xs font-semibold text-slate-500">
            Main backup file: {BACKUP_LATEST_FILENAME}
          </p>
        </div>
      </section>

      <SaveHealthPanel rows={saveHealthRows} />

      <section className="panel">
        <SectionHeader kicker="Portable data" title="Export / Import" />
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" type="button" onClick={onExportJson}>
            Export JSON
          </button>
          <label className="btn-muted cursor-pointer">
            Import JSON
            <input
              hidden
              accept=".json,application/json"
              type="file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  onImportJson(file);
                }
                event.currentTarget.value = "";
              }}
            />
          </label>
          <button className="btn-muted" type="button" onClick={onExportCsv}>
            Export CSV
          </button>
          <label className="btn-muted cursor-pointer">
            Import CSV
            <input
              hidden
              accept=".csv,text/csv"
              type="file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  onImportCsv(file);
                }
                event.currentTarget.value = "";
              }}
            />
          </label>
          <button className="btn-danger" type="button" onClick={clearDemoData}>
            Clear Demo Data
          </button>
        </div>
      </section>
    </section>
  );
}

function StatCard({ label, tone, value }: { label: string; tone: "cyan" | "green" | "amber" | "rose"; value: string }) {
  return (
    <div className={`metric-card metric-${tone}`}>
      <p className="text-xs font-bold uppercase text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-black text-white">{value}</p>
    </div>
  );
}

function StatusStatCard({ status }: { status: InventoryStatus }) {
  return (
    <div className={`metric-card status-metric-card ${statusMetricClassName(status)}`}>
      <p className="text-xs font-bold uppercase text-slate-400">Status</p>
      <div className="mt-3">
        <StatusTag status={status} showOrb={false} />
      </div>
    </div>
  );
}

function PartNumberCell({ item }: { item: InventoryItem }) {
  const partNumber = item.partNumber || "No part number";
  const href = getItemUrlHref(item.itemUrl);

  if (!href) {
    return <span>{item.partNumber || "-"}</span>;
  }

  return (
    <a className="part-link" href={href} target="_blank" rel="noreferrer">
      {partNumber}
    </a>
  );
}

function StockQuantity({
  ariaLabel,
  compact = false,
  item,
  onClick,
  settings,
  title
}: {
  ariaLabel?: string;
  compact?: boolean;
  item: InventoryItem;
  onClick?: () => void;
  settings: AppSettings;
  title?: string;
}) {
  const status = getInventoryStatus(item, settings);
  const className = `stock-quantity ${stockQuantityClassName(status)} ${compact ? "stock-quantity-compact" : ""} ${
    onClick ? "stock-quantity-action" : ""
  }`;
  const stockText = formatStockQuantity(item);

  if (onClick) {
    return (
      <button className={className} type="button" aria-label={ariaLabel} title={title} onClick={onClick}>
        {stockText}
      </button>
    );
  }

  return (
    <span
      className={className}
      aria-label={`Stock on hand: ${stockText}`}
      title={`Stock on hand: ${stockText}`}
    >
      {stockText}
    </span>
  );
}

function QrPreview({ value }: { value: string }) {
  return (
    <div className={`qr-preview ${value.trim() ? "qr-preview-filled" : "qr-preview-empty"}`} aria-hidden="true">
      {Array.from({ length: 81 }, (_, index) => (
        <span key={index} className={isQrCellActive(value, index) ? "qr-cell-active" : ""} />
      ))}
    </div>
  );
}

function SaveHealthPanel({ rows }: { rows: SaveHealthRow[] }) {
  return (
    <section className="panel">
      <SectionHeader kicker="Backup" title="Local Save Health" />
      <div className="save-health-list">
        {rows.map((row) => (
          <div key={row.label} className={`save-health-row save-health-row-${row.tone}`}>
            <span className={`status-health-dot ${row.tone}`} aria-hidden="true" />
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function SectionHeader({
  action,
  kicker,
  title
}: {
  action?: React.ReactNode;
  kicker?: string;
  title: string;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        {kicker && <p className="eyebrow">{kicker}</p>}
        <h2 className="text-lg font-black tracking-tight text-white">{title}</h2>
      </div>
      {action}
    </div>
  );
}

function StatusDot({ state }: { state: BackupIndicatorState }) {
  return <span className={`status-dot status-dot-${state}`} aria-label={`Backup ${state}`} />;
}

function BackupStatusDot({ status }: { status: BackupStatusInfo }) {
  return (
    <span
      className={`backup-health-dot backup-health-dot-${status.tone} ${status.pulse ? "backup-health-dot-pulse" : ""}`}
      aria-label={status.tooltip}
      title={status.tooltip}
    />
  );
}

function StatusTag({
  ariaLabel,
  onClick,
  showOrb = true,
  status,
  title
}: {
  ariaLabel?: string;
  onClick?: () => void;
  showOrb?: boolean;
  status: string;
  title?: string;
}) {
  const className = `tag ${statusTagClassName(status)} ${onClick ? "tag-action" : ""} ${showOrb ? "" : "tag-no-orb"}`;

  if (onClick) {
    return (
      <button className={className} type="button" aria-label={ariaLabel} title={title} onClick={onClick}>
        {status}
      </button>
    );
  }

  return <span className={className}>{status}</span>;
}

function Toast({ text, tone }: { text: string; tone: "success" | "warning" | "danger" }) {
  return <div className={`toast toast-${tone}`}>{text}</div>;
}

function SimpleTable({
  emptyText,
  headers,
  rowKeys,
  rows
}: {
  emptyText: string;
  headers: string[];
  rowKeys?: string[];
  rows: React.ReactNode[][];
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={rowKeys?.[index] ?? index}>
              {row.map((cell, cellIndex) => (
                <td key={`${rowKeys?.[index] ?? index}-${cellIndex}`}>{cell}</td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={headers.length} className="py-8 text-center text-sm font-semibold text-slate-500">
                {emptyText}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default App;
