import {
  type Dispatch,
  FormEvent,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import { QRCodeSVG } from "qrcode.react";
import {
  APP_VERSION,
  checkManualInstallerFolder,
  chooseManualInstallerFolder,
  DEFAULT_MANUAL_UPDATE_FOLDER,
  getCurrentAppVersion,
  getManualInstallerFolder,
  type ManualInstallerCheckResult,
  openInstallerFile,
  openInstallerFolder,
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
  writeBackupFile,
} from "./lib/backup";
import {
  CSV_RECOMMENDED_FOLDER,
  checkCsvFolderExists,
  chooseCsvFolder,
  exportCsvFolder,
  exportHistoryMonthCsv,
  isCsvFolderSupported,
  readCsvFolderImportFiles,
} from "./lib/csvFolder";
import {
  createAuthRecord,
  formatRecoveryCode,
  isAuthSessionUnlocked,
  readAuthRecord,
  resetPasswordWithRecovery,
  rotateRecoveryCode,
  setAuthSessionUnlocked,
  verifyPassword,
  verifyRecoveryCode,
} from "./lib/auth";
import { loadAppData, saveAppData } from "./lib/db";
import {
  downloadBlobFile,
  downloadTextFile,
  parseCsv,
  rowsToCsv,
} from "./lib/export";
import {
  buildBlankInventoryExcelTemplate,
  buildInventoryExcelTemplate,
  MIT3_BLANK_INVENTORY_TEMPLATE_FILENAME,
  MIT3_INVENTORY_TEMPLATE_FILENAME,
  normalizeInventoryItemUrl,
  readInventoryExcelTemplate,
  type InventoryExcelTemplatePreview,
} from "./lib/inventoryExcelTemplate";
import {
  DEFAULT_HISTORY_LOG_PAGE_SIZE,
  HISTORY_LOG_PAGE_SIZE_OPTIONS,
  trimAuditLogEntries,
  trimStockChangeEntries,
} from "./lib/historyLog";
import {
  getRoleLabel,
  hasPermission,
  PERMISSION_DENIED_MESSAGE,
  type Permission,
} from "./lib/permissions";
import {
  checkPdfExportEngines,
  type PdfEngineStatus,
} from "./lib/pdfEngineStatus";
import { getWebsiteBackendUrl, isWebsiteBrowserMode } from "./lib/runtimeMode";
import {
  activateInventorySqliteState,
  getSqliteInventoryMirrorStatus,
} from "./lib/sqliteInventoryMirror";
import {
  activateVendorLocationSqliteState,
  getSqliteVendorLocationStatus,
} from "./lib/sqliteVendorsLocations";
import {
  activateStockLedgerSqliteState,
  getSqliteStockLedgerMirrorStatus,
} from "./lib/sqliteStockLedgerMirror";
import {
  activateRequisitionSqliteState,
  getSqliteRequisitionMirrorStatus,
  saveRequisitionToSqlite,
  syncRequisitionsToSqlite,
} from "./lib/sqliteRequisitionMirror";
import {
  activateTrashSqliteState,
  deleteDeletedRecordFromSqlite,
  getSqliteTrashMirrorStatus,
  saveDeletedRecordToSqlite,
  syncDeletedRecordsToSqlite,
} from "./lib/sqliteTrashMirror";
import {
  activateAppSettingsSqliteState,
  getSqliteSettingsMirrorStatus,
  loadAppSettingsFromSqlite,
  syncAppSettingsToSqlite,
} from "./lib/sqliteSettingsMirror";
import { runSqliteHealthCheck } from "./lib/sqliteHealthCheck";
import {
  getWebsiteAuthStatus,
  isWebsiteAuthSessionUnlocked,
  loginWebsiteAuth,
  setWebsiteAuthSessionUnlocked,
  setupWebsiteAuth,
} from "./lib/websiteAuth";
import {
  getWebsiteUpdateRunLog,
  getWebsiteUpdateRunStatus,
  getWebsiteUpdateStatus,
  runWebsiteUpdate,
  type WebsiteUpdateRunStatus,
  type WebsiteUpdateStatus,
} from "./lib/websiteUpdate";
import {
  downloadWebsiteBackupFile,
  getWebsiteBackupStatus,
  runWebsiteBackup as runBackendWebsiteBackup,
  type WebsiteBackupStatus,
} from "./lib/websiteBackup";
import { IdleScreensaver } from "./components/layout/IdleScreensaver";
import jbtUsaRequisitionLogo from "./assets/jbt-usa-requisition-logo.png";
import type {
  AppData,
  AppSettings,
  AuditEntry,
  AuditEntityType,
  BackupIndicatorState,
  BackupInterval,
  DeletedRecord,
  DeletedRecordType,
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
  VendorRecord,
} from "./types";

const DEFAULT_HEADER_BADGE_TEXT = "Private Local Desktop App";
const WEBSITE_UPDATE_REMIND_LATER_KEY = "mit3_update_wait_sha";
const SEEN_NEW_INVENTORY_ITEMS_KEY = "mit3_seen_new_inventory_items";
const NEW_LOCATION_NOTICE_IDS_KEY = "mit3_new_location_notice_ids";
const SEEN_LOCATION_NOTICE_IDS_KEY = "mit3_seen_location_notice_ids";
const NEW_VENDOR_NOTICE_IDS_KEY = "mit3_new_vendor_notice_ids";
const SEEN_VENDOR_NOTICE_IDS_KEY = "mit3_seen_vendor_notice_ids";
const MIN_AUTH_LOADING_MS = 1100;
const RECENT_ACTIVITY_WINDOW_MS = 5 * 60 * 1000;
const TRASH_RETENTION_MS = 30 * 60 * 1000;
const ITEM_IMAGE_MAX_DIMENSION = 400;
const ITEM_IMAGE_MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024;
const ITEM_IMAGE_MAX_DATA_URL_LENGTH = 900_000;
const ITEM_IMAGE_OUTPUT_QUALITY = 0.82;
const ITEM_IMAGE_ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const ITEM_IMAGE_ALLOWED_EXTENSION = /\.(png|jpe?g|webp)$/i;
const QR_ITEM_PREFIX = "MIT:";
const labelSizeOptions: LabelSizeOption[] = [
  {
    id: "brady",
    label: "Brady .75 in tape",
    description: "Narrow machine/bin tape",
  },
  {
    id: "small",
    label: "Small bin 2 x 1",
    description: "Compact shelf or bin label",
  },
  { id: "large", label: "Shelf 3 x 1.5", description: "Larger shelf label" },
];
const TIMED_BACKUP_INTERVAL_MS: Record<
  Extract<BackupInterval, "5min" | "15min">,
  number
> = {
  "5min": 5 * 60 * 1000,
  "15min": 15 * 60 * 1000,
};
const INVENTORY_SEARCH_DEBOUNCE_MS = 180;
const INVENTORY_PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
const DEFAULT_INVENTORY_PAGE_SIZE = 50;
const INVENTORY_COMPACT_LAYOUT_QUERY = "(max-width: 1024px)";
const INVENTORY_AUTO_PAGE_EDGE_PX = 56;
const INVENTORY_SCROLL_RESET_SUPPRESS_MS = 260;
const REQUISITION_HISTORY_PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
const DEFAULT_REQUISITION_HISTORY_PAGE_SIZE = 20;
const DASHBOARD_SCREENSAVER_TIMEOUT_MS = 5 * 60 * 1000;
const CSV_HISTORY_EXPORT_DEBOUNCE_MS = 900;

const showWebsiteModePanel = isWebsiteBrowserMode();
const websiteBackendUrl = getWebsiteBackendUrl();

const pages: Array<{ id: PageId; label: string }> = [
  { id: "dashboard", label: "Dashboard" },
  { id: "inventory", label: "Inventory" },
  { id: "locations", label: "Locations" },
  { id: "vendors", label: "Vendors" },
  { id: "reorder", label: "Reorder List" },
  { id: "history", label: "History Logs" },
];

function readWebsiteUpdateRemindLaterSha() {
  try {
    return localStorage.getItem(WEBSITE_UPDATE_REMIND_LATER_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveWebsiteUpdateRemindLaterSha(remoteSha: string) {
  try {
    localStorage.setItem(WEBSITE_UPDATE_REMIND_LATER_KEY, remoteSha);
  } catch {}
}

function readSeenNewInventoryItemIds() {
  try {
    const raw = localStorage.getItem(SEEN_NEW_INVENTORY_ITEMS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];

    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

function saveSeenNewInventoryItemIds(itemIds: string[]) {
  try {
    localStorage.setItem(
      SEEN_NEW_INVENTORY_ITEMS_KEY,
      JSON.stringify(Array.from(new Set(itemIds))),
    );
  } catch {}
}

function markNewInventoryItemsSeen(itemIds: string[]) {
  if (itemIds.length === 0) {
    return;
  }

  saveSeenNewInventoryItemIds([...readSeenNewInventoryItemIds(), ...itemIds]);
}

function noticeStorageUserKey() {
  try {
    const authRecord = readAuthRecord();
    const identity =
      authRecord?.recoveryEmail || authRecord?.passwordHash || "browser-local";

    return identity.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  } catch {
    return "browser-local";
  }
}

function noticeStorageKey(baseKey: string) {
  return `${baseKey}:${noticeStorageUserKey()}`;
}

function readNoticeIds(baseKey: string) {
  try {
    const raw =
      localStorage.getItem(noticeStorageKey(baseKey)) ??
      localStorage.getItem(baseKey);
    const parsed = raw ? JSON.parse(raw) : [];

    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

function saveNoticeIds(baseKey: string, ids: string[]) {
  try {
    localStorage.setItem(
      noticeStorageKey(baseKey),
      JSON.stringify(Array.from(new Set(ids))),
    );
  } catch {}
}

function mergeNoticeIds(currentIds: string[], addedIds: string[]) {
  return Array.from(new Set([...addedIds, ...currentIds].filter(Boolean)));
}

function inventoryItemRecencyTime(item: InventoryItem) {
  const createdAt = Date.parse(item.createdAt || "");
  const updatedAt = Date.parse(item.updatedAt || "");

  return Math.max(
    Number.isFinite(createdAt) ? createdAt : 0,
    Number.isFinite(updatedAt) ? updatedAt : 0,
  );
}

function websiteUpdateStatusMessage(status: WebsiteUpdateStatus | null) {
  if (!status) {
    return "Not checked yet.";
  }

  if (!status.ok) {
    return status.error || "Could not check updates.";
  }

  if (status.updateAvailable) {
    const countLabel =
      status.behindCount && status.behindCount > 0
        ? ` (${status.behindCount} commit${status.behindCount === 1 ? "" : "s"} behind)`
        : "";
    return `Update available on ${status.branch}${countLabel}.`;
  }

  return `Up to date on ${status.branch}.`;
}

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
  "Other",
];

const stockUnitOptions = ["Each", "Ft"] as const;
const DEFAULT_STOCK_UNIT = stockUnitOptions[0];
const MANUAL_REQUISITION_ITEM_PREFIX = "manual-requisition-item-";
const MANUAL_REQUISITION_VENDOR_PREFIX = "manual-requisition-vendor:";

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
  imageDataUrl: string;
  barcodePlaceholder: string;
  reorderHold: boolean;
  orderPlaced: boolean;
  hiddenFromWatchList: boolean;
  nonStocked: boolean;
};

type StockFormState = {
  itemId: string;
  actionType: StockActionType | "";
  quantity: NumericInputValue;
  orderPlaced: boolean;
  reorderHold: boolean;
  reason: string;
  actor: string;
  notes: string;
  occurredAt: string;
};

type ManualRequisitionDraft = {
  costEach: string;
  description: string;
  notes: string;
  partNumber: string;
  quantity: string;
  vendorName: string;
};

type WatchListVisibilityChoice = "hidden" | "visible" | "held";

type RequisitionHistoryFilters = {
  dateFrom: string;
  dateTo: string;
  itemName: string;
  partNumber: string;
  poNo: string;
  vendor: string;
  year: string;
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

type TauriInvoke = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

type ToastState = {
  tone: "success" | "warning" | "danger";
  text: string;
  actionLabel?: string;
  onAction?: () => void;
} | null;

type ToastTone = NonNullable<ToastState>["tone"];
type CategoryAddResult = {
  ok: boolean;
  message: string;
};
type ScanApplyTarget = "partNumber" | "barcodePlaceholder" | "itemUrl";
type LabelSizeKey = "brady" | "small" | "large";
type InventoryColumnFilterKey =
  | "location"
  | "partNumber"
  | "category"
  | "description"
  | "vendor";
type InventoryColumnFilters = Record<InventoryColumnFilterKey, string>;

type LabelSizeOption = {
  id: LabelSizeKey;
  label: string;
  description: string;
};

const blankInventoryColumnFilters = (): InventoryColumnFilters => ({
  location: "",
  partNumber: "",
  category: "",
  description: "",
  vendor: "",
});

const hasActiveInventoryColumnFilters = (filters: InventoryColumnFilters) =>
  Object.values(filters).some((value) => value.trim().length > 0);

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

type CsvFolderVendorRecord = {
  id: string;
  name: string;
  contactName: string;
  contactEmail: string;
  phone: string;
  email: string;
  website: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

type CsvFolderLocationRecord = {
  id: string;
  name: string;
  description: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

type CsvFolderInventoryRecord = {
  id: string;
  partNumber: string;
  name: string;
  description: string;
  category: string;
  vendorId: string;
  vendorName: string;
  locationId: string;
  locationName: string;
  quantityOnHand: number | null;
  stockUnit: string;
  minimumStockLevel: number | null;
  lowStockAlertLevel: number | null;
  costEach: number | null;
  itemUrl: string;
  notes: string;
  orderPlaced: boolean | null;
  reorderHold: boolean | null;
  hiddenFromWatchList: boolean | null;
  nonStocked: boolean | null;
  createdAt: string;
  updatedAt: string;
};

type CsvFolderImportPreview = {
  folderPath: string;
  inventoryFileFound: boolean;
  inventoryRecords: CsvFolderInventoryRecord[];
  locationFileFound: boolean;
  locationRecords: CsvFolderLocationRecord[];
  newItems: number;
  newLocations: number;
  newVendors: number;
  updatedItems: number;
  updatedLocations: number;
  updatedVendors: number;
  vendorFileFound: boolean;
  vendorRecords: CsvFolderVendorRecord[];
};

type CsvFolderImportResult = {
  created: number;
  locationsCreated: number;
  locationsUpdated: number;
  updated: number;
  vendorsCreated: number;
  vendorsUpdated: number;
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

type SettingsStatusSummary = {
  helper: string;
  label: string;
  tone: HealthTone;
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

const monthKeyFromIso = (value: string) => {
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? nowIso().slice(0, 7)
    : date.toISOString().slice(0, 7);
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const cleanDisplayText = (value: string) =>
  value
    .replace(/Caf(?:\uFFFD|\u00ef\u00bf\u00bd)/gi, "Cafe")
    .replace(/\uFFFD|\u00ef\u00bf\u00bd/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

const stringValue = (value: unknown, fallback = "") =>
  typeof value === "string"
    ? cleanDisplayText(value) || fallback
    : value === undefined || value === null
      ? fallback
      : cleanDisplayText(String(value)) || fallback;

function normalizeCategoryName(value: unknown) {
  return stringValue(value).replace(/\s+/g, " ").trim();
}

function normalizeCustomCategories(value: unknown) {
  const categories = Array.isArray(value) ? value : [];
  const categoriesByKey = new Map<string, string>();

  categories.forEach((category) => {
    const cleanCategory = normalizeCategoryName(category);

    if (cleanCategory) {
      const key = cleanCategory.toLowerCase();

      if (!categoriesByKey.has(key)) {
        categoriesByKey.set(key, cleanCategory);
      }
    }
  });

  return Array.from(categoriesByKey.values()).sort((first, second) =>
    first.localeCompare(second, undefined, { sensitivity: "base" }),
  );
}

function getInventoryCategoryOptions(data: AppData, selectedCategory = "") {
  return normalizeCustomCategories([
    ...categoryOptions,
    ...data.items.map((item) => item.category),
    ...data.settings.customCategories,
    selectedCategory,
  ]);
}

function hasCategoryMatch(categories: string[], categoryName: string) {
  const normalizedCategory = normalizeCategoryName(categoryName).toLowerCase();

  return (
    normalizedCategory.length > 0 &&
    categories.some((category) => category.toLowerCase() === normalizedCategory)
  );
}

const numberValue = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const wholeNumberValue = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
};

const normalizeWholeNumberInput = (
  value: string,
  options: { allowNegative?: boolean } = {},
) => {
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

  return isNegative && normalizedDigits !== "0"
    ? `-${normalizedDigits}`
    : normalizedDigits;
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
  const normalizedInteger = integerDigits
    ? integerDigits.replace(/^0+(?=\d)/, "")
    : hasDecimal
      ? "0"
      : "";

  return hasDecimal
    ? `${normalizedInteger || "0"}.${decimalText}`
    : normalizedInteger;
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
    feet: "Ft",
  };
  const matchedUnit = stockUnitOptions.find(
    (unit) => unit.toLowerCase() === text.toLowerCase(),
  );

  return matchedUnit ?? unitAliases[normalizedText] ?? DEFAULT_STOCK_UNIT;
};

const formatStockQuantity = (
  item: Pick<InventoryItem, "quantityOnHand" | "stockUnit">,
) =>
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
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    value,
  );

const formatDateTime = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not saved yet" : date.toLocaleString();
};

const formatNumber = (value: number) =>
  Number.isFinite(value)
    ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)
    : "0";

const defaultLowStockAlertLevel = () => 0;

const normalizeLowStockAlertLevel = (
  _minimumStockLevel: number,
  value: unknown,
) => {
  const parsed = wholeNumberValue(value, defaultLowStockAlertLevel());

  return parsed >= 0 ? parsed : defaultLowStockAlertLevel();
};

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeoutId = window.setTimeout(
      () => setDebouncedValue(value),
      delayMs,
    );

    return () => window.clearTimeout(timeoutId);
  }, [delayMs, value]);

  return debouncedValue;
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia(query);
    const updateMatches = () => setMatches(mediaQuery.matches);

    updateMatches();
    mediaQuery.addEventListener("change", updateMatches);

    return () => mediaQuery.removeEventListener("change", updateMatches);
  }, [query]);

  return matches;
}

const blankLocationForm = (): LocationFormState => ({
  name: "",
  description: "",
  notes: "",
});

const blankVendorForm = (): VendorFormState => ({
  name: "",
  contactName: "",
  contactEmail: "",
  phone: "",
  email: "",
  website: "",
  notes: "",
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
  imageDataUrl: "",
  barcodePlaceholder: "",
  reorderHold: false,
  orderPlaced: true,
  hiddenFromWatchList: false,
  nonStocked: false,
});

const blankStockForm = (itemId = ""): StockFormState => ({
  itemId,
  actionType: "",
  quantity: "",
  orderPlaced: false,
  reorderHold: false,
  reason: "",
  actor: "",
  notes: "",
  occurredAt: toDateTimeLocal(),
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
    updatedAt: now,
  };
}

function createLocation(
  name: string,
  details: Partial<LocationRecord> = {},
): LocationRecord {
  const now = nowIso();

  return {
    id: details.id ?? createId(),
    name,
    description: details.description ?? "",
    notes: details.notes ?? "",
    isDemo: details.isDemo,
    createdAt: details.createdAt ?? now,
    updatedAt: details.updatedAt ?? now,
  };
}

function createVendor(
  name: string,
  details: Partial<VendorRecord> = {},
): VendorRecord {
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
    updatedAt: details.updatedAt ?? now,
  };
}

function createAuditEntry(
  entityType: AuditEntityType,
  entityId: string,
  action: string,
  summary: string,
  actor = "System",
  occurredAt = nowIso(),
  isDemo = false,
): AuditEntry {
  return {
    id: createId(),
    entityType,
    entityId,
    action,
    summary,
    actor: actor || "System",
    occurredAt,
    isDemo,
  };
}

function createDemoData(): AppData {
  const now = nowIso();
  const locations = [
    createLocation("Main Shop Cabinet", {
      description: "Primary maintenance storage",
      notes: "Top bins for high-use parts",
      isDemo: true,
    }),
    createLocation("Line 2 Tool Crib", {
      description: "Near production line 2",
      notes: "Shared with second shift",
      isDemo: true,
    }),
    createLocation("Maintenance Cart", {
      description: "Mobile emergency cart",
      notes: "Keep critical spares stocked",
      isDemo: true,
    }),
  ];
  const vendors = [
    createVendor("Grainger", {
      contactName: "Account Desk",
      website: "https://www.grainger.com",
      notes: "General industrial supply",
      isDemo: true,
    }),
    createVendor("McMaster-Carr", {
      website: "https://www.mcmaster.com",
      notes: "Fasteners and mechanical parts",
      isDemo: true,
    }),
    createVendor("Local Electrical Supply", {
      contactName: "Counter Sales",
      phone: "555-0142",
      notes: "Sensors, fuses, wiring",
      isDemo: true,
    }),
  ];
  const itemSeed: Array<
    Partial<InventoryItem> & Pick<InventoryItem, "name" | "partNumber">
  > = [
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
      notes: "Check fit before reordering",
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
      notes: "Low stock sample",
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
      notes: "Out of stock sample",
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
      notes: "Use for weekly PMs",
    },
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
    imageDataUrl: "",
    barcodePlaceholder: "",
    reorderHold: seed.reorderHold === true,
    orderPlaced: seed.orderPlaced === false ? false : true,
    isDemo: true,
    createdAt: now,
    updatedAt: now,
  }));
  const stockChanges: StockChange[] = [
    {
      id: createId(),
      itemId: items[0].id,
      itemNameSnapshot: items[0].name,
      partNumberSnapshot: items[0].partNumber,
      vendorNameSnapshot:
        vendors.find((vendor) => vendor.id === items[0].vendorId)?.name ||
        "Unassigned",
      actionType: "Stock In",
      quantity: 4,
      reason: "Initial count",
      actor: "System",
      notes: "Demo setup",
      occurredAt: now,
      previousQuantity: 0,
      newQuantity: 4,
      isDemo: true,
      createdAt: now,
    },
    {
      id: createId(),
      itemId: items[2].id,
      itemNameSnapshot: items[2].name,
      partNumberSnapshot: items[2].partNumber,
      vendorNameSnapshot:
        vendors.find((vendor) => vendor.id === items[2].vendorId)?.name ||
        "Unassigned",
      actionType: "Stock Out",
      quantity: 1,
      reason: "Line sensor replacement",
      actor: "Maintenance",
      notes: "Demo outage",
      occurredAt: now,
      previousQuantity: 1,
      newQuantity: 0,
      isDemo: true,
      createdAt: now,
    },
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
    deletedRecords: [],
    auditLog: [
      createAuditEntry(
        "Import",
        "demo",
        "Demo Data Loaded",
        "Starter maintenance inventory was created.",
        "System",
        now,
        true,
      ),
      createAuditEntry(
        "Stock",
        stockChanges[1].id,
        "Stock Out",
        "M12 Proximity Sensor moved to Out of Stock.",
        "Maintenance",
        now,
        true,
      ),
    ],
    settings,
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
      "backupDirectoryHandle" in raw
        ? (raw.backupDirectoryHandle as AppSettings["backupDirectoryHandle"])
        : null,
    csvExportFolderPath: stringValue(raw.csvExportFolderPath),
    csvAutoExportHistoryEnabled: raw.csvAutoExportHistoryEnabled === true,
    csvLastExportAt: stringValue(raw.csvLastExportAt),
    csvLastHistoryExportAt: stringValue(raw.csvLastHistoryExportAt),
    customCategories: normalizeCustomCategories(raw.customCategories),
    lastBackupTimestamp: stringValue(raw.lastBackupTimestamp),
    lastAutoImportTimestamp: stringValue(raw.lastAutoImportTimestamp),
    backupStatus: stringValue(raw.backupStatus, defaults.backupStatus),
    watchListDefaultsMigratedAt: stringValue(
      raw.watchListDefaultsMigratedAt,
      defaults.watchListDefaultsMigratedAt,
    ),
    updatedAt: stringValue(raw.updatedAt, defaults.updatedAt),
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
    updatedAt: stringValue(raw.updatedAt, now),
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
    updatedAt: stringValue(raw.updatedAt, now),
  };
}

function normalizeItem(value: unknown): InventoryItem {
  const raw = asRecord(value);
  const now = nowIso();
  const minimumStockLevel = Math.max(0, numberValue(raw.minimumStockLevel, 0));
  const lowStockAlertLevel = normalizeLowStockAlertLevel(
    minimumStockLevel,
    raw.lowStockAlertLevel,
  );
  const hasOrderPlaced = Object.prototype.hasOwnProperty.call(
    raw,
    "orderPlaced",
  );

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
    imageDataUrl: normalizeImageDataUrl(raw.imageDataUrl),
    barcodePlaceholder: stringValue(raw.barcodePlaceholder),
    reorderHold: raw.reorderHold === true,
    orderPlaced: hasOrderPlaced ? raw.orderPlaced === true : true,
    hiddenFromWatchList: raw.hiddenFromWatchList === true,
    nonStocked: raw.nonStocked === true,
    orderRequisitionId: Object.prototype.hasOwnProperty.call(
      raw,
      "orderRequisitionId",
    )
      ? stringValue(raw.orderRequisitionId)
      : undefined,
    isDemo: raw.isDemo === true,
    createdAt: stringValue(raw.createdAt, now),
    updatedAt: stringValue(raw.updatedAt, now),
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
    createdAt: stringValue(raw.createdAt, now),
  };
}

function normalizeRequisitionMadeRecord(value: unknown): RequisitionMadeRecord {
  const raw = asRecord(value);
  const now = nowIso();
  const itemSnapshots = Array.isArray(raw.itemSnapshots)
    ? raw.itemSnapshots.map((snapshot) => {
        const item = asRecord(snapshot);
        const quantityRequested = Math.max(
          0,
          wholeNumberValue(item.quantityRequested),
        );
        const unitCost = Math.max(0, numberValue(item.unitCost));

        return {
          itemId: stringValue(item.itemId),
          itemName: stringValue(item.itemName, "Unknown Item"),
          partNumber: stringValue(item.partNumber),
          quantityRequested,
          unitCost,
          totalCost: Math.max(
            0,
            numberValue(item.totalCost, quantityRequested * unitCost),
          ),
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
    createdAt: stringValue(raw.createdAt ?? raw.passedAt, now),
    createdBy: stringValue(raw.createdBy ?? raw.requisitionedBy, "User"),
    itemIds,
    itemSnapshots,
    poNo: stringValue(raw.poNo),
    totalCost: Math.max(
      0,
      numberValue(
        raw.totalCost,
        itemSnapshots.reduce((sum, snapshot) => sum + snapshot.totalCost, 0),
      ),
    ),
    requisitionType: raw.requisitionType === "over100" ? "over100" : "under100",
    pdfGeneratedAt: stringValue(raw.pdfGeneratedAt, now),
    passedAt: stringValue(raw.passedAt, now),
    requisitionedBy: stringValue(raw.requisitionedBy ?? raw.createdBy),
    status: "Made",
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
    isDemo: raw.isDemo === true,
  };
}

function shouldApplyWatchListDefaultsMigration(value: unknown) {
  const raw = asRecord(value);
  const rawSettings = asRecord(raw.settings);

  return (
    Array.isArray(raw.items) &&
    !stringValue(rawSettings.watchListDefaultsMigratedAt)
  );
}

function applyWatchListDefaultsToExistingItems(
  items: InventoryItem[],
  rawItems: unknown[],
) {
  return items.map((item, index) => {
    const raw = asRecord(rawItems[index]);

    return {
      ...item,
      orderPlaced: Object.prototype.hasOwnProperty.call(raw, "orderPlaced")
        ? item.orderPlaced
        : true,
      reorderHold: Object.prototype.hasOwnProperty.call(raw, "reorderHold")
        ? item.reorderHold
        : false,
    };
  });
}

function normalizeAppData(value: unknown): AppData {
  if (!value) {
    return createDemoData();
  }

  const raw = asRecord(value);
  const now = nowIso();
  const settings = normalizeSettings(raw.settings);
  const locations = Array.isArray(raw.locations)
    ? raw.locations.map(normalizeLocation)
    : [];
  const vendors = Array.isArray(raw.vendors)
    ? raw.vendors.map(normalizeVendor)
    : [];
  const shouldMigrateWatchListDefaults =
    shouldApplyWatchListDefaultsMigration(raw);
  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  const normalizedItems = rawItems.map(normalizeItem);
  const items = shouldMigrateWatchListDefaults
    ? applyWatchListDefaultsToExistingItems(normalizedItems, rawItems)
    : normalizedItems;

  if (!settings.defaultLocationId && locations[0]) {
    settings.defaultLocationId = locations[0].id;
  }

  if (shouldMigrateWatchListDefaults) {
    settings.watchListDefaultsMigratedAt = now;
  }

  return {
    app: "maintenance-inventory-tracker",
    version: stringValue(raw.version ?? raw.appVersion, APP_VERSION),
    lastSavedAt: stringValue(raw.lastSavedAt ?? raw.lastUpdated, now),
    items,
    locations,
    vendors,
    stockChanges: Array.isArray(raw.stockChanges)
      ? trimStockChangeEntries(raw.stockChanges.map(normalizeStockChange))
      : [],
    requisitionMadeRecords: Array.isArray(raw.requisitionMadeRecords)
      ? raw.requisitionMadeRecords.map(normalizeRequisitionMadeRecord)
      : [],
    deletedRecords: Array.isArray(raw.deletedRecords)
      ? purgeExpiredDeletedRecords(
          raw.deletedRecords
            .map(normalizeDeletedRecord)
            .filter(Boolean) as DeletedRecord[],
        )
      : [],
    auditLog: Array.isArray(raw.auditLog)
      ? trimAuditLogEntries(raw.auditLog.map(normalizeAuditEntry))
      : [],
    settings,
  };
}

function getInventoryStatus(
  item: InventoryItem,
  _settings?: AppSettings,
): InventoryStatus {
  if (item.nonStocked === true) {
    return "Order As Needed";
  }

  if (item.quantityOnHand <= 0) {
    return "Out of Stock";
  }

  const lowStockAlertLevel = normalizeLowStockAlertLevel(
    item.minimumStockLevel,
    item.lowStockAlertLevel,
  );

  if (lowStockAlertLevel > 0 && item.quantityOnHand <= lowStockAlertLevel) {
    return "Low Stock";
  }

  return "In Stock";
}

function isReorderNeeded(item: InventoryItem, settings: AppSettings) {
  const status = getInventoryStatus(item, settings);
  return status === "Low Stock" || status === "Out of Stock";
}

function isHiddenFromDashboardWatchList(
  item: InventoryItem,
  settings: AppSettings,
) {
  return isReorderNeeded(item, settings) && item.hiddenFromWatchList === true;
}

function applyWatchListVisibilityChoice(
  form: ItemFormState,
  choice: WatchListVisibilityChoice,
): ItemFormState {
  if (choice === "visible") {
    return { ...form, hiddenFromWatchList: false, orderPlaced: false, reorderHold: false };
  }

  if (choice === "held") {
    return { ...form, hiddenFromWatchList: false, orderPlaced: false, reorderHold: true };
  }

  return { ...form, hiddenFromWatchList: true, orderPlaced: false, reorderHold: false };
}

function getWatchListVisibilitySummary(
  item: InventoryItem,
  choice: Exclude<WatchListVisibilityChoice, "hidden">,
) {
  if (choice === "held") {
    return `${item.name} was moved to the Held list.`;
  }

  return `${item.name} was shown on the Dashboard Watch List.`;
}

function getActiveRequisitionMadeRecords(data: AppData) {
  const activeRequisitionIdByItemId = new Map<string, string>();

  data.items.forEach((item) => {
    if (!item.orderPlaced || !isReorderNeeded(item, data.settings)) {
      return;
    }

    const record = getLinkedRequisitionMadeRecord(data, item);

    if (record) {
      activeRequisitionIdByItemId.set(item.id, record.id);
    }
  });

  return data.requisitionMadeRecords
    .map((record) => ({
      ...record,
      itemIds: record.itemIds.filter(
        (itemId) => activeRequisitionIdByItemId.get(itemId) === record.id,
      ),
      itemSnapshots: record.itemSnapshots.filter(
        (snapshot) =>
          activeRequisitionIdByItemId.get(snapshot.itemId) === record.id,
      ),
    }))
    .filter((record) => record.itemIds.length > 0);
}

function getLinkedRequisitionMadeRecord(data: AppData, item: InventoryItem) {
  if (!item.orderPlaced) {
    return null;
  }

  if (item.orderRequisitionId !== undefined) {
    const requisitionId = item.orderRequisitionId.trim();

    if (!requisitionId) {
      return null;
    }

    return (
      data.requisitionMadeRecords.find(
        (record) =>
          record.id === requisitionId && record.itemIds.includes(item.id),
      ) ?? null
    );
  }

  return (
    data.requisitionMadeRecords.find((record) =>
      record.itemIds.includes(item.id),
    ) ?? null
  );
}

function addAudit(data: AppData, entry: AuditEntry): AppData {
  return {
    ...data,
    deletedRecords: purgeExpiredDeletedRecords(data.deletedRecords ?? []),
    auditLog: trimAuditLogEntries([entry, ...data.auditLog]),
  };
}

function isDeletedRecordExpired(record: DeletedRecord, nowMs = Date.now()) {
  const expiresAt = new Date(record.expiresAt).getTime();

  return Number.isFinite(expiresAt) && expiresAt <= nowMs;
}

function purgeExpiredDeletedRecords(records: DeletedRecord[]) {
  const nowMs = Date.now();

  return records.filter((record) => !isDeletedRecordExpired(record, nowMs));
}

function normalizeDeletedRecord(value: unknown): DeletedRecord | null {
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;

  if (!raw) {
    return null;
  }

  const type =
    raw.type === "Inventory" || raw.type === "Vendor" || raw.type === "Location"
      ? (raw.type as DeletedRecordType)
      : null;

  if (!type) {
    return null;
  }

  const payloadRecord =
    raw.payload &&
    typeof raw.payload === "object" &&
    !Array.isArray(raw.payload)
      ? (raw.payload as Record<string, unknown>)
      : {};
  const payload =
    type === "Inventory"
      ? normalizeItem(payloadRecord)
      : type === "Vendor"
        ? normalizeVendor(payloadRecord)
        : normalizeLocation(payloadRecord);
  const deletedAt = stringValue(raw.deletedAt) || nowIso();
  const deletedAtMs = new Date(deletedAt).getTime();
  const fallbackExpiresAt = new Date(
    (Number.isFinite(deletedAtMs) ? deletedAtMs : Date.now()) +
      TRASH_RETENTION_MS,
  ).toISOString();

  return {
    id: stringValue(raw.id, createId()),
    originalId: stringValue(raw.originalId, payload.id),
    type,
    title: stringValue(raw.title, payload.name),
    details: stringValue(raw.details),
    deletedAt,
    expiresAt: stringValue(raw.expiresAt, fallbackExpiresAt),
    actor: stringValue(raw.actor, "User"),
    payload,
  };
}

function stampData(data: AppData): AppData {
  return {
    ...data,
    auditLog: trimAuditLogEntries(data.auditLog),
    stockChanges: trimStockChangeEntries(data.stockChanges),
    version: APP_VERSION,
    lastSavedAt: nowIso(),
  };
}

function getLocationName(data: AppData, id: string) {
  return (
    data.locations.find((location) => location.id === id)?.name || "Unassigned"
  );
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
    case "Order As Needed":
      return "tag-non-stocked";
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
    case "Order As Needed":
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
    case "Order As Needed":
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
    case "Order As Needed":
      return "stock-quantity-in-stock";
  }
}

function normalizeExternalUrl(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function getItemUrlHref(value: string) {
  return normalizeInventoryItemUrl(value);
}

function getExternalHref(value: string) {
  return getItemUrlHref(value);
}

function normalizeImageDataUrl(value: unknown) {
  const dataUrl = stringValue(value).trim();

  if (!/^data:image\/(?:png|jpe?g|webp);base64,/i.test(dataUrl)) {
    return "";
  }

  return dataUrl;
}

function isAllowedImageFile(file: File) {
  const type = file.type.trim().toLowerCase();
  return (
    (type && ITEM_IMAGE_ALLOWED_TYPES.has(type)) ||
    ITEM_IMAGE_ALLOWED_EXTENSION.test(file.name)
  );
}

function loadImageElement(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not read this image file."));
    image.src = src;
  });
}

async function resizeItemImageToDataUrl(file: File) {
  if (!isAllowedImageFile(file)) {
    throw new Error("Choose a PNG, JPG, JPEG, or WEBP image.");
  }

  if (file.size > ITEM_IMAGE_MAX_FILE_SIZE_BYTES) {
    throw new Error("Image file must be 8 MB or smaller.");
  }

  const sourceUrl = URL.createObjectURL(file);

  try {
    const image = await loadImageElement(sourceUrl);
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;

    if (!sourceWidth || !sourceHeight) {
      throw new Error("Could not read this image file.");
    }

    const scale = Math.min(
      1,
      ITEM_IMAGE_MAX_DIMENSION / Math.max(sourceWidth, sourceHeight),
    );
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Image processing is not available.");
    }

    canvas.width = width;
    canvas.height = height;
    context.fillStyle = "#f8fafc";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const dataUrl = canvas.toDataURL("image/jpeg", ITEM_IMAGE_OUTPUT_QUALITY);

    if (dataUrl.length > ITEM_IMAGE_MAX_DATA_URL_LENGTH) {
      throw new Error(
        "Processed image is still too large. Choose a smaller image.",
      );
    }

    return dataUrl;
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

function cleanScanValue(value: string) {
  return value.trim();
}

function getScanUrlHref(value: string) {
  const trimmed = cleanScanValue(value);

  if (!trimmed || !/^https?:\/\//i.test(trimmed)) {
    return "";
  }

  return getItemUrlHref(trimmed);
}

function getScanSuggestedTarget(value: string): ScanApplyTarget {
  return getScanUrlHref(value) ? "itemUrl" : "partNumber";
}

function getFormQrCodeValue(
  form: Pick<ItemFormState, "barcodePlaceholder" | "partNumber" | "name">,
  itemId?: string | null,
) {
  const manualValue = form.barcodePlaceholder.trim();

  if (manualValue) {
    return manualValue;
  }

  if (itemId) {
    return `${QR_ITEM_PREFIX}${itemId}`;
  }

  return form.partNumber.trim() || form.name.trim();
}

function getInventoryItemQrValue(item: InventoryItem) {
  return (
    item.barcodePlaceholder.trim() ||
    (item.id
      ? `${QR_ITEM_PREFIX}${item.id}`
      : item.partNumber.trim() || item.name.trim())
  );
}

function normalizeLookupValue(value: string) {
  return value.trim().toLowerCase();
}

function findItemsByScannedValue(items: InventoryItem[], scanValue: string) {
  const value = cleanScanValue(scanValue);
  const normalized = normalizeLookupValue(value);

  if (!normalized) {
    return [];
  }

  if (normalized.startsWith(QR_ITEM_PREFIX.toLowerCase())) {
    const itemId = value.slice(QR_ITEM_PREFIX.length).trim();
    return itemId ? items.filter((item) => item.id === itemId) : [];
  }

  const normalizedHref = getItemUrlHref(value).toLowerCase();
  const exactMatches = items.filter((item) => {
    const fields = [
      item.barcodePlaceholder,
      item.partNumber,
      item.name,
      item.itemUrl,
    ]
      .map((field) => normalizeLookupValue(field))
      .filter(Boolean);
    const itemHref = getItemUrlHref(item.itemUrl).toLowerCase();

    return (
      fields.includes(normalized) ||
      (normalizedHref && itemHref === normalizedHref)
    );
  });

  if (exactMatches.length > 0) {
    return exactMatches;
  }

  return items.filter((item) =>
    [item.barcodePlaceholder, item.partNumber, item.name, item.itemUrl]
      .map((field) => normalizeLookupValue(field))
      .filter(Boolean)
      .some((field) => field.includes(normalized)),
  );
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
    const path =
      parsed.pathname && parsed.pathname !== "/"
        ? parsed.pathname.replace(/\/$/, "")
        : "";

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

async function readVendorWebsitePreview(
  website: string,
): Promise<WebsitePreview | null> {
  const trimmedWebsite = website.trim();

  if (!trimmedWebsite) {
    return null;
  }

  const invoke = getTauriInvoke();

  if (!invoke) {
    return null;
  }

  try {
    return await invoke<WebsitePreview>("fetch_website_preview", {
      url: trimmedWebsite,
    });
  } catch {
    return null;
  }
}

type VendorNoteContext = Pick<
  VendorRecord,
  "name" | "website" | "email" | "contactName" | "contactEmail" | "notes"
>;

function vendorFormNoteContext(form: VendorFormState): VendorNoteContext {
  return {
    name: form.name,
    website: form.website,
    email: form.email,
    contactName: form.contactName,
    contactEmail: form.contactEmail,
    notes: form.notes,
  };
}

function vendorRecordNoteContext(
  vendor: VendorRecord,
  notes = vendor.notes,
): VendorNoteContext {
  return {
    name: vendor.name,
    website: vendor.website,
    email: vendor.email,
    contactName: vendor.contactName,
    contactEmail: vendor.contactEmail,
    notes,
  };
}

function suggestVendorNoteFromContext({
  userPurpose,
  vendor,
  websitePreview,
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
    userPurpose,
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

  if (
    /sensor|automation|keyence|sick|ifm|banner|omron|photoeye|proximity|prox/.test(
      source,
    )
  ) {
    return "Sensors, automation, and machine control components.";
  }

  if (
    /hydraulic|hose|parker|gates|fluid power|cylinder|seal|fitting/.test(source)
  ) {
    return "Hydraulic hoses, fittings, seals, cylinders, and fluid power parts.";
  }

  if (
    /pneumatic|smc|festo|air|valve|solenoid|regulator|cylinder/.test(source)
  ) {
    return "Pneumatic fittings, valves, cylinders, regulators, and air components.";
  }

  if (
    /electrical|fuse|wire|cable|controls|relay|breaker|terminal|panel|contactor/.test(
      source,
    )
  ) {
    return "Electrical controls, wiring, fuses, terminals, relays, and panel components.";
  }

  if (/bearing|belt|motion|drive|pulley|gearbox|chain|sprocket/.test(source)) {
    return "Bearings, belts, power transmission, and mechanical drive parts.";
  }

  if (
    /heater|thermocouple|temperature|temp|cartridge heater|band heater|controller/.test(
      source,
    )
  ) {
    return "Heaters, thermocouples, and temperature control parts.";
  }

  if (
    /mold|tooling|injection|ejector|nozzle|barrel|screw|plunger/.test(source)
  ) {
    return "Injection molding tooling, machine components, and mold support parts.";
  }

  if (/vacuum|ejector|gripper|emi|robot|eoat|end of arm/.test(source)) {
    return "Robot EOAT, vacuum components, grippers, and automation support parts.";
  }

  return "";
}

function suggestVendorNote(vendor: VendorNoteContext) {
  return (
    suggestVendorNoteFromContext({ vendor }) ||
    "Supplier used for maintenance parts and shop support. Review and adjust as needed."
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
    [/\bai\b/gi, "AI"],
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
    [
      /^sensors?,?\s*fuses?,?\s*wiring\.?$/i,
      "Sensors, fuses, wiring, and electrical maintenance parts.",
    ],
    [/^hydraulic,?\s*hoses?\.?$/i, "Hydraulic hoses and fittings."],
    [/^pneumatic,?\s*fittings?\.?$/i, "Pneumatic fittings and air components."],
    [
      /^heater,?\s*thermocouples?\.?$/i,
      "Heaters, thermocouples, and temperature control parts.",
    ],
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

function getSaveHealthRows(
  data: AppData,
  backupSupported: boolean,
  lastBackupAt: string | null,
  lastAutoImportAt: string | null,
  backupIndicator: BackupIndicatorState,
  backupMessage: string,
  liveStorageLabel = "IndexedDB",
): SaveHealthRow[] {
  const hasBackupFolder = Boolean(
    data.settings.backupDirectoryName ||
    data.settings.backupDirectoryPath ||
    data.settings.backupDirectoryHandle,
  );
  const failed = backupIndicator === "failed";
  const failureMessage = backupMessage.toLowerCase();
  const saveFailed =
    failed &&
    (failureMessage.includes("save") ||
      failureMessage.includes("load") ||
      failureMessage.includes("local"));
  const backupFailed = failed && !saveFailed;
  const folderAccessFailed =
    failed &&
    /permission|denied|folder access|choose the folder again/i.test(
      backupMessage,
    );
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
  const latestBackupAt =
    lastBackupAt || data.settings.lastBackupTimestamp || null;
  const latestAutoImportAt =
    lastAutoImportAt || data.settings.lastAutoImportTimestamp || null;
  const backupStatusText = data.settings.backupStatus || backupMessage;
  const backupStatusTone: HealthTone = failed
    ? "danger"
    : /choose backup folder|not selected|not checked|not backed|no backup/i.test(
          backupStatusText,
        )
      ? "warning"
      : "good";

  return [
    {
      label: liveStorageLabel,
      tone: saveFailed ? "danger" : "good",
      value: saveFailed
        ? backupMessage
        : `Saved ${formatDateTime(data.lastSavedAt)}`,
    },
    {
      label: "Auto JSON",
      tone: autoJsonTone,
      value: autoJsonValue,
    },
    {
      label: "Backup folder",
      tone: hasBackupFolder ? "good" : "warning",
      value: data.settings.backupDirectoryName || "No backup folder selected",
    },
    {
      label: "Last backup",
      tone: backupFailed ? "danger" : latestBackupAt ? "good" : "warning",
      value: backupFailed
        ? backupMessage
        : latestBackupAt
          ? formatDateTime(latestBackupAt)
          : "No backup has run yet",
    },
    {
      label: "Auto import",
      tone:
        data.settings.autoImportEnabled && latestAutoImportAt
          ? "good"
          : "warning",
      value: data.settings.autoImportEnabled
        ? latestAutoImportAt
          ? `Last checked ${formatDateTime(latestAutoImportAt)}`
          : "On; not checked yet"
        : "Off",
    },
    {
      label: "Folder access",
      tone: folderAccessFailed
        ? "danger"
        : backupSupported && hasBackupFolder
          ? "good"
          : "warning",
      value: folderAccessFailed
        ? "Permission missing"
        : backupSupported
          ? hasBackupFolder
            ? "Granted"
            : "Supported; choose folder"
          : "Manual export only",
    },
    {
      label: "Backup status",
      tone: backupStatusTone,
      value: failed ? backupMessage : backupStatusText,
    },
  ];
}

function getOverallHealthTone(rows: SaveHealthRow[]): HealthTone {
  if (rows.some((row) => row.tone === "danger")) {
    return "danger";
  }

  return rows.some((row) => row.tone === "warning") ? "warning" : "good";
}

function statusLineToneClass(tone: HealthTone) {
  return `status-line status-line-${tone}`;
}

function statusPillClass(tone: HealthTone) {
  return `settings-status-pill settings-status-pill-${tone}`;
}

function statusCardClass(tone: HealthTone) {
  return `settings-health-card settings-health-card-${tone}`;
}

function toneFromStatusMessage(
  message: string,
  fallback: HealthTone = "warning",
): HealthTone {
  const normalized = message.toLowerCase();

  if (/failed|failure|error|denied|invalid|could not/i.test(normalized)) {
    return "danger";
  }

  if (
    /choose|missing|not found|not checked|no .*yet|needed|warning|unavailable/i.test(
      normalized,
    )
  ) {
    return "warning";
  }

  if (
    /active|saved|selected|complete|completed|updated|granted|up to date|opened|found/i.test(
      normalized,
    )
  ) {
    return "good";
  }

  return fallback;
}

function getSaveHealthSummary(rows: SaveHealthRow[]): SettingsStatusSummary {
  const tone = getOverallHealthTone(rows);
  const problemRow = rows.find((row) => row.tone === tone);

  if (tone === "danger") {
    return {
      helper:
        problemRow?.value ?? "A local save or backup error needs attention.",
      label: "Error",
      tone,
    };
  }

  if (tone === "warning") {
    const needsFolder = rows.some(
      (row) =>
        row.tone === "warning" &&
        /backup folder|folder access/i.test(row.label),
    );

    return {
      helper: needsFolder
        ? "Choose or verify the backup folder."
        : (problemRow?.value ?? "Backup needs attention."),
      label: needsFolder ? "Needs folder" : "Backup warning",
      tone,
    };
  }

  return {
    helper: "Local save, folder access, and backup status are healthy.",
    label: "Healthy",
    tone,
  };
}

function getSaveHealthHelper(label: string) {
  switch (label) {
    case "Backend API":
      return "Website SQLite API";
    case "IndexedDB":
      return "Local app data";
    case "Auto JSON":
      return "Backup schedule";
    case "Backup folder":
      return "Selected folder";
    case "Last backup":
      return "Latest JSON backup";
    case "Auto import":
      return "Startup backup check";
    case "Folder access":
      return "Desktop folder permission";
    case "Backup status":
      return "Current backup message";
    default:
      return "Status";
  }
}

function getUpdateStatusSummary(
  updateStatus: string,
  updateCheck: ManualInstallerCheckResult | null,
): SettingsStatusSummary {
  const tone = toneFromStatusMessage(updateStatus);

  if (updateCheck?.newerInstaller) {
    return {
      helper: `Newest installer: v${updateCheck.newerInstaller.version}`,
      label: "Update available",
      tone: "warning",
    };
  }

  if (/up to date/i.test(updateStatus)) {
    return {
      helper: "The newest local installer is not newer than this app.",
      label: "Up to date",
      tone: "good",
    };
  }

  if (/not found|choose|needed/i.test(updateStatus)) {
    return {
      helper: updateStatus,
      label: "Folder needed",
      tone: "warning",
    };
  }

  if (tone === "danger") {
    return {
      helper: updateStatus,
      label: "Error",
      tone,
    };
  }

  return {
    helper: updateStatus,
    label: tone === "good" ? "Ready" : "Folder needed",
    tone,
  };
}

function getUpdateLastCheckTone(
  lastUpdateCheckAt: string,
  updateStatus: string,
): HealthTone {
  if (!lastUpdateCheckAt) {
    return "warning";
  }

  return toneFromStatusMessage(updateStatus) === "danger" ? "danger" : "good";
}

function getRecentAddAlerts(data: AppData, nowMs: number): RecentAddAlert[] {
  return data.auditLog
    .filter((entry) => {
      const occurredAt = new Date(entry.occurredAt).getTime();

      if (
        !Number.isFinite(occurredAt) ||
        nowMs - occurredAt > RECENT_ACTIVITY_WINDOW_MS
      ) {
        return false;
      }

      return (
        (entry.entityType === "Item" &&
          entry.action.includes("Item Created")) ||
        (entry.entityType === "Vendor" &&
          entry.action.includes("Vendor Created"))
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
        label:
          entry.entityType === "Vendor" ? "New vendor added" : "New item added",
        name: name || entry.summary || entry.entityType,
        occurredAt: entry.occurredAt,
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
  const hasAny = (...names: string[]) =>
    headers.some((header) => names.includes(header));
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
  const headerRowIndex = rows.findIndex(
    (row) => getCsvHeaderScore(row.map(normalizeCsvHeader)) >= 4,
  );

  if (headerRowIndex < 0) {
    throw new Error(
      "Could not find a CSV header row with part, description, vendor, quantity, or cost columns.",
    );
  }

  return headerRowIndex;
}

function buildCsvColumnIndexes(headerRow: string[]): CsvColumnIndexes {
  const headers = headerRow.map(normalizeCsvHeader);
  const indexOf = (...names: string[]) =>
    headers.findIndex((header) => names.includes(header));

  return {
    asset: indexOf("asset", "assetname", "equipment"),
    category: indexOf("category", "type"),
    cost: indexOf("costeach", "unitcost", "unitprice", "price", "cost"),
    dept: indexOf("dept", "department"),
    description: indexOf("description", "desc"),
    itemUrl: indexOf(
      "itemurl",
      "url",
      "link",
      "hyperlink",
      "partinfourl",
      "hyperlinkpartinfourl",
      "website",
    ),
    location: indexOf("location", "locationname"),
    lowStockAlert: indexOf(
      "lowstockalertlevel",
      "lowstockalert",
      "alertlevel",
      "stockalertlevel",
      "warningstocklevel",
      "warninglevel",
    ),
    minimum: indexOf(
      "minimumstocklevel",
      "minimumstock",
      "minimum",
      "minstock",
      "min",
    ),
    name: indexOf("itemname", "name", "partname"),
    notes: indexOf("notes", "note", "comments", "comment"),
    partNumber: indexOf("partnumber", "partno", "partnum", "part"),
    quantity: indexOf("quantityonhand", "quantity", "qty", "onhand", "qoh"),
    stockUnit: indexOf("stockunit", "quantityunit", "unit", "uom"),
    vendor: indexOf("vendor", "vendorname", "supplier"),
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
  return /\b(row|bin|shelf|cabinet|crib|rack|aisle|bay|slot|drawer|line|cart|station)\b|\d/i.test(
    value,
  );
}

function chooseCsvLocationName(dept: string, location: string) {
  if (dept && isUsefulDeptLocation(dept)) {
    return dept;
  }

  return location || dept;
}

function toCsvImportRecord(
  row: string[],
  indexes: CsvColumnIndexes,
): CsvImportRecord | null {
  const cell = (index: number) => (index >= 0 ? cleanCsvText(row[index]) : "");
  const partNumber = cell(indexes.partNumber);
  const description = cell(indexes.description);
  const name = cell(indexes.name) || deriveCsvItemName(description, partNumber);
  const asset = cell(indexes.asset);
  const notes = [cell(indexes.notes), asset ? `Asset: ${asset}` : ""]
    .filter(Boolean)
    .join(" | ");

  if (
    ![
      name,
      partNumber,
      description,
      cell(indexes.vendor),
      cell(indexes.location),
      cell(indexes.dept),
    ].some(Boolean)
  ) {
    return null;
  }

  return {
    category: cell(indexes.category),
    costEach: csvNumberValue(cell(indexes.cost)),
    description,
    itemUrl: cell(indexes.itemUrl),
    locationName: chooseCsvLocationName(
      cell(indexes.dept),
      cell(indexes.location),
    ),
    lowStockAlertLevel: csvNumberValue(cell(indexes.lowStockAlert)),
    minimumStockLevel: csvNumberValue(cell(indexes.minimum)),
    name: name || partNumber,
    notes,
    partNumber,
    quantityOnHand: csvNumberValue(cell(indexes.quantity)),
    stockUnit: normalizeStockUnit(cell(indexes.stockUnit)),
    vendorName: cell(indexes.vendor),
  };
}

function getItemImportKey(item: Pick<InventoryItem, "name" | "partNumber">) {
  const partNumber = item.partNumber.trim().toLowerCase();
  return partNumber
    ? `part:${partNumber}`
    : `name:${item.name.trim().toLowerCase()}`;
}

function buildCsvImportPreview(
  contents: string,
  data: AppData,
  fileName: string,
): CsvImportPreview {
  const rows = parseCsv(contents);

  if (rows.length < 2) {
    throw new Error("CSV file has no inventory rows.");
  }

  const headerRowIndex = findCsvHeaderRow(rows);
  const indexes = buildCsvColumnIndexes(rows[headerRowIndex]);
  const records = rows
    .slice(headerRowIndex + 1)
    .map((row) => toCsvImportRecord(row, indexes))
    .filter((record): record is CsvImportRecord =>
      Boolean(record && (record.name || record.partNumber)),
    );

  if (records.length === 0) {
    throw new Error("CSV file has no importable inventory rows.");
  }

  const existingItemKeys = new Set(data.items.map(getItemImportKey));
  const existingVendors = new Set(
    data.vendors
      .map((vendor) => vendor.name.trim().toLowerCase())
      .filter(Boolean),
  );
  const existingLocations = new Set(
    data.locations
      .map((location) => location.name.trim().toLowerCase())
      .filter(Boolean),
  );
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
    if (
      vendorKey &&
      !existingVendors.has(vendorKey) &&
      !vendorsToCreate.has(vendorKey)
    ) {
      vendorsToCreate.set(vendorKey, record.vendorName);
    }

    const locationKey = record.locationName.trim().toLowerCase();
    if (
      locationKey &&
      !existingLocations.has(locationKey) &&
      !locationsToCreate.has(locationKey)
    ) {
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
    vendorsToCreate: Array.from(vendorsToCreate.values()),
  };
}

function csvRowsToRecords(contents: string) {
  const rows = parseCsv(contents);

  if (rows.length < 2) {
    return [];
  }

  const headers = rows[0].map(normalizeCsvHeader);

  return rows
    .slice(1)
    .map((row) => {
      const record: Record<string, string> = {};

      headers.forEach((header, index) => {
        if (header) {
          record[header] = cleanCsvText(row[index] ?? "");
        }
      });

      return record;
    })
    .filter((record) => Object.values(record).some((value) => value.trim()));
}

function csvCell(record: Record<string, string>, ...names: string[]) {
  for (const name of names) {
    const value = record[normalizeCsvHeader(name)];

    if (value) {
      return value;
    }
  }

  return "";
}

function csvBooleanValue(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  if (["true", "yes", "y", "1", "on"].includes(normalized)) {
    return true;
  }

  if (["false", "no", "n", "0", "off"].includes(normalized)) {
    return false;
  }

  return null;
}

function csvFolderVendorRecord(
  record: Record<string, string>,
): CsvFolderVendorRecord | null {
  const name = csvCell(record, "name", "vendor", "vendorName");

  if (!name) {
    return null;
  }

  const address = csvCell(record, "address", "streetAddress");
  const notes = [
    csvCell(record, "notes", "note", "comments"),
    address ? `Address: ${address}` : "",
  ]
    .filter(Boolean)
    .join(" | ");

  return {
    id: csvCell(record, "id", "vendorId"),
    name,
    contactName: csvCell(record, "contact", "contactName"),
    contactEmail: csvCell(record, "contactEmail"),
    phone: csvCell(record, "phone", "phoneNumber"),
    email: csvCell(record, "email"),
    website: csvCell(record, "website", "url"),
    notes,
    createdAt: csvCell(record, "createdAt"),
    updatedAt: csvCell(record, "updatedAt"),
  };
}

function csvFolderLocationRecord(
  record: Record<string, string>,
): CsvFolderLocationRecord | null {
  const name = csvCell(record, "name", "location", "locationName");

  if (!name) {
    return null;
  }

  const area = csvCell(record, "area");
  const department = csvCell(record, "department", "dept");
  const notes = [
    csvCell(record, "notes", "note", "comments"),
    area ? `Area: ${area}` : "",
    department ? `Department: ${department}` : "",
  ]
    .filter(Boolean)
    .join(" | ");

  return {
    id: csvCell(record, "id", "locationId"),
    name,
    description: csvCell(record, "description", "desc"),
    notes,
    createdAt: csvCell(record, "createdAt"),
    updatedAt: csvCell(record, "updatedAt"),
  };
}

function csvFolderInventoryRecord(
  record: Record<string, string>,
): CsvFolderInventoryRecord | null {
  const partNumber = csvCell(record, "partNumber", "partNo", "part");
  const description = csvCell(record, "description", "desc");
  const name =
    csvCell(record, "itemName", "name") ||
    deriveCsvItemName(description, partNumber);

  if (![name, partNumber, description].some(Boolean)) {
    return null;
  }

  return {
    id: csvCell(record, "id", "itemId"),
    partNumber,
    name: name || partNumber || description,
    description,
    category: csvCell(record, "category", "type"),
    vendorId: csvCell(record, "vendorId"),
    vendorName: csvCell(record, "vendor", "vendorName", "supplier"),
    locationId: csvCell(record, "locationId"),
    locationName: csvCell(record, "location", "locationName"),
    quantityOnHand: csvNumberValue(
      csvCell(
        record,
        "stockOnHand",
        "quantityOnHand",
        "quantity",
        "qty",
        "onHand",
      ),
    ),
    stockUnit: normalizeStockUnit(csvCell(record, "unit", "stockUnit", "uom")),
    minimumStockLevel: csvNumberValue(
      csvCell(record, "minimum", "minimumStockLevel", "minimumStock", "min"),
    ),
    lowStockAlertLevel: csvNumberValue(
      csvCell(
        record,
        "lowAlert",
        "lowStockAlertLevel",
        "lowStockAlert",
        "alertLevel",
      ),
    ),
    costEach: csvNumberValue(
      csvCell(record, "cost", "costEach", "unitCost", "unitPrice"),
    ),
    itemUrl: csvCell(record, "url", "website", "itemUrl", "orderLink", "link"),
    notes: csvCell(record, "notes", "note", "comments"),
    orderPlaced: csvBooleanValue(csvCell(record, "orderPlaced")),
    reorderHold: csvBooleanValue(csvCell(record, "reorderHold")),
    hiddenFromWatchList: csvBooleanValue(csvCell(record, "hiddenFromWatchList", "hidden_from_watchlist")),
    nonStocked: csvBooleanValue(csvCell(record, "nonStocked", "non_stocked", "orderAsNeeded")),
    createdAt: csvCell(record, "createdAt"),
    updatedAt: csvCell(record, "updatedAt"),
  };
}

function nameKey(value: string) {
  return value.trim().toLowerCase();
}

function uniqueRecordByName<T extends { name: string }>(
  records: T[],
  name: string,
) {
  const key = nameKey(name);

  if (!key) {
    return undefined;
  }

  const matches = records.filter((record) => nameKey(record.name) === key);
  return matches.length === 1 ? matches[0] : undefined;
}

function uniqueItemByPartNumber(items: InventoryItem[], partNumber: string) {
  const key = nameKey(partNumber);

  if (!key) {
    return undefined;
  }

  const matches = items.filter((item) => nameKey(item.partNumber) === key);
  return matches.length === 1 ? matches[0] : undefined;
}

function existingVendorMatch(
  record: CsvFolderVendorRecord,
  vendors: VendorRecord[],
) {
  if (record.id) {
    return vendors.find((vendor) => vendor.id === record.id);
  }

  return uniqueRecordByName(vendors, record.name);
}

function existingLocationMatch(
  record: CsvFolderLocationRecord,
  locations: LocationRecord[],
) {
  if (record.id) {
    return locations.find((location) => location.id === record.id);
  }

  return uniqueRecordByName(locations, record.name);
}

function existingInventoryMatch(
  record: CsvFolderInventoryRecord,
  items: InventoryItem[],
) {
  if (record.id) {
    return items.find((item) => item.id === record.id);
  }

  return uniqueItemByPartNumber(items, record.partNumber);
}

function buildCsvFolderImportPreview(
  files: Awaited<ReturnType<typeof readCsvFolderImportFiles>>,
  data: AppData,
  folderPath: string,
): CsvFolderImportPreview {
  if (
    !files.inventory.exists &&
    !files.vendors.exists &&
    !files.locations.exists
  ) {
    throw new Error("No CSV export files were found in the selected folder.");
  }

  const vendorRecords = files.vendors.exists
    ? csvRowsToRecords(files.vendors.contents)
        .map(csvFolderVendorRecord)
        .filter((record): record is CsvFolderVendorRecord => Boolean(record))
    : [];
  const locationRecords = files.locations.exists
    ? csvRowsToRecords(files.locations.contents)
        .map(csvFolderLocationRecord)
        .filter((record): record is CsvFolderLocationRecord => Boolean(record))
    : [];
  const inventoryRecords = files.inventory.exists
    ? csvRowsToRecords(files.inventory.contents)
        .map(csvFolderInventoryRecord)
        .filter((record): record is CsvFolderInventoryRecord => Boolean(record))
    : [];

  return {
    folderPath,
    inventoryFileFound: files.inventory.exists,
    inventoryRecords,
    locationFileFound: files.locations.exists,
    locationRecords,
    newItems: inventoryRecords.filter(
      (record) => !existingInventoryMatch(record, data.items),
    ).length,
    newLocations: locationRecords.filter(
      (record) => !existingLocationMatch(record, data.locations),
    ).length,
    newVendors: vendorRecords.filter(
      (record) => !existingVendorMatch(record, data.vendors),
    ).length,
    updatedItems: inventoryRecords.filter((record) =>
      existingInventoryMatch(record, data.items),
    ).length,
    updatedLocations: locationRecords.filter((record) =>
      existingLocationMatch(record, data.locations),
    ).length,
    updatedVendors: vendorRecords.filter((record) =>
      existingVendorMatch(record, data.vendors),
    ).length,
    vendorFileFound: files.vendors.exists,
    vendorRecords,
  };
}

function itemFromForm(
  form: ItemFormState,
  existing?: InventoryItem,
  forcedItemId?: string,
): InventoryItem {
  const now = nowIso();
  const minimumStockLevel = Math.max(
    0,
    wholeNumberValue(form.minimumStockLevel),
  );
  const lowStockAlertLevel = normalizeLowStockAlertLevel(
    minimumStockLevel,
    form.lowStockAlertLevel,
  );

  return {
    id: existing?.id ?? forcedItemId ?? createId(),
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
    imageDataUrl: normalizeImageDataUrl(form.imageDataUrl),
    barcodePlaceholder: form.barcodePlaceholder.trim(),
    reorderHold: Boolean(form.reorderHold),
    orderPlaced: Boolean(form.orderPlaced),
    hiddenFromWatchList: Boolean(form.hiddenFromWatchList),
    nonStocked: Boolean(form.nonStocked),
    orderRequisitionId: form.orderPlaced ? existing?.orderRequisitionId : "",
    isDemo: existing?.isDemo,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

function getItemFormValidationWarning(
  form: ItemFormState,
  settings: AppSettings,
) {
  if (!form.name.trim()) {
    return "Item name is required.";
  }

  if (
    !settings.allowNegativeStockOverride &&
    wholeNumberValue(form.quantityOnHand) < 0
  ) {
    return "Quantity on hand cannot be negative unless override is enabled in Settings.";
  }

  if (wholeNumberValue(form.minimumStockLevel) < 0) {
    return "Minimum stock level cannot be negative.";
  }

  if (wholeNumberValue(form.lowStockAlertLevel) < 0) {
    return "Low Stock Alert Level cannot be negative.";
  }

  if (numberValue(form.costEach) < 0) {
    return "Cost each cannot be negative.";
  }

  return "";
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
    imageDataUrl: item.imageDataUrl,
    barcodePlaceholder: item.barcodePlaceholder,
    reorderHold: Boolean(item.reorderHold),
    orderPlaced: Boolean(item.orderPlaced),
    hiddenFromWatchList: Boolean(item.hiddenFromWatchList),
    nonStocked: Boolean(item.nonStocked),
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
  const startupStartedAtRef = useRef(Date.now());
  const startupStageTimerRef = useRef<number | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [recoveryEmail, setRecoveryEmail] = useState("");

  function setStartupStage(nextStage: AuthStage) {
    const remainingMs = Math.max(
      0,
      MIN_AUTH_LOADING_MS - (Date.now() - startupStartedAtRef.current),
    );

    if (remainingMs === 0) {
      setStage(nextStage);
      return;
    }

    if (startupStageTimerRef.current !== null) {
      window.clearTimeout(startupStageTimerRef.current);
    }

    startupStageTimerRef.current = window.setTimeout(
      () => setStage(nextStage),
      remainingMs,
    );
  }

  useEffect(
    () => () => {
      if (startupStageTimerRef.current !== null) {
        window.clearTimeout(startupStageTimerRef.current);
      }
    },
    [],
  );
  const [recoveryCode, setRecoveryCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newConfirmPassword, setNewConfirmPassword] = useState("");
  const [shownRecoveryCode, setShownRecoveryCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const websiteAuthMode = showWebsiteModePanel;

  useEffect(() => {
    let isActive = true;

    async function checkAuthState() {
      if (websiteAuthMode) {
        try {
          const status = await getWebsiteAuthStatus();

          if (!isActive) {
            return;
          }

          setStartupStage(
            status.configured
              ? isWebsiteAuthSessionUnlocked()
                ? "ready"
                : "login"
              : "setup",
          );
        } catch (authError) {
          if (!isActive) {
            return;
          }

          setError(
            authError instanceof Error
              ? authError.message
              : "Could not reach backend authentication service. Make sure the website backend is running.",
          );
          setStartupStage("setup");
        }
        return;
      }

      const authRecord = readAuthRecord();

      if (!authRecord) {
        setStartupStage("setup");
      } else {
        setStartupStage(isAuthSessionUnlocked() ? "ready" : "login");
      }
    }

    void checkAuthState();

    return () => {
      isActive = false;
    };
  }, [websiteAuthMode]);

  const startUnlockLoading = () => {
    if (websiteAuthMode) {
      setWebsiteAuthSessionUnlocked();
      setStage("ready");
      return;
    }

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
      if (websiteAuthMode) {
        await setupWebsiteAuth(password, recoveryEmail);
        setPassword("");
        setConfirmPassword("");
        setRecoveryEmail("");
        setStage("ready");
        return;
      }

      const result = await createAuthRecord(password, recoveryEmail);

      setShownRecoveryCode(result.recoveryCode);
      setPassword("");
      setConfirmPassword("");
      setStage("setup-code");
    } catch (setupError) {
      setError(
        setupError instanceof Error
          ? setupError.message
          : "Could not create the local password.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleLoginSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);

    try {
      if (websiteAuthMode) {
        if (!(await loginWebsiteAuth(password))) {
          setError("Password did not match this inventory system.");
          return;
        }

        setPassword("");
        startUnlockLoading();
        return;
      }

      if (!(await verifyPassword(password))) {
        setError("Password did not match this inventory system.");
        return;
      }

      setPassword("");
      startUnlockLoading();
    } catch (loginError) {
      setError(
        loginError instanceof Error
          ? loginError.message
          : "Could not unlock the inventory system.",
      );
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
      setError(
        recoveryError instanceof Error
          ? recoveryError.message
          : "Could not verify the recovery code.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handlePasswordResetSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");

    const validationError = validatePasswordPair(
      newPassword,
      newConfirmPassword,
    );

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
      setError(
        resetError instanceof Error
          ? resetError.message
          : "Could not reset the password.",
      );
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

  const authRecord = websiteAuthMode ? null : readAuthRecord();

  return (
    <main className="auth-shell app-shell min-h-screen p-4 text-slate-100">
      <section className="auth-panel">
        {stage !== "login" && (
          <>
            <div className="auth-brand">
              <AppLogoMark />
              <p className="auth-product-name">MAINTENANCE INVENTORY TRACKER</p>
            </div>
            <div className="auth-security-strip" aria-hidden="true">
              <span>Secure local station</span>
              <span>Protected access</span>
            </div>
          </>
        )}

        {stage === "setup" && (
          <form className="auth-form" onSubmit={handleSetupSubmit}>
            <div>
              <h2>
                {websiteAuthMode
                  ? "Create Shop Password"
                  : "Create Local Password"}
              </h2>
              <p>
                {websiteAuthMode
                  ? "Set the shop password before browser and mobile access opens."
                  : "Set the shop password before the inventory system opens on this device."}
              </p>
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
                placeholder={
                  websiteAuthMode
                    ? "optional recovery contact"
                    : "future email-code recovery"
                }
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
              <p>
                This code is shown one time. Save it before opening the
                inventory system.
              </p>
            </div>
            <div
              className="recovery-code-card"
              aria-label="One-time recovery code"
            >
              {shownRecoveryCode}
            </div>
            <button
              className="btn-primary"
              type="button"
              onClick={startUnlockLoading}
            >
              I Saved This Code
            </button>
          </div>
        )}

        {stage === "login" && (
          <>
            <AccessTerminalPanel />
            <form className="auth-form" onSubmit={handleLoginSubmit}>
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
                  Sign In
                </button>
                {!websiteAuthMode && (
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
                )}
              </div>
            </form>
          </>
        )}

        {stage === "recovery-code" && (
          <form className="auth-form" onSubmit={handleRecoveryCodeSubmit}>
            <div>
              <h2>Password Recovery</h2>
              <p>
                Enter the saved recovery code for this local inventory lock.
              </p>
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
              Email recovery will be added later
              {authRecord?.recoveryEmail
                ? ` for ${authRecord.recoveryEmail}`
                : ""}
              .
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
                  setStartupStage("login");
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
              <p>
                The recovery code matched. Create a new password for this
                device.
              </p>
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
              <p>
                Your password was reset. Save this new recovery code now; the
                previous code no longer works.
              </p>
            </div>
            <div
              className="recovery-code-card"
              aria-label="New one-time recovery code"
            >
              {shownRecoveryCode}
            </div>
            <button
              className="btn-primary"
              type="button"
              onClick={startUnlockLoading}
            >
              I Saved This Code
            </button>
          </div>
        )}
      </section>
    </main>
  );
}

function AccessTerminalPanel() {
  return (
    <div className="access-terminal" aria-label="Maintenance access terminal">
      <div className="access-terminal-mark" aria-hidden="true">
        <span>JBT</span>
        <small>USA</small>
      </div>
      <div className="access-terminal-core">
        <div className="access-terminal-kicker">Access Terminal</div>
        <div className="access-terminal-title">
          Authorized Maintenance Access
        </div>
        <span className="access-terminal-divider" aria-hidden="true" />
      </div>
    </div>
  );
}

function MaintenanceLoadingScreen() {
  const [loadingProgress, setLoadingProgress] = useState(1);

  useEffect(() => {
    const startedAt = Date.now();
    const durationMs = 1000;
    const intervalId = window.setInterval(() => {
      const elapsedMs = Date.now() - startedAt;
      const nextProgress = Math.min(
        100,
        Math.max(1, Math.round((elapsedMs / durationMs) * 100)),
      );

      setLoadingProgress(nextProgress);

      if (nextProgress >= 100) {
        window.clearInterval(intervalId);
      }
    }, 24);

    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <main className="industrial-loading-shell app-shell min-h-screen p-4 text-slate-100">
      <section className="loading-panel" aria-busy="true" aria-live="polite">
        <div className="industrial-loader-card">
          <div className="industrial-loader-grid" aria-hidden="true" />
          <div className="loader-header-row">
            <div>
              <h1>Maintenance Inventory Tracker</h1>
            </div>
          </div>
          <div className="loader-status-row">
            <p>Loading inventory database... {loadingProgress}%</p>
          </div>
          <div
            className="loader-progress-track"
            role="progressbar"
            aria-label="Loading inventory database"
            aria-valuemin={1}
            aria-valuemax={100}
            aria-valuenow={loadingProgress}
          >
            <span style={{ width: `${loadingProgress}%` }} />
          </div>
        </div>
      </section>
    </main>
  );
}

function AppLogoMark() {
  return (
    <span className="tool-mark tool-mark-brand" aria-hidden="true">
      <span>JBT</span>
      <small>USA</small>
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

function ScreensaverModeIcon() {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-hidden="true">
      <path d="M4 5.5h16v10H4z" />
      <path d="M9 19h6" />
      <path d="M12 15.5V19" />
      <path d="M17.3 8.1a3.4 3.4 0 1 0 0 5.8 4.1 4.1 0 0 1 0-5.8z" />
    </svg>
  );
}

function InventoryApp() {
  const [data, setData] = useState<AppData | null>(null);
  const [activePage, setActivePage] = useState<PageId>("dashboard");
  const [isChromeCollapsed, setIsChromeCollapsed] = useState(false);
  const [isDashboardScreensaverActive, setIsDashboardScreensaverActive] =
    useState(false);
  const [isManualScreensaverActive, setIsManualScreensaverActive] =
    useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [backupIndicator, setBackupIndicator] =
    useState<BackupIndicatorState>("saved");
  const [backupMessage, setBackupMessage] = useState("Loading local data");
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [lastAutoImportAt, setLastAutoImportAt] = useState<string | null>(null);
  const [newRecoveryCode, setNewRecoveryCode] = useState("");
  const [activityNow, setActivityNow] = useState(() => Date.now());
  const [isAddLocationOpen, setIsAddLocationOpen] = useState(false);
  const [isAddVendorOpen, setIsAddVendorOpen] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [backupDialog, setBackupDialog] = useState<BackupDialogState | null>(
    null,
  );
  const [manualUpdateNotice, setManualUpdateNotice] =
    useState<ManualInstallerCheckResult | null>(null);
  const [websiteUpdateStatus, setWebsiteUpdateStatus] =
    useState<WebsiteUpdateStatus | null>(null);
  const [websiteUpdateMessage, setWebsiteUpdateMessage] = useState("");
  const [isCheckingWebsiteUpdate, setIsCheckingWebsiteUpdate] = useState(false);
  const [isStartingWebsiteUpdate, setIsStartingWebsiteUpdate] = useState(false);
  const [isWebsiteUpdateRestarting, setIsWebsiteUpdateRestarting] =
    useState(false);
  const [websiteUpdateRestartMessage, setWebsiteUpdateRestartMessage] =
    useState("");
  const [websiteUpdateRunStatus, setWebsiteUpdateRunStatus] =
    useState<WebsiteUpdateRunStatus | null>(null);
  const [websiteUpdateLogText, setWebsiteUpdateLogText] = useState("");
  const [isLoadingWebsiteUpdateLog, setIsLoadingWebsiteUpdateLog] =
    useState(false);
  const [websiteBackupStatus, setWebsiteBackupStatus] =
    useState<WebsiteBackupStatus | null>(null);
  const [isRunningWebsiteBackup, setIsRunningWebsiteBackup] = useState(false);
  const [remindedLaterUpdateSha, setRemindedLaterUpdateSha] = useState(() =>
    readWebsiteUpdateRemindLaterSha(),
  );
  const [csvImportPreview, setCsvImportPreview] =
    useState<CsvImportPreview | null>(null);
  const [csvFolderImportPreview, setCsvFolderImportPreview] =
    useState<CsvFolderImportPreview | null>(null);
  const [csvFolderStatus, setCsvFolderStatus] = useState(
    "Choose a CSV folder to enable folder export/import.",
  );
  const [labelPreviewItem, setLabelPreviewItem] =
    useState<InventoryItem | null>(null);
  const [itemForm, setItemForm] = useState<ItemFormState>(blankItemForm());
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [isItemFormOpen, setIsItemFormOpen] = useState(false);
  const [isCategoryManagerOpen, setIsCategoryManagerOpen] = useState(false);
  const [pendingNewItemVisibilityForm, setPendingNewItemVisibilityForm] =
    useState<ItemFormState | null>(null);
  const [watchListVisibilityItemId, setWatchListVisibilityItemId] = useState<
    string | null
  >(null);
  const [stockForm, setStockForm] = useState<StockFormState>(blankStockForm());
  const [locationForm, setLocationForm] =
    useState<LocationFormState>(blankLocationForm());
  const [vendorForm, setVendorForm] =
    useState<VendorFormState>(blankVendorForm());
  const [editingVendorId, setEditingVendorId] = useState<string | null>(null);
  const [vendorAiPrompt, setVendorAiPrompt] =
    useState<VendorAiPromptState | null>(null);
  const [vendorAiPromptText, setVendorAiPromptText] = useState("");
  const [recentlySavedVendorNoteId, setRecentlySavedVendorNoteId] = useState<
    string | null
  >(null);
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(
    null,
  );
  const [inventoryRequisitionLaunch, setInventoryRequisitionLaunch] = useState<{
    id: string;
    itemIds: string[];
  } | null>(null);
  const [inventoryColumnFilters, setInventoryColumnFilters] =
    useState<InventoryColumnFilters>(() => blankInventoryColumnFilters());
  const [statusFilter, setStatusFilter] = useState<"All" | InventoryStatus>(
    "All",
  );
  const [isEditingHeaderBadge, setIsEditingHeaderBadge] = useState(false);
  const [headerBadgeDraft, setHeaderBadgeDraft] = useState(
    DEFAULT_HEADER_BADGE_TEXT,
  );
  const [newestAddedInventoryItemId, setNewestAddedInventoryItemId] = useState<
    string | null
  >(null);
  const [newInventoryItemHighlightIds, setNewInventoryItemHighlightIds] =
    useState<string[]>([]);
  const [newLocationNoticeIds, setNewLocationNoticeIds] = useState<string[]>(
    () => readNoticeIds(NEW_LOCATION_NOTICE_IDS_KEY),
  );
  const [seenLocationNoticeIds, setSeenLocationNoticeIds] = useState<string[]>(
    () => readNoticeIds(SEEN_LOCATION_NOTICE_IDS_KEY),
  );
  const [newVendorNoticeIds, setNewVendorNoticeIds] = useState<string[]>(() =>
    readNoticeIds(NEW_VENDOR_NOTICE_IDS_KEY),
  );
  const [seenVendorNoticeIds, setSeenVendorNoticeIds] = useState<string[]>(() =>
    readNoticeIds(SEEN_VENDOR_NOTICE_IDS_KEY),
  );
  const hasLoadedRef = useRef(false);
  const startupBackupCheckRef = useRef(false);
  const startupManualUpdateCheckRef = useRef(false);
  const startupWebsiteUpdateCheckRef = useRef(false);
  const setupPromptDismissedRef = useRef(false);
  const suppressNextAutoBackupRef = useRef(false);
  const pendingTimedBackupRef = useRef(false);
  const csvHistoryAutoExportBootstrappedRef = useRef(false);
  const csvHistoryAutoExportSignatureRef = useRef("");
  const csvHistoryAutoExportTimeoutRef = useRef<number | null>(null);
  const latestDataRef = useRef<AppData | null>(null);
  const sqliteInventoryMirrorSignatureRef = useRef("");
  const sqliteStockLedgerMirrorSignatureRef = useRef("");
  const sqliteRequisitionMirrorSignatureRef = useRef("");
  const sqliteTrashMirrorSignatureRef = useRef("");
  const sqliteSettingsMirrorSignatureRef = useRef("");
  const sqliteHealthCheckLoggedRef = useRef(false);
  const sqliteVendorLocationMirrorSignatureRef = useRef("");
  const skipHeaderBadgeSaveRef = useRef(false);
  const vendorAiPromptResolveRef = useRef<
    ((note: string | null) => void) | null
  >(null);

  const addNewLocationNotices = useCallback((locationIds: string[]) => {
    if (locationIds.length === 0) {
      return;
    }

    setNewLocationNoticeIds((current) =>
      mergeNoticeIds(current, locationIds),
    );
  }, []);

  const addNewVendorNotices = useCallback((vendorIds: string[]) => {
    if (vendorIds.length === 0) {
      return;
    }

    setNewVendorNoticeIds((current) => mergeNoticeIds(current, vendorIds));
  }, []);

  const unseenNewLocationNoticeIds = useMemo(
    () =>
      newLocationNoticeIds.filter(
        (id) => !seenLocationNoticeIds.includes(id),
      ),
    [newLocationNoticeIds, seenLocationNoticeIds],
  );
  const unseenNewVendorNoticeIds = useMemo(
    () =>
      newVendorNoticeIds.filter((id) => !seenVendorNoticeIds.includes(id)),
    [newVendorNoticeIds, seenVendorNoticeIds],
  );

  useEffect(() => {
    saveNoticeIds(NEW_LOCATION_NOTICE_IDS_KEY, newLocationNoticeIds);
  }, [newLocationNoticeIds]);

  useEffect(() => {
    saveNoticeIds(SEEN_LOCATION_NOTICE_IDS_KEY, seenLocationNoticeIds);
  }, [seenLocationNoticeIds]);

  useEffect(() => {
    saveNoticeIds(NEW_VENDOR_NOTICE_IDS_KEY, newVendorNoticeIds);
  }, [newVendorNoticeIds]);

  useEffect(() => {
    saveNoticeIds(SEEN_VENDOR_NOTICE_IDS_KEY, seenVendorNoticeIds);
  }, [seenVendorNoticeIds]);

  useEffect(() => {
    if (activePage !== "locations" || unseenNewLocationNoticeIds.length === 0) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setSeenLocationNoticeIds((current) =>
        mergeNoticeIds(current, unseenNewLocationNoticeIds),
      );
    }, 1400);

    return () => window.clearTimeout(timeout);
  }, [activePage, unseenNewLocationNoticeIds]);

  useEffect(() => {
    if (activePage !== "vendors" || unseenNewVendorNoticeIds.length === 0) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setSeenVendorNoticeIds((current) =>
        mergeNoticeIds(current, unseenNewVendorNoticeIds),
      );
    }, 1400);

    return () => window.clearTimeout(timeout);
  }, [activePage, unseenNewVendorNoticeIds]);

  useEffect(() => {
    let cancelled = false;

    loadAppData()
      .then(async (savedData) => {
        if (cancelled) {
          return;
        }

        const savedDataRecord =
          savedData &&
          typeof savedData === "object" &&
          !Array.isArray(savedData)
            ? (savedData as Record<string, unknown>)
            : {};
        const shouldPersistWatchListDefaultsMigration =
          shouldApplyWatchListDefaultsMigration(savedData);
        const normalized = normalizeAppData(savedData);
        const normalizedData = {
          ...normalized,
          deletedRecords: purgeExpiredDeletedRecords(
            (Array.isArray(savedDataRecord.deletedRecords)
              ? savedDataRecord.deletedRecords
              : (normalized.deletedRecords ?? [])
            )
              .map(normalizeDeletedRecord)
              .filter(Boolean) as DeletedRecord[],
          ),
        };
        let loadedData = shouldPersistWatchListDefaultsMigration
          ? stampData(normalizedData)
          : normalizedData;

        try {
          const sqliteState = await activateVendorLocationSqliteState(
            loadedData.vendors,
            loadedData.locations,
          );

          if (cancelled) {
            return;
          }

          if (!sqliteState.skipped) {
            loadedData = {
              ...loadedData,
              locations: sqliteState.locations,
              vendors: sqliteState.vendors,
            };

            if (import.meta.env.DEV) {
              console.info("[sqlite-vendor-location-mirror]", sqliteState);
            }
          }
        } catch (error) {
          if (cancelled) {
            return;
          }

          if (import.meta.env.DEV) {
            console.warn(
              "[sqlite-vendor-location-mirror] Vendor/location SQLite activation failed. JSON remains available.",
              error,
            );
          }
        }

        const inventorySqliteState = await activateInventorySqliteState(
          loadedData.items,
        );

        if (cancelled) {
          return;
        }

        if (inventorySqliteState.sqliteAvailable) {
          loadedData = {
            ...loadedData,
            items: inventorySqliteState.items,
          };

          if (import.meta.env.DEV) {
            console.info("[sqlite-inventory-mirror]", inventorySqliteState);
          }
        } else if (inventorySqliteState.error && import.meta.env.DEV) {
          console.warn(
            "[sqlite-inventory-mirror] Inventory SQLite activation failed. JSON inventory remains available.",
            inventorySqliteState.error,
          );
        }

        const stockLedgerSqliteState = await activateStockLedgerSqliteState(
          loadedData.stockChanges,
        );

        if (cancelled) {
          return;
        }

        if (stockLedgerSqliteState.sqliteAvailable) {
          loadedData = {
            ...loadedData,
            stockChanges: stockLedgerSqliteState.records,
          };

          if (import.meta.env.DEV) {
            console.info(
              "[sqlite-stock-ledger-mirror]",
              stockLedgerSqliteState,
            );
          }
        } else if (stockLedgerSqliteState.error && import.meta.env.DEV) {
          console.warn(
            "[sqlite-stock-ledger-mirror] Stock ledger SQLite activation failed. JSON history remains available.",
            stockLedgerSqliteState.error,
          );
        }

        const requisitionSqliteState = await activateRequisitionSqliteState(
          loadedData.requisitionMadeRecords,
        );

        if (cancelled) {
          return;
        }

        if (requisitionSqliteState.sqliteAvailable) {
          loadedData = {
            ...loadedData,
            requisitionMadeRecords: requisitionSqliteState.records,
          };

          if (import.meta.env.DEV) {
            console.info("[sqlite-requisition-mirror]", requisitionSqliteState);
          }
        } else if (requisitionSqliteState.error && import.meta.env.DEV) {
          console.warn(
            "[sqlite-requisition-mirror] Requisition SQLite activation failed. JSON requisitions remain available.",
            requisitionSqliteState.error,
          );
        }

        const trashSqliteState = await activateTrashSqliteState(
          loadedData.deletedRecords ?? [],
        );

        if (cancelled) {
          return;
        }

        if (trashSqliteState.sqliteAvailable) {
          loadedData = {
            ...loadedData,
            deletedRecords: purgeExpiredDeletedRecords(
              trashSqliteState.records,
            ),
          };

          if (import.meta.env.DEV) {
            console.info("[sqlite-trash-mirror]", trashSqliteState);
          }
        } else if (trashSqliteState.error && import.meta.env.DEV) {
          console.warn(
            "[sqlite-trash-mirror] Trash SQLite activation failed. JSON trash remains available.",
            trashSqliteState.error,
          );
        }

        const settingsSqliteState = await activateAppSettingsSqliteState(
          loadedData.settings,
        );

        if (cancelled) {
          return;
        }

        if (settingsSqliteState.sqliteAvailable) {
          loadedData = {
            ...loadedData,
            settings: settingsSqliteState.settings,
          };

          if (import.meta.env.DEV) {
            console.info("[sqlite-settings-mirror]", {
              activeSettingsSource: settingsSqliteState.activeSettingsSource,
              error: settingsSqliteState.error,
              jsonSettingsKeyCount: settingsSqliteState.jsonSettingsKeyCount,
              sampleSettingKeys: settingsSqliteState.sampleSettingKeys,
              settingsMatch: settingsSqliteState.settingsMatch,
              sqliteAvailable: settingsSqliteState.sqliteAvailable,
              sqliteSettingsKeyCount:
                settingsSqliteState.sqliteSettingsKeyCount,
            });
          }
        } else if (settingsSqliteState.error && import.meta.env.DEV) {
          console.warn(
            "[sqlite-settings-mirror] Settings SQLite activation failed. JSON settings remain available.",
            settingsSqliteState.error,
          );
        }

        setData(loadedData);
        latestDataRef.current = loadedData;
        setLastBackupAt(loadedData.settings.lastBackupTimestamp || null);
        setLastAutoImportAt(
          loadedData.settings.lastAutoImportTimestamp || null,
        );
        setItemForm(blankItemForm(loadedData.settings.defaultLocationId));
        setStockForm(blankStockForm(loadedData.items[0]?.id ?? ""));
        setBackupMessage(
          loadedData.settings.backupStatus ||
            `Saved locally ${formatDateTime(loadedData.lastSavedAt)}`,
        );
        setCsvFolderStatus(
          showWebsiteModePanel
            ? "Website mode uses browser download/upload."
            : loadedData.settings.csvExportFolderPath
              ? "CSV folder selected."
              : "Choose a CSV folder to enable folder export/import.",
        );

        if (shouldPersistWatchListDefaultsMigration) {
          void saveAppData(loadedData).catch((error) => {
            if (cancelled) {
              return;
            }

            setBackupIndicator("failed");
            setBackupMessage(
              error instanceof Error ? error.message : "Save failed",
            );
          });
        }
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
        setCsvFolderStatus(
          showWebsiteModePanel
            ? "Website mode uses browser download/upload."
            : "Choose a CSV folder to enable folder export/import.",
        );
        setBackupIndicator("failed");
        setBackupMessage(
          error instanceof Error ? error.message : "Could not load local data.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(
      () => setActivityNow(Date.now()),
      30_000,
    );

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (
      !data ||
      !showWebsiteModePanel ||
      startupWebsiteUpdateCheckRef.current
    ) {
      return;
    }

    startupWebsiteUpdateCheckRef.current = true;
    void checkWebsiteUpdate(false);
  }, [data]);

  useEffect(() => {
    if (!data || !showWebsiteModePanel || !isSettingsOpen) {
      return;
    }

    void refreshWebsiteBackupStatus();
  }, [data, isSettingsOpen]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const deletedRecords = latestDataRef.current?.deletedRecords ?? [];

      if (deletedRecords.some((record) => isDeletedRecordExpired(record))) {
        purgeExpiredDeletedRecordsFromData();
      }
    }, 60_000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (
      data?.deletedRecords?.some((record) => isDeletedRecordExpired(record))
    ) {
      purgeExpiredDeletedRecordsFromData();
    }
  }, [data?.deletedRecords]);

  useEffect(() => {
    latestDataRef.current = data;
  }, [data]);

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }

    const devWindow = window as Window & {
      __mitSqliteHealthCheck?: typeof runSqliteHealthCheck;
    };

    devWindow.__mitSqliteHealthCheck = runSqliteHealthCheck;

    return () => {
      delete devWindow.__mitSqliteHealthCheck;
    };
  }, []);

  useEffect(() => {
    if (!data || !import.meta.env.DEV || sqliteHealthCheckLoggedRef.current) {
      return;
    }

    sqliteHealthCheckLoggedRef.current = true;
    let cancelled = false;

    runSqliteHealthCheck()
      .then((result) => {
        if (cancelled) {
          return;
        }

        console.info("[sqlite-health-check]", result);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        console.info("[sqlite-health-check]", {
          checkedAt: new Date().toISOString(),
          counts: {},
          errors: [error instanceof Error ? error.message : String(error)],
          metadataTableExists: false,
          schemaVersion: null,
          sqliteAvailable: false,
          tableNames: [],
        });
      });

    return () => {
      cancelled = true;
    };
  }, [data]);

  useEffect(() => {
    if (!data) {
      return;
    }

    const mirrorSignature = JSON.stringify(
      Object.entries(data.settings)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, value]) => [
          key,
          typeof value,
          value && typeof value === "object" ? Boolean(value) : value,
        ]),
    );

    if (sqliteSettingsMirrorSignatureRef.current === mirrorSignature) {
      return;
    }

    sqliteSettingsMirrorSignatureRef.current = mirrorSignature;
    let cancelled = false;

    getSqliteSettingsMirrorStatus(data.settings)
      .then((status) => {
        if (cancelled) {
          return;
        }

        if (import.meta.env.DEV) {
          console.info("[sqlite-settings-mirror]", status);
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        if (import.meta.env.DEV) {
          console.info("[sqlite-settings-mirror]", {
            activeSettingsSource: "json",
            error: error instanceof Error ? error.message : String(error),
            jsonSettingsKeyCount: Object.keys(data.settings).filter(
              (key) => key !== "backupDirectoryHandle",
            ).length,
            sampleSettingKeys: [],
            settingsMatch: false,
            sqliteAvailable: false,
            sqliteSettingsKeyCount: 0,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [data?.settings]);

  useEffect(() => {
    if (!data || !import.meta.env.DEV) {
      return;
    }

    const deletedRecords = data.deletedRecords ?? [];
    const mirrorSignature = JSON.stringify({
      deletedRecords: deletedRecords.map((record) => [
        record.id,
        record.type,
        record.originalId,
        record.deletedAt,
        record.expiresAt,
        record.title,
        record.details,
        record.actor,
        record.payload,
      ]),
    });

    if (sqliteTrashMirrorSignatureRef.current === mirrorSignature) {
      return;
    }

    sqliteTrashMirrorSignatureRef.current = mirrorSignature;
    let cancelled = false;

    getSqliteTrashMirrorStatus(deletedRecords)
      .then((status) => {
        if (cancelled) {
          return;
        }

        console.info("[sqlite-trash-mirror]", status);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        console.info("[sqlite-trash-mirror]", {
          activeTrashSource: "json",
          deletedRecordsMatch: false,
          error: error instanceof Error ? error.message : String(error),
          jsonDeletedRecordCount: deletedRecords.length,
          sampleRecordIds: [],
          sampleRecordTypes: [],
          sqliteAvailable: false,
          sqliteDeletedRecordCount: 0,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [data?.deletedRecords]);

  useEffect(() => {
    if (!data) {
      return;
    }

    const mirrorSignature = JSON.stringify({
      locations: data.locations.map((location) => [
        location.id,
        location.updatedAt,
      ]),
      vendors: data.vendors.map((vendor) => [vendor.id, vendor.updatedAt]),
    });

    if (sqliteVendorLocationMirrorSignatureRef.current === mirrorSignature) {
      return;
    }

    sqliteVendorLocationMirrorSignatureRef.current = mirrorSignature;
    let cancelled = false;

    getSqliteVendorLocationStatus(data.vendors, data.locations)
      .then((status) => {
        if (cancelled || status.skipped) {
          return;
        }

        if (import.meta.env.DEV) {
          console.info("[sqlite-vendor-location-mirror]", status);
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        if (import.meta.env.DEV) {
          console.warn(
            "[sqlite-vendor-location-mirror] Vendor/location SQLite sync failed. JSON fallback remains available.",
            error,
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [data?.locations, data?.vendors]);

  useEffect(() => {
    if (!data) {
      return;
    }

    const mirrorSignature = JSON.stringify({
      items: data.items.map((item) => [
        item.id,
        item.updatedAt,
        item.quantityOnHand,
        item.orderPlaced,
        item.reorderHold,
      ]),
    });

    if (sqliteInventoryMirrorSignatureRef.current === mirrorSignature) {
      return;
    }

    sqliteInventoryMirrorSignatureRef.current = mirrorSignature;
    let cancelled = false;

    getSqliteInventoryMirrorStatus(data.items)
      .then((status) => {
        if (cancelled) {
          return;
        }

        if (import.meta.env.DEV) {
          console.info("[sqlite-inventory-mirror]", status);
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        if (import.meta.env.DEV) {
          console.info("[sqlite-inventory-mirror]", {
            activeInventorySource: "json",
            error: error instanceof Error ? error.message : String(error),
            inventoryMatch: false,
            jsonInventoryCount: data.items.length,
            samplePartNumbers: [],
            sqliteAvailable: false,
            sqliteInventoryCount: 0,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [data?.items]);

  useEffect(() => {
    if (!data) {
      return;
    }

    const mirrorSignature = JSON.stringify({
      stockChanges: data.stockChanges.map((record) => [
        record.id,
        record.createdAt,
        record.occurredAt,
        record.actionType,
        record.quantity,
        record.previousQuantity,
        record.newQuantity,
      ]),
    });

    if (sqliteStockLedgerMirrorSignatureRef.current === mirrorSignature) {
      return;
    }

    sqliteStockLedgerMirrorSignatureRef.current = mirrorSignature;
    let cancelled = false;

    getSqliteStockLedgerMirrorStatus(data.stockChanges)
      .then((status) => {
        if (cancelled) {
          return;
        }

        if (import.meta.env.DEV) {
          console.info("[sqlite-stock-ledger-mirror]", status);
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        if (import.meta.env.DEV) {
          console.info("[sqlite-stock-ledger-mirror]", {
            activeStockLedgerSource: "json",
            error: error instanceof Error ? error.message : String(error),
            jsonStockLedgerCount: data.stockChanges.length,
            sampleActions: [],
            samplePartNumbers: [],
            sqliteAvailable: false,
            sqliteStockLedgerCount: 0,
            stockLedgerMatch: false,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [data?.stockChanges]);

  useEffect(() => {
    if (!data) {
      return;
    }

    const mirrorSignature = JSON.stringify({
      requisitionMadeRecords: data.requisitionMadeRecords.map((record) => [
        record.id,
        record.createdAt,
        record.passedAt,
        record.pdfGeneratedAt,
        record.poNo,
        record.totalCost,
        record.itemSnapshots.map((snapshot) => [
          snapshot.itemId,
          snapshot.partNumber,
          snapshot.quantityRequested,
          snapshot.unitCost,
          snapshot.totalCost,
        ]),
      ]),
    });

    if (sqliteRequisitionMirrorSignatureRef.current === mirrorSignature) {
      return;
    }

    sqliteRequisitionMirrorSignatureRef.current = mirrorSignature;
    let cancelled = false;

    getSqliteRequisitionMirrorStatus(data)
      .then((status) => {
        if (cancelled) {
          return;
        }

        if (import.meta.env.DEV) {
          console.info("[sqlite-requisition-mirror]", status);
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        if (import.meta.env.DEV) {
          console.info("[sqlite-requisition-mirror]", {
            activeRequisitionSource: "json",
            error: error instanceof Error ? error.message : String(error),
            jsonReorderHistoryCount: data.requisitionMadeRecords.reduce(
              (total, record) => total + record.itemSnapshots.length,
              0,
            ),
            jsonRequisitionCount: data.requisitionMadeRecords.length,
            jsonRequisitionLineCount: data.requisitionMadeRecords.reduce(
              (total, record) => total + record.itemSnapshots.length,
              0,
            ),
            reorderHistoryMatch: false,
            requisitionLinesMatch: false,
            requisitionsMatch: false,
            samplePartNumbers: [],
            sampleRequisitionNumbers: [],
            sqliteAvailable: false,
            sqliteReorderHistoryCount: 0,
            sqliteRequisitionCount: 0,
            sqliteRequisitionLineCount: 0,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [data?.requisitionMadeRecords]);

  useEffect(() => {
    if (!data) {
      return;
    }

    const canEnterScreensaver =
      !isManualScreensaverActive &&
      !isSettingsOpen &&
      !isItemFormOpen &&
      !isAddLocationOpen &&
      !isAddVendorOpen &&
      !editingVendorId &&
      !csvImportPreview &&
      !csvFolderImportPreview &&
      !backupDialog &&
      !manualUpdateNotice &&
      !labelPreviewItem &&
      !selectedVendorId &&
      !selectedLocationId &&
      !vendorAiPrompt &&
      activePage !== "add-item" &&
      activePage !== "stock" &&
      activePage !== "reorder";
    let idleTimerId: number | null = null;

    function clearIdleTimer() {
      if (idleTimerId !== null) {
        window.clearTimeout(idleTimerId);
        idleTimerId = null;
      }
    }

    function scheduleIdleTimer() {
      clearIdleTimer();

      if (!canEnterScreensaver) {
        setIsDashboardScreensaverActive(false);
        return;
      }

      idleTimerId = window.setTimeout(() => {
        setActivePage("dashboard");
        setIsChromeCollapsed(true);
        setIsDashboardScreensaverActive(true);
      }, DASHBOARD_SCREENSAVER_TIMEOUT_MS);
    }

    function handleUserActivity() {
      setIsDashboardScreensaverActive(false);
      scheduleIdleTimer();
    }

    const events: Array<keyof WindowEventMap> = [
      "mousemove",
      "mousedown",
      "keydown",
      "scroll",
      "touchstart",
      "wheel",
    ];

    events.forEach((eventName) =>
      window.addEventListener(eventName, handleUserActivity, { passive: true }),
    );
    scheduleIdleTimer();

    return () => {
      clearIdleTimer();
      events.forEach((eventName) =>
        window.removeEventListener(eventName, handleUserActivity),
      );
    };
  }, [
    activePage,
    backupDialog,
    csvFolderImportPreview,
    csvImportPreview,
    data,
    editingVendorId,
    isAddLocationOpen,
    isAddVendorOpen,
    isItemFormOpen,
    isManualScreensaverActive,
    isSettingsOpen,
    labelPreviewItem,
    manualUpdateNotice,
    selectedLocationId,
    selectedVendorId,
    vendorAiPrompt,
  ]);

  useEffect(() => {
    if (!isDashboardScreensaverActive && !isManualScreensaverActive) {
      return;
    }

    let canWake = false;
    const wakeDelayId = window.setTimeout(() => {
      canWake = true;
    }, 300);

    function wakeScreensaver() {
      if (!canWake) {
        return;
      }

      setIsDashboardScreensaverActive(false);
      setIsManualScreensaverActive(false);
    }

    const events: Array<keyof WindowEventMap> = [
      "mousemove",
      "mousedown",
      "keydown",
      "wheel",
      "scroll",
      "touchstart",
    ];

    events.forEach((eventName) =>
      window.addEventListener(eventName, wakeScreensaver, { passive: true }),
    );

    return () => {
      window.clearTimeout(wakeDelayId);
      events.forEach((eventName) =>
        window.removeEventListener(eventName, wakeScreensaver),
      );
    };
  }, [isDashboardScreensaverActive, isManualScreensaverActive]);

  useEffect(() => {
    if (!data || showWebsiteModePanel || startupBackupCheckRef.current) {
      return;
    }

    startupBackupCheckRef.current = true;
    void runStartupBackupChecks(data);
  }, [data]);

  useEffect(() => {
    if (!data || showWebsiteModePanel || startupManualUpdateCheckRef.current) {
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
        .then(async (saveResult) => {
          if (showWebsiteModePanel) {
            if (saveResult?.backup) {
              applyWebsiteBackupStatus(saveResult.backup);
            }

            setBackupIndicator(
              saveResult?.backup?.status === "failed" ? "failed" : "done",
            );
            setBackupMessage(
              saveResult?.backup
                ? websiteBackupMessageFromStatus(saveResult.backup)
                : `Saved to backend ${formatDateTime(data.lastSavedAt)}`,
            );
            window.setTimeout(
              () =>
                setBackupIndicator((current) =>
                  current === "done" ? "saved" : current,
                ),
              2000,
            );
            return;
          }

          const hasBackupTarget = Boolean(
            data.settings.backupDirectoryPath ||
            data.settings.backupDirectoryHandle,
          );

          if (
            !skipAutoBackup &&
            data.settings.backupEnabled &&
            hasBackupTarget
          ) {
            if (data.settings.backupInterval === "change") {
              await runBackup(data, false);
              return;
            }

            if (
              data.settings.backupInterval === "5min" ||
              data.settings.backupInterval === "15min"
            ) {
              pendingTimedBackupRef.current = true;
            }
          }

          if (
            skipAutoBackup &&
            data.settings.backupStatus &&
            /failed|permission|denied|missing|no backup file|could not/i.test(
              data.settings.backupStatus,
            )
          ) {
            setBackupIndicator("failed");
            setBackupMessage(data.settings.backupStatus);
            return;
          }

          setBackupIndicator("done");
          setBackupMessage(
            skipAutoBackup && data.settings.backupStatus
              ? data.settings.backupStatus
              : `Saved locally ${formatDateTime(data.lastSavedAt)}`,
          );
          window.setTimeout(
            () =>
              setBackupIndicator((current) =>
                current === "done" ? "saved" : current,
              ),
            2000,
          );
        })
        .catch((error) => {
          setBackupIndicator("failed");
          setBackupMessage(
            error instanceof Error ? error.message : "Save failed",
          );
        });
    }, 400);

    return () => window.clearTimeout(timeoutId);
  }, [data]);

  useEffect(() => {
    if (csvHistoryAutoExportTimeoutRef.current !== null) {
      window.clearTimeout(csvHistoryAutoExportTimeoutRef.current);
      csvHistoryAutoExportTimeoutRef.current = null;
    }

    if (showWebsiteModePanel) {
      csvHistoryAutoExportBootstrappedRef.current = false;
      csvHistoryAutoExportSignatureRef.current = "";
      return;
    }

    if (
      !data ||
      !data.settings.csvAutoExportHistoryEnabled ||
      !data.settings.csvExportFolderPath
    ) {
      csvHistoryAutoExportBootstrappedRef.current = false;
      csvHistoryAutoExportSignatureRef.current = "";
      return;
    }

    const signature = JSON.stringify({
      folderPath: data.settings.csvExportFolderPath,
      stockChanges: data.stockChanges.map((change) => [
        change.id,
        change.occurredAt,
        change.createdAt,
        change.quantity,
        change.previousQuantity,
        change.newQuantity,
      ]),
    });

    if (!csvHistoryAutoExportBootstrappedRef.current) {
      csvHistoryAutoExportBootstrappedRef.current = true;
      csvHistoryAutoExportSignatureRef.current = signature;
      return;
    }

    if (
      csvHistoryAutoExportSignatureRef.current === signature ||
      data.stockChanges.length === 0
    ) {
      return;
    }

    csvHistoryAutoExportSignatureRef.current = signature;
    const snapshot = data;
    const latestChange = snapshot.stockChanges
      .slice()
      .sort(
        (left, right) =>
          right.createdAt.localeCompare(left.createdAt) ||
          right.occurredAt.localeCompare(left.occurredAt),
      )[0];
    const monthKey = monthKeyFromIso(latestChange.occurredAt);

    csvHistoryAutoExportTimeoutRef.current = window.setTimeout(() => {
      csvHistoryAutoExportTimeoutRef.current = null;

      exportHistoryMonthCsv(
        snapshot,
        snapshot.settings.csvExportFolderPath,
        monthKey,
      )
        .then(() => {
          const exportedAt = nowIso();

          updateCsvMetadata({ csvLastHistoryExportAt: exportedAt });
          setCsvFolderStatus(`History CSV updated for ${monthKey}.`);
        })
        .catch((error) => {
          const message =
            error instanceof Error
              ? error.message
              : "History CSV auto-export failed.";

          setCsvFolderStatus(message);
          showToast("warning", message);
        });
    }, CSV_HISTORY_EXPORT_DEBOUNCE_MS);

    return () => {
      if (csvHistoryAutoExportTimeoutRef.current !== null) {
        window.clearTimeout(csvHistoryAutoExportTimeoutRef.current);
        csvHistoryAutoExportTimeoutRef.current = null;
      }
    };
  }, [
    data?.settings.csvAutoExportHistoryEnabled,
    data?.settings.csvExportFolderPath,
    data?.stockChanges,
  ]);

  useEffect(() => {
    if (
      !data?.settings.backupEnabled ||
      (data.settings.backupInterval !== "5min" &&
        data.settings.backupInterval !== "15min") ||
      !(
        data.settings.backupDirectoryPath || data.settings.backupDirectoryHandle
      )
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
    data?.settings.backupInterval,
  ]);

  const debouncedInventoryColumnFilters = useDebouncedValue(
    inventoryColumnFilters,
    INVENTORY_SEARCH_DEBOUNCE_MS,
  );
  const inventoryLocationNameById = useMemo(
    () =>
      new Map(
        (data?.locations ?? []).map((location) => [location.id, location.name]),
      ),
    [data?.locations],
  );
  const inventoryVendorNameById = useMemo(
    () =>
      new Map((data?.vendors ?? []).map((vendor) => [vendor.id, vendor.name])),
    [data?.vendors],
  );

  const filteredItems = useMemo(() => {
    if (!data) {
      return [];
    }

    const locationFilter = debouncedInventoryColumnFilters.location
      .trim()
      .toLowerCase();
    const partNumberFilter = debouncedInventoryColumnFilters.partNumber
      .trim()
      .toLowerCase();
    const categoryFilter = debouncedInventoryColumnFilters.category
      .trim()
      .toLowerCase();
    const descriptionFilter = debouncedInventoryColumnFilters.description
      .trim()
      .toLowerCase();
    const vendorFilter = debouncedInventoryColumnFilters.vendor
      .trim()
      .toLowerCase();

    return data.items
      .filter((item) => {
        const status = getInventoryStatus(item);
        const locationName =
          inventoryLocationNameById.get(item.locationId) || "Unassigned";
        const vendorName =
          inventoryVendorNameById.get(item.vendorId) || "Unassigned";

        if (statusFilter === "Order As Needed") {
          if (!item.nonStocked) {
            return false;
          }
        } else if (statusFilter !== "All" && (item.nonStocked || status !== statusFilter)) {
          return false;
        }

        if (
          locationFilter &&
          !locationName.toLowerCase().includes(locationFilter)
        ) {
          return false;
        }

        if (
          partNumberFilter &&
          !item.partNumber.toLowerCase().includes(partNumberFilter)
        ) {
          return false;
        }

        if (
          categoryFilter &&
          !item.category.toLowerCase().includes(categoryFilter)
        ) {
          return false;
        }

        if (
          descriptionFilter &&
          !item.description.toLowerCase().includes(descriptionFilter)
        ) {
          return false;
        }

        if (vendorFilter && !vendorName.toLowerCase().includes(vendorFilter)) {
          return false;
        }

        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [
    data?.items,
    debouncedInventoryColumnFilters,
    inventoryLocationNameById,
    inventoryVendorNameById,
    statusFilter,
  ]);

  const reorderItems = useMemo(() => {
    if (!data) {
      return [];
    }

    return data.items
      .filter(
        (item) =>
          isReorderNeeded(item, data.settings) &&
          !item.hiddenFromWatchList &&
          !item.nonStocked,
      )
      .sort(
        (a, b) =>
          a.quantityOnHand - b.quantityOnHand || a.name.localeCompare(b.name),
      );
  }, [data]);

  function showToast(
    tone: ToastTone,
    text: string,
    actionLabel?: string,
    onAction?: () => void,
  ) {
    const nextToast = { tone, text, actionLabel, onAction };

    setToast(nextToast);
    window.setTimeout(
      () => setToast((current) => (current === nextToast ? null : current)),
      6000,
    );
  }

  function wait(ms: number) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  async function pollWebsiteUpdateProgress() {
    const deadline = Date.now() + 10 * 60 * 1000;
    const idleLaunchDeadline = Date.now() + 6000;
    let sawBackendOffline = false;

    while (Date.now() < deadline) {
      try {
        const runStatus = await getWebsiteUpdateRunStatus();
        setWebsiteUpdateRunStatus(runStatus);
        setWebsiteUpdateRestartMessage(
          runStatus.message || "Update running...",
        );

        if (
          !runStatus.running &&
          runStatus.phase === "idle" &&
          Date.now() >= idleLaunchDeadline
        ) {
          const message =
            "Update launch failed. No updater status file was created.";
          const failedStatus = {
            ...runStatus,
            error: message,
            message,
            ok: false as const,
            phase: "failed",
          };

          setWebsiteUpdateRunStatus(failedStatus);
          setWebsiteUpdateMessage(message);
          setWebsiteUpdateRestartMessage(message);
          showToast("danger", message);
          return;
        }

        if (runStatus.phase === "failed" || runStatus.ok === false) {
          setWebsiteUpdateMessage("Update failed");
          setWebsiteUpdateRestartMessage("Update failed");
          showToast("danger", runStatus.error || "MIT3 update failed.");
          return;
        }

        if (runStatus.phase === "complete" && runStatus.ok === true) {
          setWebsiteUpdateRestartMessage("Update complete. Reloading MIT3...");
          await wait(1200);
          window.location.reload();
          return;
        }
      } catch {
        sawBackendOffline = true;
        setWebsiteUpdateRestartMessage(
          "MIT3 is restarting. Waiting for update status...",
        );
      }

      try {
        const healthResponse = await fetch(`${websiteBackendUrl}/api/health`, {
          cache: "no-store",
          headers: { Accept: "application/json" },
        });

        if (healthResponse.ok) {
          // Health returning OK only means the backend is reachable. Do not reload from health alone.
          await healthResponse.json().catch(() => null);
        }
      } catch {
        sawBackendOffline = true;
      }

      try {
        const updateStatus = await getWebsiteUpdateStatus();
        setWebsiteUpdateStatus(updateStatus);

        if (
          sawBackendOffline &&
          updateStatus.ok &&
          updateStatus.updateAvailable === false &&
          updateStatus.behindCount === 0
        ) {
          setWebsiteUpdateRestartMessage("Update complete. Reloading MIT3...");
          await wait(1200);
          window.location.reload();
          return;
        }
      } catch {
        // The backend can be unavailable while PowerShell rebuilds and restarts MIT3.
      }

      await wait(2000);
    }

    setWebsiteUpdateRestartMessage(
      "MIT3 may still be updating. Use Refresh Now after the website is back.",
    );
  }

  async function checkWebsiteUpdate(manual = false) {
    if (!showWebsiteModePanel) {
      return;
    }

    setIsCheckingWebsiteUpdate(true);

    try {
      const status = await getWebsiteUpdateStatus();

      setWebsiteUpdateStatus(status);
      if (manual && status.ok && status.updateAvailable) {
        saveWebsiteUpdateRemindLaterSha("");
        setRemindedLaterUpdateSha("");
      }
      setWebsiteUpdateMessage(manual ? websiteUpdateStatusMessage(status) : "");

      if (manual) {
        showToast(
          status.ok
            ? status.updateAvailable
              ? "warning"
              : "success"
            : "warning",
          websiteUpdateStatusMessage(status),
        );
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not check updates.";

      setWebsiteUpdateStatus({
        ok: false,
        error: message,
        checkedAt: nowIso(),
      });
      setWebsiteUpdateMessage(manual ? message : "");

      if (manual) {
        showToast("warning", message);
      }
    } finally {
      setIsCheckingWebsiteUpdate(false);
    }
  }

  function remindWebsiteUpdateLater() {
    if (!websiteUpdateStatus?.ok) {
      return;
    }

    saveWebsiteUpdateRemindLaterSha(websiteUpdateStatus.remoteSha);
    setRemindedLaterUpdateSha(websiteUpdateStatus.remoteSha);
    setWebsiteUpdateMessage("Update reminder hidden for this GitHub version.");
  }

  async function startWebsiteUpdate() {
    setIsStartingWebsiteUpdate(true);
    setWebsiteUpdateMessage("");
    setWebsiteUpdateRestartMessage("");
    setWebsiteUpdateRunStatus(null);
    setWebsiteUpdateLogText("");

    try {
      const result = await runWebsiteUpdate();

      if (result.ok) {
        const launchDeadline = Date.now() + 6000;
        let runStatus = await getWebsiteUpdateRunStatus();

        while (
          !runStatus.running &&
          runStatus.phase === "idle" &&
          Date.now() < launchDeadline
        ) {
          await wait(1000);
          runStatus = await getWebsiteUpdateRunStatus();
        }

        if (!runStatus.running && runStatus.phase === "idle") {
          const message =
            "Update launch failed. No updater status file was created.";

          setIsWebsiteUpdateRestarting(true);
          setWebsiteUpdateMessage(message);
          setWebsiteUpdateRestartMessage(message);
          setWebsiteUpdateRunStatus({
            ...runStatus,
            error: message,
            message,
            ok: false,
            phase: "failed",
            repoRoot: runStatus.repoRoot || result.repoRoot,
            scriptPath: runStatus.scriptPath || result.scriptPath,
            pid: runStatus.pid ?? result.pid,
          });
          showToast("danger", message);
          return;
        }

        const message = runStatus.message || "Update running...";

        setIsWebsiteUpdateRestarting(true);
        setWebsiteUpdateMessage(message);
        setWebsiteUpdateRestartMessage(message);
        setWebsiteUpdateRunStatus(runStatus);
        showToast(
          "success",
          "Update started. MIT3 will show progress here.",
          "Refresh Now",
          () => window.location.reload(),
        );
        void pollWebsiteUpdateProgress();
        return;
      }

      const details = result.details || result.dirtyFiles?.join("\n") || "";
      const blockedMessage =
        result.error === "Local changes found"
          ? `Update blocked because local changes exist.${details ? `\n${details}` : ""}`
          : result.error;

      setWebsiteUpdateMessage(blockedMessage);
      showToast(
        "danger",
        result.error === "Local changes found"
          ? "Update blocked because local changes exist."
          : result.error,
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not start the MIT3 website update.";

      setWebsiteUpdateMessage(message);
      showToast("danger", message);
    } finally {
      setIsStartingWebsiteUpdate(false);
    }
  }

  async function viewWebsiteUpdateLog() {
    setIsLoadingWebsiteUpdateLog(true);

    try {
      setWebsiteUpdateLogText(await getWebsiteUpdateRunLog());
    } catch (error) {
      setWebsiteUpdateLogText(
        error instanceof Error ? error.message : "Could not load update log.",
      );
    } finally {
      setIsLoadingWebsiteUpdateLog(false);
    }
  }

  function updateInventoryColumnFilter(
    key: InventoryColumnFilterKey,
    value: string,
  ) {
    setInventoryColumnFilters((current) =>
      current[key] === value ? current : { ...current, [key]: value },
    );
  }

  function clearInventoryColumnFilters() {
    setInventoryColumnFilters((current) =>
      hasActiveInventoryColumnFilters(current)
        ? blankInventoryColumnFilters()
        : current,
    );
  }

  function startInventoryRequisition(itemIds: string[]) {
    const uniqueItemIds = Array.from(
      new Set(
        itemIds.filter((itemId) =>
          data?.items.some((item) => item.id === itemId),
        ),
      ),
    );

    if (uniqueItemIds.length === 0) {
      return;
    }

    setInventoryRequisitionLaunch({ id: createId(), itemIds: uniqueItemIds });
    openPage("reorder");
  }

  function ensurePermission(permission: Permission) {
    if (hasPermission(readAuthRecord()?.role, permission)) {
      return true;
    }

    showToast("warning", PERMISSION_DENIED_MESSAGE);
    return false;
  }

  function deletedRecordPermission(type: DeletedRecordType): Permission {
    if (type === "Vendor") {
      return "vendors:delete";
    }

    if (type === "Location") {
      return "locations:delete";
    }

    return "inventory:delete";
  }

  function deletedRecordEntityType(type: DeletedRecordType): AuditEntityType {
    return type === "Inventory" ? "Item" : type;
  }

  function createDeletedRecord(
    type: DeletedRecordType,
    payload: DeletedRecord["payload"],
    details: string,
  ): DeletedRecord {
    const deletedAt = nowIso();

    return {
      id: createId(),
      originalId: payload.id,
      type,
      title: payload.name,
      details,
      deletedAt,
      expiresAt: new Date(
        new Date(deletedAt).getTime() + TRASH_RETENTION_MS,
      ).toISOString(),
      actor: "User",
      payload,
    };
  }

  function warnTrashSqliteFailure(message: string, error: unknown) {
    if (import.meta.env.DEV) {
      console.warn("[sqlite-trash-mirror]", message, error);
    }
  }

  function saveDeletedRecordLive(record: DeletedRecord) {
    void saveDeletedRecordToSqlite(record).catch((error) => {
      warnTrashSqliteFailure(
        "Deleted record SQLite save failed. JSON fallback remains available.",
        error,
      );
    });
  }

  function deleteDeletedRecordLive(recordId: string) {
    void deleteDeletedRecordFromSqlite(recordId).catch((error) => {
      warnTrashSqliteFailure(
        "Deleted record SQLite delete failed. JSON fallback remains available.",
        error,
      );
    });
  }

  function syncDeletedRecordsLive(records: DeletedRecord[], message: string) {
    void syncDeletedRecordsToSqlite(records).catch((error) => {
      warnTrashSqliteFailure(message, error);
    });
  }

  function restoreDeletedRecord(deletedRecordId: string) {
    const currentData = data;
    const record = currentData?.deletedRecords?.find(
      (candidate) => candidate.id === deletedRecordId,
    );

    if (!currentData || !record) {
      showToast("warning", "That deleted record is no longer available.");
      return;
    }

    if (!ensurePermission(deletedRecordPermission(record.type))) {
      return;
    }

    if (isDeletedRecordExpired(record)) {
      purgeExpiredDeletedRecordsFromData();
      showToast("warning", "That deleted record expired.");
      return;
    }

    const hasDuplicate =
      record.type === "Inventory"
        ? currentData.items.some((item) => item.id === record.originalId)
        : record.type === "Vendor"
          ? currentData.vendors.some(
              (vendor) => vendor.id === record.originalId,
            )
          : currentData.locations.some(
              (location) => location.id === record.originalId,
            );

    if (hasDuplicate) {
      showToast(
        "warning",
        "Could not restore because a matching record already exists.",
      );
      return;
    }

    deleteDeletedRecordLive(deletedRecordId);

    commitData((current) => {
      const deletedRecord = current.deletedRecords?.find(
        (candidate) => candidate.id === deletedRecordId,
      );

      if (!deletedRecord) {
        return current;
      }

      const nextData = {
        ...current,
        items:
          deletedRecord.type === "Inventory"
            ? [normalizeItem(deletedRecord.payload), ...current.items]
            : current.items,
        vendors:
          deletedRecord.type === "Vendor"
            ? [deletedRecord.payload as VendorRecord, ...current.vendors]
            : current.vendors,
        locations:
          deletedRecord.type === "Location"
            ? [...current.locations, deletedRecord.payload as LocationRecord]
            : current.locations,
        deletedRecords: (current.deletedRecords ?? []).filter(
          (candidate) => candidate.id !== deletedRecordId,
        ),
      };

      return addAudit(
        nextData,
        createAuditEntry(
          deletedRecordEntityType(deletedRecord.type),
          deletedRecord.originalId,
          `${deletedRecord.type} Restored`,
          `${deletedRecord.title} was restored from Recently Deleted.`,
          "User",
        ),
      );
    });

    showToast("success", "Record restored.");
  }

  function purgeExpiredDeletedRecordsFromData() {
    let activeRecords: DeletedRecord[] | null = null;

    commitData((current) => {
      const deletedRecords = current.deletedRecords ?? [];
      const activeDeletedRecords = purgeExpiredDeletedRecords(deletedRecords);

      if (activeDeletedRecords.length === deletedRecords.length) {
        return current;
      }

      activeRecords = activeDeletedRecords;

      return { ...current, deletedRecords: activeDeletedRecords };
    });

    if (activeRecords) {
      syncDeletedRecordsLive(
        activeRecords,
        "Expired trash SQLite purge failed. JSON fallback remains available.",
      );
    }
  }

  function deleteDeletedRecordForever(deletedRecordId: string) {
    const record = data?.deletedRecords?.find(
      (candidate) => candidate.id === deletedRecordId,
    );

    if (!record) {
      showToast("warning", "That deleted record is no longer available.");
      return;
    }

    if (!ensurePermission(deletedRecordPermission(record.type))) {
      return;
    }

    const confirmed = window.confirm(
      `Permanently delete ${record.title}? This cannot be undone.`,
    );

    if (!confirmed) {
      return;
    }

    deleteDeletedRecordLive(deletedRecordId);

    commitData((current) =>
      addAudit(
        {
          ...current,
          deletedRecords: (current.deletedRecords ?? []).filter(
            (candidate) => candidate.id !== deletedRecordId,
          ),
        },
        createAuditEntry(
          deletedRecordEntityType(record.type),
          record.originalId,
          `${record.type} Permanently Deleted`,
          `${record.title} was permanently deleted from Recently Deleted.`,
          "User",
        ),
      ),
    );
    showToast("success", "Deleted record removed permanently.");
  }

  async function openManualUpdateFolderFromNotice(
    updateCheck: ManualInstallerCheckResult,
  ) {
    try {
      await openInstallerFolder(updateCheck.folderPath);
      setManualUpdateNotice(null);
    } catch (error) {
      showToast(
        "warning",
        error instanceof Error
          ? error.message
          : "Could not open installer folder.",
      );
    }
  }

  async function openManualUpdateInstallerFromNotice(
    updateCheck: ManualInstallerCheckResult,
  ) {
    const installer = updateCheck.newerInstaller;

    if (!installer) {
      showToast("warning", "No newer installer file was found.");
      return;
    }

    try {
      await openInstallerFile(updateCheck.folderPath, installer.fileName);
      setManualUpdateNotice(null);
      showToast(
        "success",
        "Installer opened. Follow the setup prompts to update.",
      );
    } catch (error) {
      showToast(
        "warning",
        error instanceof Error
          ? error.message
          : "Could not open installer file.",
      );
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
    setIsDashboardScreensaverActive(false);
    setIsManualScreensaverActive(false);
    setActivePage(page);
    setIsChromeCollapsed(page === "inventory");
    closeSettingsPanel();
  }

  function startManualScreensaverMode() {
    closeSettingsPanel();
    setIsDashboardScreensaverActive(false);
    setIsManualScreensaverActive(true);
  }

  function openInventoryForItemForm() {
    if (activePage !== "inventory") {
      openPage("inventory");
      return;
    }

    closeSettingsPanel();
  }

  function startAddItem() {
    if (!ensurePermission("inventory:create")) {
      return;
    }

    setEditingItemId(null);
    setItemForm(blankItemForm(data?.settings.defaultLocationId ?? ""));
    setIsItemFormOpen(true);
    openInventoryForItemForm();
  }

  function openCategoryManager() {
    const role = readAuthRecord()?.role;

    if (
      !hasPermission(role, "inventory:create") &&
      !hasPermission(role, "inventory:edit")
    ) {
      showToast("warning", PERMISSION_DENIED_MESSAGE);
      return;
    }

    setIsCategoryManagerOpen(true);
    openPage("inventory");
  }

  function addCustomCategory(categoryName: string): CategoryAddResult {
    if (!data) {
      return { ok: false, message: "Inventory data is still loading." };
    }

    const role = readAuthRecord()?.role;

    if (
      !hasPermission(role, "inventory:create") &&
      !hasPermission(role, "inventory:edit")
    ) {
      return { ok: false, message: PERMISSION_DENIED_MESSAGE };
    }

    const cleanCategory = normalizeCategoryName(categoryName);

    if (!cleanCategory) {
      return { ok: false, message: "Enter a category name." };
    }

    if (hasCategoryMatch(getInventoryCategoryOptions(data), cleanCategory)) {
      return { ok: false, message: "That category already exists." };
    }

    commitData((current) => {
      if (
        hasCategoryMatch(getInventoryCategoryOptions(current), cleanCategory)
      ) {
        return current;
      }

      const customCategories = normalizeCustomCategories([
        ...current.settings.customCategories,
        cleanCategory,
      ]);

      return addAudit(
        {
          ...current,
          settings: {
            ...current.settings,
            customCategories,
            updatedAt: nowIso(),
          },
        },
        createAuditEntry(
          "Settings",
          "appSettings",
          "Inventory Category Added",
          `${cleanCategory} was added.`,
          "User",
        ),
      );
    });

    showToast("success", `${cleanCategory} added to categories.`);
    return { ok: true, message: `${cleanCategory} added.` };
  }

  async function handleItemImageUpload(file: File) {
    try {
      const imageDataUrl = await resizeItemImageToDataUrl(file);

      setItemForm((current) => ({ ...current, imageDataUrl }));
      showToast("success", "Item image added.");
    } catch (error) {
      showToast(
        "warning",
        error instanceof Error ? error.message : "Could not process image.",
      );
    }
  }

  function removeItemImage() {
    setItemForm((current) => ({ ...current, imageDataUrl: "" }));
  }

  function openLabelPreview(item: InventoryItem) {
    setLabelPreviewItem(item);
  }

  function openCurrentItemFormLabel() {
    if (!data || !editingItemId) {
      return;
    }

    const existing = data.items.find((item) => item.id === editingItemId);

    if (!existing) {
      showToast("warning", "Save this item before printing a label.");
      return;
    }

    setLabelPreviewItem(itemFromForm(itemForm, existing));
  }

  function printInventoryLabel() {
    const printClassName = "printing-inventory-label";
    const cleanup = () => {
      document.body.classList.remove(printClassName);
      window.removeEventListener("afterprint", cleanup);
    };

    window.addEventListener("afterprint", cleanup, { once: true });
    document.body.classList.add(printClassName);
    window.setTimeout(() => {
      window.print();
      window.setTimeout(cleanup, 800);
    }, 50);
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
    setHeaderBadgeDraft(
      data.settings.headerBadgeText || DEFAULT_HEADER_BADGE_TEXT,
    );
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
      updateSettings(
        { ...data.settings, headerBadgeText: nextValue },
        "Header badge text was updated.",
      );
    }
  }

  function cancelHeaderBadgeEdit() {
    skipHeaderBadgeSaveRef.current = true;
    setHeaderBadgeDraft(
      data?.settings.headerBadgeText || DEFAULT_HEADER_BADGE_TEXT,
    );
    setIsEditingHeaderBadge(false);
  }

  function handleHeaderBadgeKeyDown(
    event: React.KeyboardEvent<HTMLInputElement>,
  ) {
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
    setData((current) => (current ? stampData(updater(current)) : current));
  }

  function toggleReorderHold(itemId: string) {
    commitData((current) => ({
      ...current,
      items: current.items.map((it) =>
        it.id === itemId
          ? { ...it, reorderHold: !it.reorderHold, updatedAt: nowIso() }
          : it,
      ),
    }));
  }

  function toggleOrderPlaced(itemId: string) {
    commitData((current) => ({
      ...current,
      items: current.items.map((it) =>
        it.id === itemId
          ? {
              ...it,
              orderPlaced: !it.orderPlaced,
              orderRequisitionId: "",
              updatedAt: nowIso(),
            }
          : it,
      ),
    }));
  }

  function toggleWatchListHidden(itemId: string) {
    commitData((current) => {
      const item = current.items.find((candidate) => candidate.id === itemId);

      if (!item || !isReorderNeeded(item, current.settings)) {
        return current;
      }

      const updatedAt = nowIso();
      const nextHidden = item.hiddenFromWatchList !== true;
      const updatedItem: InventoryItem = {
        ...item,
        hiddenFromWatchList: nextHidden,
        updatedAt,
      };

      return addAudit(
        {
          ...current,
          items: current.items.map((candidate) =>
            candidate.id === itemId ? updatedItem : candidate,
          ),
        },
        createAuditEntry(
          "Item",
          itemId,
          nextHidden
            ? "Hidden from Dashboard Watch List"
            : "Unhidden from Dashboard Watch List",
          `${item.name} was ${nextHidden ? "hidden from" : "unhidden on"} the Dashboard Watch List.`,
          "User",
          updatedAt,
        ),
      );
    });

    showToast("success", "Watch List visibility updated.");
  }

  function updateWatchListVisibility(
    itemId: string,
    choice: Exclude<WatchListVisibilityChoice, "hidden">,
  ) {
    commitData((current) => {
      const item = current.items.find((candidate) => candidate.id === itemId);

      if (!item) {
        return current;
      }

      const updatedAt = nowIso();
      const updatedItem: InventoryItem =
        choice === "held"
          ? {
              ...item,
              orderPlaced: false,
              reorderHold: true,
              orderRequisitionId: "",
              hiddenFromWatchList: false,
              updatedAt,
            }
          : {
              ...item,
              orderPlaced: false,
              reorderHold: false,
              orderRequisitionId: "",
              hiddenFromWatchList: false,
              updatedAt,
            };

      return addAudit(
        {
          ...current,
          items: current.items.map((candidate) =>
            candidate.id === itemId ? updatedItem : candidate,
          ),
        },
        createAuditEntry(
          "Item",
          itemId,
          choice === "held"
            ? "Moved to Held List"
            : "Shown on Dashboard Watch List",
          getWatchListVisibilitySummary(updatedItem, choice),
          "User",
          updatedAt,
        ),
      );
    });

    setWatchListVisibilityItemId(null);
    showToast(
      "success",
      choice === "held"
        ? "Item moved to Held list."
        : "Item will show on the Watch List.",
    );
  }

  function hasBackupTarget(settings: AppSettings) {
    return Boolean(
      settings.backupDirectoryPath || settings.backupDirectoryHandle,
    );
  }

  function backupTargetFromSelection(selection: BackupDirectorySelection) {
    return {
      backupDirectoryHandle: selection.directoryHandle,
      backupDirectoryPath: selection.directoryPath,
    };
  }

  function settingsWithBackupSelection(
    settings: AppSettings,
    selection: BackupDirectorySelection,
  ): AppSettings {
    return {
      ...settings,
      backupEnabled: true,
      autoImportEnabled: true,
      backupDirectoryHandle: selection.directoryHandle,
      backupDirectoryName: selection.directoryName,
      backupDirectoryPath: selection.directoryPath,
      backupStatus: "Backup folder selected.",
      updatedAt: nowIso(),
    };
  }

  function dataWithBackupSelection(
    snapshot: AppData,
    selection: BackupDirectorySelection,
  ): AppData {
    return {
      ...snapshot,
      settings: settingsWithBackupSelection(snapshot.settings, selection),
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
              updatedAt: savedAt,
            },
          }
        : current,
    );
  }

  function updateBackupMetadata(
    partial: Partial<
      Pick<
        AppSettings,
        "backupStatus" | "lastAutoImportTimestamp" | "lastBackupTimestamp"
      >
    >,
  ) {
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
              updatedAt: savedAt,
            },
          }
        : current,
    );
  }

  function updateCsvMetadata(
    partial: Partial<
      Pick<
        AppSettings,
        "csvExportFolderPath" | "csvLastExportAt" | "csvLastHistoryExportAt"
      >
    >,
  ) {
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
              updatedAt: savedAt,
            },
          }
        : current,
    );
  }

  function websiteBackupMessageFromStatus(status: WebsiteBackupStatus) {
    if (status.status === "healthy") {
      return status.lastJsonBackupAt
        ? `Backend backup healthy ${formatDateTime(status.lastJsonBackupAt)}`
        : "Backend backup healthy.";
    }

    if (status.status === "warning") {
      return status.message || "Backend backup has a warning.";
    }

    return status.message || "Backend backup failed.";
  }

  function applyWebsiteBackupStatus(status: WebsiteBackupStatus) {
    setWebsiteBackupStatus(status);

    if (status.lastJsonBackupAt) {
      setLastBackupAt(status.lastJsonBackupAt);
    }

    if (status.lastCsvExportAt) {
      setCsvFolderStatus(
        `Backend CSV export updated ${formatDateTime(status.lastCsvExportAt)}.`,
      );
    }

    setBackupMessage(websiteBackupMessageFromStatus(status));
  }

  async function refreshWebsiteBackupStatus() {
    if (!showWebsiteModePanel) {
      return;
    }

    try {
      applyWebsiteBackupStatus(await getWebsiteBackupStatus());
    } catch (error) {
      setBackupIndicator("failed");
      setBackupMessage(
        error instanceof Error
          ? error.message
          : "Could not check backend backup status.",
      );
    }
  }

  async function handleRunBackendWebsiteBackup() {
    if (!data) {
      return;
    }

    setIsRunningWebsiteBackup(true);
    setBackupIndicator("running");
    setBackupMessage("Backend backup running");

    try {
      const status = await runBackendWebsiteBackup();

      applyWebsiteBackupStatus(status);
      setBackupIndicator(status.status === "failed" ? "failed" : "done");
      showToast(
        status.status === "failed" ? "danger" : "success",
        websiteBackupMessageFromStatus(status),
      );
      window.setTimeout(
        () =>
          setBackupIndicator((current) =>
            current === "done" ? "saved" : current,
          ),
        2000,
      );
    } catch (error) {
      setBackupIndicator("failed");
      setBackupMessage(
        error instanceof Error ? error.message : "Backend backup failed.",
      );
      showToast(
        "danger",
        error instanceof Error ? error.message : "Backend backup failed.",
      );
    } finally {
      setIsRunningWebsiteBackup(false);
    }
  }

  async function handleDownloadWebsiteBackup(
    kind: "history-csv" | "inventory-csv" | "json",
  ) {
    if (!ensurePermission("reports:export")) {
      return;
    }

    try {
      await downloadWebsiteBackupFile(kind);
      showToast("success", "Backend backup download started.");
    } catch (error) {
      showToast(
        "danger",
        error instanceof Error
          ? error.message
          : "Could not download backend backup.",
      );
    }
  }

  function applyCsvFolderSelection(directoryPath: string) {
    updateCsvMetadata({ csvExportFolderPath: directoryPath });
    setCsvFolderStatus("CSV folder selected.");
  }

  function parseAndValidateBackup(
    contents: string,
    fileLastModifiedAt: string | null,
  ) {
    const payload = validateBackupPayload(JSON.parse(contents));

    return {
      backupTimestamp: getBackupUpdatedAt(payload, fileLastModifiedAt),
      payload,
    };
  }

  async function runStartupBackupChecks(snapshot: AppData) {
    if (!hasBackupTarget(snapshot.settings)) {
      const message =
        "Choose backup folder to enable auto backup and auto import.";

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
      const { backupTimestamp, payload } = parseAndValidateBackup(
        backupRead.contents,
        backupRead.lastModifiedAt,
      );
      const localTimestamp = getLocalDataUpdatedAt(snapshot);

      if (isBackupNewerThanLocal(backupTimestamp, localTimestamp)) {
        await applyImportedBackup(
          payload,
          "auto",
          BACKUP_LATEST_FILENAME,
          "Backup imported successfully.",
        );
        return;
      }

      const checkedAt = nowIso();
      const message = "Backup checked. Local data is already newer.";

      setLastAutoImportAt(checkedAt);
      setBackupMessage(message);
      updateBackupMetadata({
        backupStatus: message,
        lastAutoImportTimestamp: checkedAt,
      });
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
      updateBackupMetadata({
        backupStatus: message,
        lastAutoImportTimestamp: nowIso(),
      });
      showToast(
        isMissingBackupFileError(error) ? "warning" : "danger",
        message,
      );
    }
  }

  async function applyImportedBackup(
    payload: InventoryBackupPayload,
    source: BackupImportSource,
    fileName: string,
    successMessage: string,
  ) {
    try {
      const imported = normalizeAppData(payload);
      const importedAt = nowIso();
      const importAction =
        source === "auto"
          ? "Backup Auto Imported"
          : source === "folder"
            ? "Backup Imported"
            : "JSON Imported";
      const importActor = source === "auto" ? "Auto Import" : "User";

      void syncRequisitionsToSqlite(imported.requisitionMadeRecords).catch(
        (error) => {
          if (import.meta.env.DEV) {
            console.warn(
              "[sqlite-requisition-mirror] Imported requisition sync failed. JSON import remains available.",
              error,
            );
          }
        },
      );

      const trashSqliteState = await activateTrashSqliteState(
        imported.deletedRecords ?? [],
      );
      const importedWithTrash = {
        ...imported,
        deletedRecords: purgeExpiredDeletedRecords(trashSqliteState.records),
      };

      if (import.meta.env.DEV) {
        if (trashSqliteState.sqliteAvailable) {
          console.info("[sqlite-trash-mirror]", trashSqliteState);
        } else if (trashSqliteState.error) {
          console.warn(
            "[sqlite-trash-mirror] Imported trash SQLite sync failed. JSON import remains available.",
            trashSqliteState.error,
          );
        }
      }

      const currentSettings =
        latestDataRef.current?.settings ?? imported.settings;
      const nextSettings: AppSettings = {
        ...imported.settings,
        backupEnabled: currentSettings.backupEnabled,
        backupInterval: currentSettings.backupInterval,
        autoImportEnabled: currentSettings.autoImportEnabled,
        backupDirectoryName: currentSettings.backupDirectoryName,
        backupDirectoryPath: currentSettings.backupDirectoryPath,
        backupDirectoryHandle: currentSettings.backupDirectoryHandle,
        csvExportFolderPath: currentSettings.csvExportFolderPath,
        csvAutoExportHistoryEnabled:
          currentSettings.csvAutoExportHistoryEnabled,
        csvLastExportAt: currentSettings.csvLastExportAt,
        csvLastHistoryExportAt: currentSettings.csvLastHistoryExportAt,
        lastBackupTimestamp: currentSettings.lastBackupTimestamp,
        lastAutoImportTimestamp:
          source === "manual"
            ? currentSettings.lastAutoImportTimestamp
            : importedAt,
        backupStatus: successMessage,
        updatedAt: importedAt,
      };
      let restoredSettings = nextSettings;

      try {
        await syncAppSettingsToSqlite(nextSettings);
        restoredSettings = await loadAppSettingsFromSqlite(nextSettings);

        if (import.meta.env.DEV) {
          console.info(
            "[sqlite-settings-mirror]",
            await getSqliteSettingsMirrorStatus(restoredSettings),
          );
        }
      } catch (error) {
        if (import.meta.env.DEV) {
          console.warn(
            "[sqlite-settings-mirror] Imported settings SQLite sync failed. JSON import remains available.",
            error instanceof Error ? error.message : String(error),
          );
        }
      }

      suppressNextAutoBackupRef.current = true;
      setData((current) => {
        if (!current) {
          return current;
        }

        return stampData(
          addAudit(
            {
              ...importedWithTrash,
              settings: restoredSettings,
            },
            createAuditEntry(
              "Import",
              source,
              importAction,
              `${fileName} was imported.`,
              importActor,
              importedAt,
            ),
          ),
        );
      });

      if (source !== "manual") {
        setLastAutoImportAt(importedAt);
      }

      setItemForm(blankItemForm(restoredSettings.defaultLocationId));
      setStockForm(blankStockForm(importedWithTrash.items[0]?.id ?? ""));
      setBackupIndicator("done");
      setBackupMessage(successMessage);
      setBackupDialog(null);
      openPage("dashboard");
      showToast("success", successMessage);
    } catch (error) {
      showToast(
        "danger",
        error instanceof Error ? error.message : "Backup import failed.",
      );
    }
  }

  async function prepareFolderImportConfirmation(
    dialog: Extract<BackupDialogState, { kind: "existing-file" }>,
  ) {
    try {
      const target = backupTargetFromSelection(dialog.selection);
      const backupRead = await readBackupFile(target, true);
      const { backupTimestamp, payload } = parseAndValidateBackup(
        backupRead.contents,
        backupRead.lastModifiedAt,
      );

      setBackupDialog({
        kind: "confirm-import",
        backupTimestamp,
        fileLastModifiedAt: backupRead.lastModifiedAt,
        fileName: BACKUP_LATEST_FILENAME,
        localTimestamp: dialog.localTimestamp,
        payload,
        source: "folder",
      });
    } catch (error) {
      showToast(
        "danger",
        error instanceof Error
          ? error.message
          : "Could not import this backup.",
      );
    }
  }

  async function runBackup(
    snapshot: AppData,
    manual: boolean,
    successMessage?: string,
  ) {
    setBackupIndicator("running");
    setBackupMessage(manual ? "Backup running" : "Auto backup running");

    try {
      const backupAt = nowIso();
      const completedMessage =
        successMessage ||
        (manual ? "Backup saved." : `Backed up ${formatDateTime(backupAt)}`);

      await writeBackupFile(
        snapshot.settings,
        createBackupPayload(snapshot, backupAt),
      );
      setLastBackupAt(backupAt);
      setBackupIndicator("done");
      setBackupMessage(completedMessage);
      updateBackupMetadata({
        backupStatus: completedMessage,
        lastBackupTimestamp: backupAt,
      });
      if (manual) {
        showToast("success", completedMessage);
      }
      window.setTimeout(
        () =>
          setBackupIndicator((current) =>
            current === "done" ? "saved" : current,
          ),
        2000,
      );
    } catch (error) {
      setBackupIndicator("failed");
      setBackupMessage(
        error instanceof Error ? error.message : "Backup failed",
      );
      if (manual) {
        showToast(
          "danger",
          error instanceof Error ? error.message : "Backup failed.",
        );
      }
    }
  }

  async function chooseCsvFolderPathIfNeeded(currentPath: string) {
    if (currentPath) {
      return currentPath;
    }

    const selection = await chooseCsvFolder();
    applyCsvFolderSelection(selection.directoryPath);
    return selection.directoryPath;
  }

  async function handleChooseCsvFolder() {
    if (!ensurePermission("settings:manage")) {
      return;
    }

    try {
      const selection = await chooseCsvFolder();

      applyCsvFolderSelection(selection.directoryPath);
      showToast("success", "CSV folder selected.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not choose CSV folder.";

      setCsvFolderStatus(message);
      showToast("danger", message);
    }
  }

  async function handleExportCsvFolderNow() {
    if (!ensurePermission("reports:export")) {
      return;
    }

    if (!data) {
      return;
    }

    try {
      const folderPath = await chooseCsvFolderPathIfNeeded(
        data.settings.csvExportFolderPath,
      );
      const folderExists = await checkCsvFolderExists(folderPath);
      const result = await exportCsvFolder(data, folderPath);
      const message = folderExists
        ? `CSV export complete. ${result.filesWritten} files updated.`
        : `CSV export complete. Folder created and ${result.filesWritten} files updated.`;

      updateCsvMetadata({
        csvExportFolderPath: folderPath,
        csvLastExportAt: result.exportedAt,
        csvLastHistoryExportAt:
          result.historyExportedAt || data.settings.csvLastHistoryExportAt,
      });
      setCsvFolderStatus(message);
      showToast("success", message);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "CSV export failed.";

      setCsvFolderStatus(message);
      showToast("danger", message);
    }
  }

  async function handlePrepareCsvFolderImport() {
    if (!ensurePermission("data:import")) {
      return;
    }

    if (!data) {
      return;
    }

    try {
      let folderPath = data.settings.csvExportFolderPath;

      if (folderPath) {
        const useSelectedFolder = window.confirm(
          `Import CSV from the selected folder?\n\n${folderPath}\n\nChoose Cancel to pick a different folder.`,
        );

        if (!useSelectedFolder) {
          folderPath = (await chooseCsvFolder()).directoryPath;
          applyCsvFolderSelection(folderPath);
        }
      } else {
        folderPath = (await chooseCsvFolder()).directoryPath;
        applyCsvFolderSelection(folderPath);
      }

      const files = await readCsvFolderImportFiles(folderPath);
      const preview = buildCsvFolderImportPreview(files, data, folderPath);

      setCsvFolderImportPreview(preview);
      setCsvFolderStatus("CSV folder import ready.");
      showToast("success", "CSV folder import ready.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "CSV folder import failed.";

      setCsvFolderStatus(message);
      showToast("danger", message);
    }
  }

  function handleItemSubmit(event: FormEvent) {
    event.preventDefault();

    if (!data) {
      return;
    }

    const validationWarning = getItemFormValidationWarning(
      itemForm,
      data.settings,
    );

    if (validationWarning) {
      showToast("warning", validationWarning);
      return;
    }

    saveItemForm(itemForm, editingItemId);
  }

  function saveItemForm(formToSave: ItemFormState, itemId: string | null) {
    if (!data) {
      return;
    }

    const wasEditing = Boolean(itemId);
    const newItemId = wasEditing ? "" : createId();

    commitData((current) => {
      const existing = itemId
        ? current.items.find((item) => item.id === itemId)
        : undefined;
      const item = itemFromForm(formToSave, existing, newItemId || undefined);
      const nextItems = existing
        ? current.items.map((candidate) =>
            candidate.id === existing.id ? item : candidate,
          )
        : [item, ...current.items];
      const action = existing ? "Item Updated" : "Item Created";
      const summary = `${item.name}${item.partNumber ? ` (${item.partNumber})` : ""} was ${existing ? "updated" : "created"}.`;

      return addAudit(
        {
          ...current,
          items: nextItems,
        },
        createAuditEntry("Item", item.id, action, summary, "User"),
      );
    });

    showToast("success", wasEditing ? "Item updated." : "Item added.");
    if (!wasEditing) {
      setActivityNow(Date.now());
      setNewestAddedInventoryItemId(newItemId);
      if (!readSeenNewInventoryItemIds().includes(newItemId)) {
        setNewInventoryItemHighlightIds((current) =>
          current.includes(newItemId) ? current : [newItemId, ...current],
        );
      }
    }
    setEditingItemId(null);
    setItemForm(blankItemForm(data?.settings.defaultLocationId ?? ""));
    setIsItemFormOpen(false);
    setActivePage("inventory");
    closeSettingsPanel();
  }

  function chooseNewItemWatchListVisibility(choice: WatchListVisibilityChoice) {
    if (!pendingNewItemVisibilityForm) {
      return;
    }

    saveItemForm(
      applyWatchListVisibilityChoice(pendingNewItemVisibilityForm, choice),
      null,
    );
  }

  function editItem(item: InventoryItem) {
    if (!ensurePermission("inventory:edit")) {
      return;
    }

    setEditingItemId(item.id);
    setItemForm(formFromItem(item));
    setIsItemFormOpen(true);
    openInventoryForItemForm();
  }

  function deleteItem(itemId: string) {
    if (!ensurePermission("inventory:delete")) {
      return;
    }

    if (!data) {
      return;
    }

    const item = data.items.find((candidate) => candidate.id === itemId);

    if (!item) {
      return;
    }

    const deletedRecord = createDeletedRecord(
      "Inventory",
      item,
      `${item.partNumber || item.name} will be kept in Recently Deleted for 30 minutes. Existing audit history remains.`,
    );
    const confirmed = window.confirm(
      `Delete ${item.name}? This moves it to Recently Deleted for 30 minutes so it can be restored.`,
    );

    if (!confirmed) {
      return;
    }

    saveDeletedRecordLive(deletedRecord);

    commitData((current) =>
      addAudit(
        {
          ...current,
          items: current.items.filter((candidate) => candidate.id !== itemId),
          deletedRecords: [
            deletedRecord,
            ...purgeExpiredDeletedRecords(current.deletedRecords ?? []),
          ],
        },
        createAuditEntry(
          "Item",
          itemId,
          "Item Moved to Recently Deleted",
          `${item.name} was deleted.`,
          "User",
        ),
      ),
    );
    showToast(
      "success",
      "Item moved to Recently Deleted for 30 minutes.",
      "Undo",
      () => restoreDeletedRecord(deletedRecord.id),
    );
  }

  function startStockAction(
    itemId: string,
    _actionType: StockActionType | "" = "",
  ) {
    if (!ensurePermission("inventory:stock")) {
      return;
    }

    const item = data?.items.find((candidate) => candidate.id === itemId);
    setStockForm({
      ...blankStockForm(itemId),
      orderPlaced: Boolean(item?.orderPlaced),
      reorderHold: Boolean(item?.reorderHold),
    });
    openPage("stock");
  }

  function updateMinimumStockLevel(itemId: string, minimumStockLevel: number) {
    if (!ensurePermission("inventory:edit")) {
      return;
    }

    if (!data) {
      return;
    }

    const item = data.items.find((candidate) => candidate.id === itemId);

    if (!item) {
      showToast("warning", "Choose an item first.");
      return;
    }

    const nextMinimumStockLevel = Math.max(
      0,
      wholeNumberValue(minimumStockLevel),
    );

    commitData((current) => {
      const currentItem = current.items.find(
        (candidate) => candidate.id === itemId,
      );

      if (!currentItem) {
        return current;
      }

      const updatedAt = nowIso();
      const updatedItem = {
        ...currentItem,
        minimumStockLevel: nextMinimumStockLevel,
        lowStockAlertLevel: normalizeLowStockAlertLevel(
          nextMinimumStockLevel,
          currentItem.lowStockAlertLevel,
        ),
        updatedAt,
      };

      return addAudit(
        {
          ...current,
          items: current.items.map((candidate) =>
            candidate.id === itemId ? updatedItem : candidate,
          ),
        },
        createAuditEntry(
          "Item",
          itemId,
          "Minimum Stock Level Updated",
          `Minimum stock level changed from ${formatNumber(currentItem.minimumStockLevel)} to ${formatNumber(
            updatedItem.minimumStockLevel,
          )} for ${updatedItem.partNumber || updatedItem.name}.`,
          "User",
          updatedAt,
        ),
      );
    });

    showToast("success", "Minimum stock level updated.");
  }

  function updateLowStockAlertLevel(
    itemId: string,
    lowStockAlertLevel: number,
  ) {
    if (!ensurePermission("inventory:edit")) {
      return;
    }

    if (!data) {
      return;
    }

    const item = data.items.find((candidate) => candidate.id === itemId);

    if (!item) {
      showToast("warning", "Choose an item first.");
      return;
    }

    const nextLowStockAlertLevel = normalizeLowStockAlertLevel(
      item.minimumStockLevel,
      lowStockAlertLevel,
    );

    commitData((current) => {
      const currentItem = current.items.find(
        (candidate) => candidate.id === itemId,
      );

      if (!currentItem) {
        return current;
      }

      const updatedAt = nowIso();
      const updatedItem = {
        ...currentItem,
        lowStockAlertLevel: normalizeLowStockAlertLevel(
          currentItem.minimumStockLevel,
          nextLowStockAlertLevel,
        ),
        updatedAt,
      };

      return addAudit(
        {
          ...current,
          items: current.items.map((candidate) =>
            candidate.id === itemId ? updatedItem : candidate,
          ),
        },
        createAuditEntry(
          "Item",
          itemId,
          "Low Stock Alert Level Updated",
          `Low Stock Alert Level changed to ${formatNumber(updatedItem.lowStockAlertLevel)} for ${
            updatedItem.partNumber || updatedItem.name
          }.`,
          "User",
          updatedAt,
        ),
      );
    });
  }

  function handleStockSubmit(event: FormEvent) {
    event.preventDefault();

    if (!ensurePermission("inventory:stock")) {
      return;
    }

    if (!data) {
      return;
    }

    const item = data.items.find(
      (candidate) => candidate.id === stockForm.itemId,
    );

    if (!item) {
      showToast("warning", "Choose an item first.");
      return;
    }

    const nextOrderPlaced = Boolean(stockForm.orderPlaced);
    const nextReorderHold = Boolean(stockForm.reorderHold);
    const orderPlacedChanged = nextOrderPlaced !== Boolean(item.orderPlaced);
    const reorderHoldChanged = nextReorderHold !== Boolean(item.reorderHold);
    const hasFlagChanges = orderPlacedChanged || reorderHoldChanged;
    const quantityText = String(stockForm.quantity).trim();

    if (!quantityText) {
      if (!hasFlagChanges) {
        showToast(
          "warning",
          "Enter a positive or negative quantity or change reorder options.",
        );
        return;
      }
    }

    const quantityChange = quantityText
      ? wholeNumberValue(stockForm.quantity, Number.NaN)
      : 0;

    if (!Number.isFinite(quantityChange)) {
      showToast("warning", "Enter a valid whole number quantity.");
      return;
    }

    if (quantityChange === 0) {
      if (!hasFlagChanges) {
        showToast(
          "warning",
          "Enter a positive or negative quantity or change reorder options.",
        );
        return;
      }
    }

    const hasStockMovement = quantityChange !== 0;
    const actionType: StockActionType =
      quantityChange > 0 ? "Stock In" : "Stock Out";
    const movementQuantity = Math.abs(quantityChange);
    const previousQuantity = item.quantityOnHand;
    const nextQuantity = previousQuantity + quantityChange;
    const willClearOrderPlaced =
      hasStockMovement &&
      item.orderPlaced === true &&
      nextQuantity > previousQuantity &&
      !isReorderNeeded(
        { ...item, quantityOnHand: nextQuantity },
        data.settings,
      );

    if (nextQuantity < 0) {
      showToast("danger", "Not enough stock on hand to pull that quantity.");
      return;
    }

    const occurredAt = dateTimeLocalToIso(stockForm.occurredAt);
    const reason = stockForm.reason.trim();

    commitData((current) => {
      const currentItem = current.items.find(
        (candidate) => candidate.id === item.id,
      );

      if (!currentItem) {
        return current;
      }

      const finalQuantity = currentItem.quantityOnHand + quantityChange;
      const shouldClearOrderPlaced =
        hasStockMovement &&
        currentItem.orderPlaced === true &&
        finalQuantity > currentItem.quantityOnHand &&
        !isReorderNeeded(
          { ...currentItem, quantityOnHand: finalQuantity },
          current.settings,
        );
      const finalOrderPlaced = shouldClearOrderPlaced ? false : nextOrderPlaced;
      let updatedItem = {
        ...currentItem,
        quantityOnHand: finalQuantity,
        orderPlaced: finalOrderPlaced,
        reorderHold: nextReorderHold,
        orderRequisitionId: finalOrderPlaced
          ? currentItem.orderRequisitionId
          : "",
        updatedAt: nowIso(),
      };
      const restockClearSummary = `Item removed from Mark Ordered because it was restocked. Item: ${updatedItem.name}. Part number: ${
        updatedItem.partNumber || "No part number"
      }. Restock quantity: ${formatNumber(movementQuantity)} ${normalizeStockUnit(updatedItem.stockUnit)}. New quantity on hand: ${formatStockQuantity(
        updatedItem,
      )}.`;
      const stockReason = shouldClearOrderPlaced
        ? [reason, restockClearSummary].filter(Boolean).join(" ")
        : reason;

      const stockChange: StockChange = {
        id: createId(),
        itemId: updatedItem.id,
        itemNameSnapshot: updatedItem.name,
        partNumberSnapshot: updatedItem.partNumber,
        vendorNameSnapshot: getVendorName(current, updatedItem.vendorId),
        actionType:
          finalQuantity >= currentItem.quantityOnHand
            ? "Stock In"
            : "Stock Out",
        quantity: movementQuantity,
        reason: stockReason,
        actor: stockForm.actor.trim() || "User",
        notes: stockForm.notes.trim(),
        occurredAt,
        previousQuantity: currentItem.quantityOnHand,
        newQuantity: finalQuantity,
        createdAt: nowIso(),
      };
      const summary = `${getStockActionLabel(stockChange.actionType)}: ${formatNumber(currentItem.quantityOnHand)} -> ${formatNumber(
        finalQuantity,
      )} ${normalizeStockUnit(updatedItem.stockUnit)} for ${updatedItem.name}.`;

      let nextData = {
        ...current,
        items: current.items.map((candidate) =>
          candidate.id === updatedItem.id ? updatedItem : candidate,
        ),
        stockChanges: hasStockMovement
          ? trimStockChangeEntries([stockChange, ...current.stockChanges])
          : current.stockChanges,
      };

      if (hasStockMovement) {
        nextData = addAudit(
          nextData,
          createAuditEntry(
            "Stock",
            stockChange.id,
            stockChange.actionType,
            summary,
            stockChange.actor,
            occurredAt,
          ),
        );
      }

      if (shouldClearOrderPlaced) {
        nextData = addAudit(
          nextData,
          createAuditEntry(
            "Item",
            updatedItem.id,
            "Mark Ordered Cleared",
            restockClearSummary,
            stockChange.actor,
            occurredAt,
          ),
        );
      }

      if (orderPlacedChanged) {
        nextData = addAudit(
          nextData,
          createAuditEntry(
            "Item",
            updatedItem.id,
            nextOrderPlaced
              ? "Order Placed Flag Enabled"
              : "Order Placed Flag Removed",
            nextOrderPlaced
              ? "Order placed flag enabled."
              : "Order placed flag removed.",
            stockForm.actor.trim() || "User",
            occurredAt,
          ),
        );
      }

      if (reorderHoldChanged) {
        nextData = addAudit(
          nextData,
          createAuditEntry(
            "Item",
            updatedItem.id,
            nextReorderHold
              ? "Hold For Reorder Enabled"
              : "Hold For Reorder Removed",
            nextReorderHold
              ? "Hold for reorder enabled."
              : "Hold for reorder removed.",
            stockForm.actor.trim() || "User",
            occurredAt,
          ),
        );
      }

      return nextData;
    });

    showToast(
      "success",
      hasStockMovement
        ? `${getStockActionLabel(actionType)} saved${willClearOrderPlaced ? " and Mark Ordered cleared" : ""}.`
        : "Reorder options saved.",
    );
    setStockForm({
      ...blankStockForm(item.id),
      orderPlaced: willClearOrderPlaced ? false : nextOrderPlaced,
      reorderHold: nextReorderHold,
    });
  }

  function handleLocationSubmit(event: FormEvent) {
    event.preventDefault();

    if (!ensurePermission("locations:manage")) {
      return;
    }

    if (!locationForm.name.trim()) {
      showToast("warning", "Location name is required.");
      return;
    }

    commitData((current) => {
      const location = createLocation(locationForm.name.trim(), {
        description: locationForm.description.trim(),
        notes: locationForm.notes.trim(),
      });
      const nextSettings = current.settings.defaultLocationId
        ? current.settings
        : {
            ...current.settings,
            defaultLocationId: location.id,
            updatedAt: nowIso(),
          };

      return addAudit(
        {
          ...current,
          locations: [...current.locations, location],
          settings: nextSettings,
        },
        createAuditEntry(
          "Location",
          location.id,
          "Location Created",
          `${location.name} was added.`,
          "User",
        ),
      );
    });
    setLocationForm(blankLocationForm());
    setIsAddLocationOpen(false);
    showToast("success", "Location added.");
  }

  function deleteLocation(locationId: string) {
    if (!ensurePermission("locations:delete")) {
      return;
    }

    if (!data) {
      return;
    }

    const location = data.locations.find(
      (candidate) => candidate.id === locationId,
    );
    const inUse = data.items.some((item) => item.locationId === locationId);

    if (!location) {
      return;
    }

    if (inUse) {
      showToast("warning", "That location is assigned to inventory items.");
      return;
    }

    const deletedRecord = createDeletedRecord(
      "Location",
      location,
      "This location will be kept in Recently Deleted for 30 minutes.",
    );
    const confirmed = window.confirm(
      `Delete ${location.name}? This moves it to Recently Deleted for 30 minutes so it can be restored.`,
    );

    if (!confirmed) {
      return;
    }

    saveDeletedRecordLive(deletedRecord);

    commitData((current) =>
      addAudit(
        {
          ...current,
          locations: current.locations.filter(
            (candidate) => candidate.id !== locationId,
          ),
          deletedRecords: [
            deletedRecord,
            ...purgeExpiredDeletedRecords(current.deletedRecords ?? []),
          ],
          settings:
            current.settings.defaultLocationId === locationId
              ? {
                  ...current.settings,
                  defaultLocationId: "",
                  updatedAt: nowIso(),
                }
              : current.settings,
        },
        createAuditEntry(
          "Location",
          locationId,
          "Location Moved to Recently Deleted",
          `${location.name} was deleted.`,
          "User",
        ),
      ),
    );
    showToast(
      "success",
      "Location moved to Recently Deleted for 30 minutes.",
      "Undo",
      () => restoreDeletedRecord(deletedRecord.id),
    );
  }

  async function suggestVendorNoteWithWebsite(vendor: VendorNoteContext) {
    if (!vendor.website.trim()) {
      return "";
    }

    const websitePreview = await readVendorWebsitePreview(vendor.website);

    return suggestVendorNoteFromContext({ vendor, websitePreview });
  }

  function openVendorAiPurposePrompt(
    prompt: VendorAiPromptState,
    resolve?: (note: string | null) => void,
  ) {
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

  async function handleInlineVendorAiHelp(
    vendor: VendorRecord,
    currentDraft: string,
  ) {
    const vendorContext = vendorRecordNoteContext(vendor, currentDraft);

    if (vendorContext.website.trim()) {
      const note = await suggestVendorNoteWithWebsite(vendorContext);

      if (note) {
        return note;
      }
    }

    return new Promise<string | null>((resolve) => {
      openVendorAiPurposePrompt(
        { source: "inline", vendorId: vendor.id, draft: currentDraft },
        resolve,
      );
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
        userPurpose,
      });

      setVendorForm((current) => ({ ...current, notes: note }));
      closeVendorAiPurposePrompt();
      return;
    }

    const vendor = data?.vendors.find(
      (candidate) => candidate.id === vendorAiPrompt.vendorId,
    );

    if (!vendor) {
      showToast("warning", "That vendor could not be found.");
      closeVendorAiPurposePrompt(null);
      return;
    }

    const note = suggestVendorNoteFromContext({
      vendor: vendorRecordNoteContext(
        vendor,
        vendorAiPrompt.draft ?? vendor.notes,
      ),
      userPurpose,
    });

    closeVendorAiPurposePrompt(note);
  }

  function handleVendorSubmit(event: FormEvent) {
    event.preventDefault();

    if (!ensurePermission("vendors:manage")) {
      return;
    }

    const submittedVendorForm = {
      name: vendorForm.name.trim(),
      contactName: vendorForm.contactName.trim(),
      contactEmail: vendorForm.contactEmail.trim(),
      phone: vendorForm.phone.trim(),
      email: vendorForm.email.trim(),
      website: vendorForm.website.trim(),
      notes: vendorForm.notes.trim(),
    };

    if (!submittedVendorForm.name) {
      showToast("warning", "Vendor name is required.");
      return;
    }

    if (
      editingVendorId &&
      !data?.vendors.some((vendor) => vendor.id === editingVendorId)
    ) {
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
                    updatedAt,
                  }
                : vendor,
            ),
          },
          createAuditEntry(
            "Vendor",
            editingVendorId,
            "Vendor Updated",
            `${submittedVendorForm.name} was updated.`,
            "User",
            updatedAt,
          ),
        );
      }

      const vendor = createVendor(submittedVendorForm.name, {
        contactName: submittedVendorForm.contactName,
        contactEmail: submittedVendorForm.contactEmail,
        phone: submittedVendorForm.phone,
        email: submittedVendorForm.email,
        website: submittedVendorForm.website,
        notes: submittedVendorForm.notes,
      });

      return addAudit(
        {
          ...current,
          vendors: [...current.vendors, vendor],
        },
        createAuditEntry(
          "Vendor",
          vendor.id,
          "Vendor Created",
          `${vendor.name} was added.`,
          "User",
        ),
      );
    });
    setVendorForm(blankVendorForm());
    setEditingVendorId(null);
    setIsAddVendorOpen(false);
    setActivityNow(Date.now());
    showToast("success", isEditingVendor ? "Vendor updated." : "Vendor added.");
  }

  function startEditVendor(vendor: VendorRecord) {
    if (!ensurePermission("vendors:manage")) {
      return;
    }

    setEditingVendorId(vendor.id);
    setVendorForm({
      name: vendor.name,
      contactName: vendor.contactName,
      contactEmail: vendor.contactEmail,
      phone: vendor.phone,
      email: vendor.email,
      website: vendor.website,
      notes: vendor.notes,
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

    if (!ensurePermission("vendors:manage")) {
      return;
    }

    setEditingVendorId(null);
    setIsAddVendorOpen(true);
  }

  function updateVendorNotes(vendorId: string, notes: string) {
    if (!ensurePermission("vendors:manage")) {
      return;
    }

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
            candidate.id === vendorId
              ? { ...candidate, notes: cleanNotes, updatedAt }
              : candidate,
          ),
        },
        createAuditEntry(
          "Vendor",
          vendorId,
          "Vendor Notes Updated",
          `${vendor.name} notes were updated.`,
          "User",
          updatedAt,
        ),
      ),
    );
    setActivityNow(Date.now());
    setRecentlySavedVendorNoteId(vendorId);
    window.setTimeout(() => {
      setRecentlySavedVendorNoteId((current) =>
        current === vendorId ? null : current,
      );
    }, 2500);
    showToast("success", "Vendor notes updated.");
  }

  function deleteVendor(vendorId: string) {
    if (!ensurePermission("vendors:delete")) {
      return;
    }

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

    const deletedRecord = createDeletedRecord(
      "Vendor",
      vendor,
      "This vendor will be kept in Recently Deleted for 30 minutes.",
    );
    const confirmed = window.confirm(
      `Delete ${vendor.name}? This moves it to Recently Deleted for 30 minutes so it can be restored.`,
    );

    if (!confirmed) {
      return;
    }

    saveDeletedRecordLive(deletedRecord);

    commitData((current) =>
      addAudit(
        {
          ...current,
          vendors: current.vendors.filter(
            (candidate) => candidate.id !== vendorId,
          ),
          deletedRecords: [
            deletedRecord,
            ...purgeExpiredDeletedRecords(current.deletedRecords ?? []),
          ],
        },
        createAuditEntry(
          "Vendor",
          vendorId,
          "Vendor Moved to Recently Deleted",
          `${vendor.name} was deleted.`,
          "User",
        ),
      ),
    );
    showToast(
      "success",
      "Vendor moved to Recently Deleted for 30 minutes.",
      "Undo",
      () => restoreDeletedRecord(deletedRecord.id),
    );
  }

  function updateSettings(
    settings: AppSettings,
    auditSummary = "Settings were updated.",
  ) {
    if (!ensurePermission("settings:manage")) {
      return;
    }

    commitData((current) =>
      addAudit(
        {
          ...current,
          settings: {
            ...settings,
            updatedAt: nowIso(),
          },
        },
        createAuditEntry(
          "Settings",
          "appSettings",
          "Settings Updated",
          auditSummary,
          "User",
        ),
      ),
    );
  }

  async function handleChooseBackupFolder() {
    if (!ensurePermission("settings:manage")) {
      return;
    }

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
        const backupRead = await readBackupFile(
          backupTargetFromSelection(selection),
          true,
        );

        setBackupDialog({
          kind: "existing-file",
          backupRead,
          localTimestamp,
          selection,
        });
      } catch (error) {
        if (isMissingBackupFileError(error)) {
          setBackupDialog({ kind: "no-file", selection });
          return;
        }

        throw error;
      }
    } catch (error) {
      showToast(
        "danger",
        error instanceof Error
          ? error.message
          : "Could not choose backup folder.",
      );
    }
  }

  async function handleOverwriteSelectedBackup(
    selection: BackupDirectorySelection,
  ) {
    if (!data) {
      return;
    }

    setBackupDialog(null);
    await runBackup(
      dataWithBackupSelection(data, selection),
      true,
      "Backup folder set. Current inventory data saved to backup file.",
    );
  }

  async function handleSaveBackupInEmptyFolder(
    selection: BackupDirectorySelection,
  ) {
    if (!data) {
      return;
    }

    setBackupDialog(null);
    await runBackup(
      dataWithBackupSelection(data, selection),
      true,
      "Backup folder set. Current inventory data saved to backup file.",
    );
  }

  function handleImportConfirmation(
    dialog: Extract<BackupDialogState, { kind: "confirm-import" }>,
  ) {
    if (!ensurePermission("data:import")) {
      return;
    }

    const message =
      dialog.source === "manual"
        ? "JSON import complete."
        : "Backup imported successfully.";

    void applyImportedBackup(
      dialog.payload,
      dialog.source,
      dialog.fileName,
      message,
    );
  }

  async function handleCreateRecoveryCode() {
    const confirmed = window.confirm(
      "Create a new recovery code? The old recovery code will no longer work. Your password will not be changed.",
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
      showToast(
        "danger",
        error instanceof Error
          ? error.message
          : "Could not create a new recovery code.",
      );
    }
  }

  function handleExportJson() {
    if (!ensurePermission("data:export")) {
      return;
    }

    if (!data) {
      return;
    }

    downloadTextFile(
      `maintenance-inventory-tracker-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(createBackupPayload(data), null, 2),
      "application/json",
    );
    setBackupIndicator("done");
    setBackupMessage("JSON export created");
    window.setTimeout(
      () =>
        setBackupIndicator((current) =>
          current === "done" ? "saved" : current,
        ),
      2000,
    );
  }

  async function handleImportJson(file: File) {
    if (!ensurePermission("data:import")) {
      return;
    }

    try {
      const contents = await file.text();
      const fileLastModifiedAt = file.lastModified
        ? new Date(file.lastModified).toISOString()
        : null;
      const { backupTimestamp, payload } = parseAndValidateBackup(
        contents,
        fileLastModifiedAt,
      );

      setBackupDialog({
        kind: "confirm-import",
        backupTimestamp,
        fileLastModifiedAt,
        fileName: file.name,
        localTimestamp: data ? getLocalDataUpdatedAt(data) : null,
        payload,
        source: "manual",
      });
    } catch (error) {
      showToast(
        "danger",
        error instanceof Error ? error.message : "JSON import failed.",
      );
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
      "Updated At",
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
      item.updatedAt,
    ]);

    return rowsToCsv(headers, rows);
  }

  function getHistoryExportCsv() {
    if (!data) {
      return "";
    }

    const headers = [
      "id",
      "itemId",
      "partNumber",
      "itemName",
      "vendor",
      "actionType",
      "oldQuantity",
      "quantityChange",
      "newQuantity",
      "reason",
      "usedBy",
      "notes",
      "dateTime",
      "createdAt",
    ];
    const rows = data.stockChanges
      .slice()
      .sort(
        (left, right) =>
          left.occurredAt.localeCompare(right.occurredAt) ||
          left.id.localeCompare(right.id),
      )
      .map((change) => [
        change.id,
        change.itemId,
        change.partNumberSnapshot,
        change.itemNameSnapshot,
        change.vendorNameSnapshot,
        change.actionType,
        change.previousQuantity,
        change.actionType === "Stock Out"
          ? -Math.abs(change.quantity)
          : Math.abs(change.quantity),
        change.newQuantity,
        change.reason,
        change.actor,
        change.notes,
        change.occurredAt,
        change.createdAt,
      ]);

    return rowsToCsv(headers, rows);
  }

  function handleExportCsv() {
    if (!ensurePermission("reports:export")) {
      return;
    }

    if (!data) {
      return;
    }

    downloadTextFile(
      `maintenance-inventory-export-${new Date().toISOString().slice(0, 10)}.csv`,
      getInventoryExportCsv(),
      "text/csv;charset=utf-8",
    );
    showToast("success", "CSV export downloaded.");
  }

  function handleExportHistoryCsv() {
    if (!ensurePermission("reports:export")) {
      return;
    }

    if (!data) {
      return;
    }

    downloadTextFile(
      `maintenance-inventory-history-${new Date().toISOString().slice(0, 10)}.csv`,
      getHistoryExportCsv(),
      "text/csv;charset=utf-8",
    );
    showToast("success", "History CSV downloaded.");
  }

  function handleExportExcelCsv() {
    if (!ensurePermission("reports:export")) {
      return;
    }

    if (!data) {
      return;
    }

    downloadTextFile(
      `maintenance-inventory-excel-export-${new Date().toISOString().slice(0, 10)}.csv`,
      getInventoryExportCsv(),
      "text/csv;charset=utf-8",
    );
    showToast("success", "CSV export downloaded.");
  }

  async function handleExportExcelTemplate() {
    if (!ensurePermission("reports:export")) {
      return;
    }

    if (!data) {
      return;
    }

    try {
      const blob = await buildInventoryExcelTemplate({
        items: data.items,
        locations: data.locations,
        vendors: data.vendors,
      });

      downloadBlobFile(MIT3_INVENTORY_TEMPLATE_FILENAME, blob);
      showToast("success", "Excel update template downloaded.");
    } catch (error) {
      showToast(
        "danger",
        error instanceof Error ? error.message : "Excel template export failed.",
      );
    }
  }

  async function handleExportBlankImportTemplate() {
    if (!ensurePermission("reports:export")) {
      return;
    }

    try {
      const blob = await buildBlankInventoryExcelTemplate();

      downloadBlobFile(MIT3_BLANK_INVENTORY_TEMPLATE_FILENAME, blob);
      showToast("success", "Blank inventory import template downloaded.");
    } catch (error) {
      showToast(
        "danger",
        error instanceof Error ? error.message : "Blank import template export failed.",
      );
    }
  }

  async function handleInventoryImportFile(file: File) {
    if (/\.xlsx$/i.test(file.name)) {
      await handleImportExcelTemplate(file);
      return;
    }

    await handleImportCsv(file);
  }

  async function handleImportExcelTemplate(file: File) {
    if (!ensurePermission("data:import")) {
      return;
    }

    if (!data) {
      return;
    }

    try {
      const preview = await readInventoryExcelTemplate(file, data.items);
      const result = importExcelTemplateRows(preview);
      const warningText =
        preview.warnings.length > 0
          ? ` ${preview.warnings.length} warning(s).`
          : "";

      showToast(
        preview.warnings.length > 0 ? "warning" : "success",
        `Excel template import complete. ${result.created} created, ${result.updated} updated, ${result.locationsCreated} new location(s), ${result.vendorsCreated} new vendor(s), ${result.skipped} skipped, ${result.duplicatePartNumberMatches} duplicate part number match(es), ${result.hyperlinksImported} hyperlink(s) imported, ${result.hyperlinksSkipped} hyperlink(s) skipped.${warningText}`,
      );
    } catch (error) {
      showToast(
        "danger",
        error instanceof Error ? error.message : "Excel template import failed.",
      );
    }
  }

  async function handleImportCsv(file: File) {
    if (!ensurePermission("data:import")) {
      return;
    }

    if (!data) {
      return;
    }

    try {
      const contents = await file.text();
      const preview = buildCsvImportPreview(contents, data, file.name);

      setCsvImportPreview(preview);
      showToast("success", "CSV import ready.");
    } catch (error) {
      showToast(
        "danger",
        error instanceof Error ? error.message : "CSV import failed.",
      );
    }
  }

  function confirmCsvImport() {
    if (!ensurePermission("data:import")) {
      return;
    }

    if (!data || !csvImportPreview) {
      return;
    }

    try {
      const preview = buildCsvImportPreview(
        csvImportPreview.contents,
        data,
        csvImportPreview.fileName,
      );
      const result = importCsvRows(preview);

      setCsvImportPreview(null);
      if (result.created > 0 || result.vendorsCreated > 0) {
        setActivityNow(Date.now());
      }
      showToast(
        "success",
        `CSV import complete. ${result.created} created, ${result.updated} updated, ${result.locationsCreated} new location(s), ${result.vendorsCreated} new vendor(s), ${Math.max(0, result.rowsFound - result.created - result.updated)} skipped.`,
      );
    } catch (error) {
      showToast(
        "danger",
        error instanceof Error ? error.message : "CSV import failed.",
      );
    }
  }

  function importExcelTemplateRows(preview: InventoryExcelTemplatePreview) {
    const result = {
      created: 0,
      skipped: preview.skippedRows,
      updated: 0,
      duplicatePartNumberMatches: preview.duplicatePartNumberMatches,
      hyperlinksImported: 0,
      hyperlinksSkipped: preview.hyperlinksSkipped,
      locationsCreated: 0,
      vendorsCreated: 0,
    };

    if (!data) {
      return result;
    }

    const current = data;
    const importedAt = nowIso();
    const nextItems = [...current.items];
    const nextLocations = [...current.locations];
    const nextVendors = [...current.vendors];
    const auditEntries: AuditEntry[] = [];
    const createdLocationNoticeIds: string[] = [];
    const createdVendorNoticeIds: string[] = [];

    const findOrCreateLocation = (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return "";
      const existing = nextLocations.find((location) => nameKey(location.name) === nameKey(trimmed));
      if (existing) return existing.id;
      const location = createLocation(trimmed);
      nextLocations.push(location);
      createdLocationNoticeIds.push(location.id);
      result.locationsCreated += 1;
      return location.id;
    };

    const findOrCreateVendor = (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return "";
      const existing = nextVendors.find((vendor) => nameKey(vendor.name) === nameKey(trimmed));
      if (existing) return existing.id;
      const vendor = createVendor(trimmed);
      nextVendors.push(vendor);
      createdVendorNoticeIds.push(vendor.id);
      result.vendorsCreated += 1;
      return vendor.id;
    };

    preview.records.forEach((record) => {
      const existingIndex = record.id
        ? nextItems.findIndex((item) => item.id === record.id)
        : nextItems.findIndex(
            (item) => nameKey(item.partNumber) === nameKey(record.partNumber),
          );
      const existing = existingIndex >= 0 ? nextItems[existingIndex] : undefined;
      const minimumStockLevel = Math.max(
        0,
        record.minimumStockLevel ?? existing?.minimumStockLevel ?? 0,
      );
      const lowStockAlertLevel = normalizeLowStockAlertLevel(
        minimumStockLevel,
        record.lowStockAlertLevel ?? existing?.lowStockAlertLevel ?? defaultLowStockAlertLevel(),
      );
      const name = record.description || existing?.name || record.partNumber;
      const importedItem = itemFromForm(
        {
          name,
          partNumber: record.partNumber || existing?.partNumber || "",
          description: record.description || existing?.description || "",
          category: record.category || existing?.category || "Other",
          quantityOnHand: Math.max(0, record.quantityOnHand ?? existing?.quantityOnHand ?? 0),
          stockUnit: existing?.stockUnit || DEFAULT_STOCK_UNIT,
          minimumStockLevel,
          lowStockAlertLevel,
          locationId: findOrCreateLocation(record.locationName) || existing?.locationId || current.settings.defaultLocationId,
          vendorId: findOrCreateVendor(record.vendorName) || existing?.vendorId || "",
          costEach: Math.max(0, record.costEach ?? existing?.costEach ?? 0),
          itemUrl: record.itemUrl || existing?.itemUrl || "",
          notes: record.notes || existing?.notes || "",
          imagePlaceholder: existing?.imagePlaceholder || "",
          imageDataUrl: existing?.imageDataUrl || "",
          barcodePlaceholder: existing?.barcodePlaceholder || "",
          reorderHold: existing?.reorderHold === true,
          orderPlaced: existing?.orderPlaced === false ? false : true,
          hiddenFromWatchList: existing?.hiddenFromWatchList === true,
          nonStocked: existing?.nonStocked === true,
        },
        existing,
      );

      if (existing && existingIndex >= 0) {
        nextItems[existingIndex] = { ...importedItem, updatedAt: importedAt };
        result.updated += 1;
        auditEntries.push(createAuditEntry("Item", importedItem.id, "Excel Template Item Updated", `${importedItem.partNumber || importedItem.name} was updated from Excel template.`, "Excel Import"));
      } else {
        nextItems.unshift(importedItem);
        result.created += 1;
        auditEntries.push(createAuditEntry("Item", importedItem.id, "Excel Template Item Created", `${importedItem.partNumber || importedItem.name} was created from Excel template.`, "Excel Import"));
      }

      if (record.itemUrl) {
        result.hyperlinksImported += 1;
      }
    });

    auditEntries.push(
      createAuditEntry(
        "Import",
        "excel-template",
        "Excel Template Import Completed",
        `Excel template import completed: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped.`,
        "Excel Import",
      ),
    );

    setData(
      stampData({
        ...current,
        items: nextItems,
        locations: nextLocations,
        vendors: nextVendors,
        auditLog: trimAuditLogEntries([
          ...auditEntries.reverse(),
          ...current.auditLog,
        ]),
      }),
    );

    addNewLocationNotices(createdLocationNoticeIds);
    addNewVendorNotices(createdVendorNoticeIds);

    return result;
  }

  function importCsvRows(preview: CsvImportPreview): CsvImportResult {
    let result: CsvImportResult = {
      created: 0,
      locationsCreated: 0,
      rowsFound: preview.rowsFound,
      updated: 0,
      vendorsCreated: 0,
    };

    if (!data) {
      return result;
    }

    const current = data;
    const nextLocations = [...current.locations];
    const nextVendors = [...current.vendors];
    const nextItems = [...current.items];
    const auditEntries: AuditEntry[] = [];
    const createdLocationNoticeIds: string[] = [];
    const createdVendorNoticeIds: string[] = [];

    const findOrCreateLocation = (name: string) => {
      const trimmed = name.trim();

      if (!trimmed) {
        return "";
      }

      const existing = nextLocations.find(
        (location) => location.name.toLowerCase() === trimmed.toLowerCase(),
      );

      if (existing) {
        return existing.id;
      }

      const location = createLocation(trimmed);

      nextLocations.push(location);
      createdLocationNoticeIds.push(location.id);
      result = { ...result, locationsCreated: result.locationsCreated + 1 };
      auditEntries.push(
        createAuditEntry(
          "Location",
          location.id,
          "Location Created",
          `${trimmed} was imported.`,
          "CSV Import",
        ),
      );
      return location.id;
    };

    const findOrCreateVendor = (name: string) => {
      const trimmed = name.trim();

      if (!trimmed) {
        return "";
      }

      const existing = nextVendors.find(
        (vendor) => vendor.name.toLowerCase() === trimmed.toLowerCase(),
      );

      if (existing) {
        return existing.id;
      }

      const vendor = createVendor(trimmed);

      nextVendors.push(vendor);
      createdVendorNoticeIds.push(vendor.id);
      result = { ...result, vendorsCreated: result.vendorsCreated + 1 };
      auditEntries.push(
        createAuditEntry(
          "Vendor",
          vendor.id,
          "Vendor Created",
          `${trimmed} was imported.`,
          "CSV Import",
        ),
      );
      return vendor.id;
    };

    preview.records.forEach((record) => {
      const existingIndex = nextItems.findIndex((item) =>
        record.partNumber
          ? item.partNumber.toLowerCase() === record.partNumber.toLowerCase()
          : item.name.toLowerCase() === record.name.toLowerCase(),
      );
      const existing =
        existingIndex >= 0 ? nextItems[existingIndex] : undefined;
      const name = record.name || existing?.name || record.partNumber;
      const minimumStockLevel = Math.max(
        0,
        record.minimumStockLevel ?? existing?.minimumStockLevel ?? 0,
      );
      const lowStockAlertLevel = normalizeLowStockAlertLevel(
        minimumStockLevel,
        record.lowStockAlertLevel ?? defaultLowStockAlertLevel(),
      );
      const importedItem = itemFromForm(
        {
          name,
          partNumber: record.partNumber || existing?.partNumber || "",
          description: record.description || existing?.description || "",
          category: record.category || existing?.category || "Other",
          quantityOnHand: Math.max(
            0,
            record.quantityOnHand ?? existing?.quantityOnHand ?? 0,
          ),
          stockUnit:
            record.stockUnit || existing?.stockUnit || DEFAULT_STOCK_UNIT,
          minimumStockLevel,
          lowStockAlertLevel,
          locationId:
            findOrCreateLocation(record.locationName) ||
            existing?.locationId ||
            current.settings.defaultLocationId,
          vendorId:
            findOrCreateVendor(record.vendorName) || existing?.vendorId || "",
          costEach: Math.max(0, record.costEach ?? existing?.costEach ?? 0),
          itemUrl: record.itemUrl || existing?.itemUrl || "",
          notes: record.notes || existing?.notes || "",
          imagePlaceholder: existing?.imagePlaceholder || "",
          imageDataUrl: existing?.imageDataUrl || "",
          barcodePlaceholder: existing?.barcodePlaceholder || "",
          reorderHold: existing?.reorderHold === true,
          orderPlaced: existing?.orderPlaced === false ? false : true,
          hiddenFromWatchList: existing?.hiddenFromWatchList === true,
          nonStocked: existing?.nonStocked === true,
        },
        existing,
      );

      if (existing && existingIndex >= 0) {
        nextItems[existingIndex] = importedItem;
        result = { ...result, updated: result.updated + 1 };
        auditEntries.push(
          createAuditEntry(
            "Item",
            importedItem.id,
            "CSV Item Updated",
            `${name} was updated from CSV.`,
            "CSV Import",
          ),
        );
      } else {
        nextItems.unshift(importedItem);
        result = { ...result, created: result.created + 1 };
        auditEntries.push(
          createAuditEntry(
            "Item",
            importedItem.id,
            "CSV Item Created",
            `${name} was imported from CSV.`,
            "CSV Import",
          ),
        );
      }
    });

    auditEntries.push(
      createAuditEntry(
        "Import",
        "csv",
        "CSV Import Completed",
        `CSV import completed: ${result.created} created, ${result.updated} updated.`,
        "CSV Import",
      ),
    );

    setData(
      stampData({
        ...current,
        items: nextItems,
        locations: nextLocations,
        vendors: nextVendors,
        auditLog: trimAuditLogEntries([
          ...auditEntries.reverse(),
          ...current.auditLog,
        ]),
      }),
    );

    addNewLocationNotices(createdLocationNoticeIds);
    addNewVendorNotices(createdVendorNoticeIds);

    return result;
  }

  function importCsvFolderRows(
    preview: CsvFolderImportPreview,
  ): CsvFolderImportResult {
    let result: CsvFolderImportResult = {
      created: 0,
      locationsCreated: 0,
      locationsUpdated: 0,
      updated: 0,
      vendorsCreated: 0,
      vendorsUpdated: 0,
    };

    if (!data) {
      return result;
    }

    const current = data;
    const importedAt = nowIso();
    const nextLocations = [...current.locations];
    const nextVendors = [...current.vendors];
    const nextItems = [...current.items];
    const auditEntries: AuditEntry[] = [];
    const importedCategories = new Set<string>();
    const createdLocationNoticeIds: string[] = [];
    const createdVendorNoticeIds: string[] = [];

    const upsertVendor = (record: CsvFolderVendorRecord) => {
      const existing = existingVendorMatch(record, nextVendors);
      const existingIndex = existing
        ? nextVendors.findIndex((vendor) => vendor.id === existing.id)
        : -1;

      if (existing && existingIndex >= 0) {
        const updatedVendor: VendorRecord = {
          ...existing,
          name: record.name || existing.name,
          contactName: record.contactName || existing.contactName,
          contactEmail: record.contactEmail || existing.contactEmail,
          phone: record.phone || existing.phone,
          email: record.email || existing.email,
          website: record.website || existing.website,
          notes: record.notes || existing.notes,
          updatedAt: record.updatedAt || importedAt,
        };

        nextVendors[existingIndex] = updatedVendor;
        result = { ...result, vendorsUpdated: result.vendorsUpdated + 1 };
        auditEntries.push(
          createAuditEntry(
            "Vendor",
            updatedVendor.id,
            "CSV Vendor Updated",
            `${updatedVendor.name} was updated from CSV.`,
            "CSV Import",
          ),
        );
        return updatedVendor.id;
      }

      const vendor = createVendor(record.name, {
        contactName: record.contactName,
        contactEmail: record.contactEmail,
        createdAt: record.createdAt || undefined,
        email: record.email,
        id: record.id || undefined,
        notes: record.notes,
        phone: record.phone,
        updatedAt: record.updatedAt || undefined,
        website: record.website,
      });

      nextVendors.push(vendor);
      createdVendorNoticeIds.push(vendor.id);
      result = { ...result, vendorsCreated: result.vendorsCreated + 1 };
      auditEntries.push(
        createAuditEntry(
          "Vendor",
          vendor.id,
          "CSV Vendor Created",
          `${vendor.name} was imported from CSV.`,
          "CSV Import",
        ),
      );
      return vendor.id;
    };

    const upsertLocation = (record: CsvFolderLocationRecord) => {
      const existing = existingLocationMatch(record, nextLocations);
      const existingIndex = existing
        ? nextLocations.findIndex((location) => location.id === existing.id)
        : -1;

      if (existing && existingIndex >= 0) {
        const updatedLocation: LocationRecord = {
          ...existing,
          name: record.name || existing.name,
          description: record.description || existing.description,
          notes: record.notes || existing.notes,
          updatedAt: record.updatedAt || importedAt,
        };

        nextLocations[existingIndex] = updatedLocation;
        result = { ...result, locationsUpdated: result.locationsUpdated + 1 };
        auditEntries.push(
          createAuditEntry(
            "Location",
            updatedLocation.id,
            "CSV Location Updated",
            `${updatedLocation.name} was updated from CSV.`,
            "CSV Import",
          ),
        );
        return updatedLocation.id;
      }

      const location = createLocation(record.name, {
        createdAt: record.createdAt || undefined,
        description: record.description,
        id: record.id || undefined,
        notes: record.notes,
        updatedAt: record.updatedAt || undefined,
      });

      nextLocations.push(location);
      createdLocationNoticeIds.push(location.id);
      result = { ...result, locationsCreated: result.locationsCreated + 1 };
      auditEntries.push(
        createAuditEntry(
          "Location",
          location.id,
          "CSV Location Created",
          `${location.name} was imported from CSV.`,
          "CSV Import",
        ),
      );
      return location.id;
    };

    preview.vendorRecords.forEach(upsertVendor);
    preview.locationRecords.forEach(upsertLocation);

    const findOrCreateVendorId = (record: CsvFolderInventoryRecord) => {
      if (record.vendorId) {
        const existingById = nextVendors.find(
          (vendor) => vendor.id === record.vendorId,
        );

        if (existingById) {
          return existingById.id;
        }
      }

      const existingByName = uniqueRecordByName(nextVendors, record.vendorName);

      if (existingByName) {
        return existingByName.id;
      }

      if (!record.vendorName) {
        return "";
      }

      return upsertVendor({
        id: record.vendorId,
        name: record.vendorName,
        contactName: "",
        contactEmail: "",
        phone: "",
        email: "",
        website: "",
        notes: "",
        createdAt: "",
        updatedAt: "",
      });
    };

    const findOrCreateLocationId = (record: CsvFolderInventoryRecord) => {
      if (record.locationId) {
        const existingById = nextLocations.find(
          (location) => location.id === record.locationId,
        );

        if (existingById) {
          return existingById.id;
        }
      }

      const existingByName = uniqueRecordByName(
        nextLocations,
        record.locationName,
      );

      if (existingByName) {
        return existingByName.id;
      }

      if (!record.locationName) {
        return "";
      }

      return upsertLocation({
        id: record.locationId,
        name: record.locationName,
        description: "",
        notes: "",
        createdAt: "",
        updatedAt: "",
      });
    };

    preview.inventoryRecords.forEach((record) => {
      const existing = existingInventoryMatch(record, nextItems);
      const existingIndex = existing
        ? nextItems.findIndex((item) => item.id === existing.id)
        : -1;
      const minimumStockLevel = Math.max(
        0,
        record.minimumStockLevel ?? existing?.minimumStockLevel ?? 0,
      );
      const lowStockAlertLevel = normalizeLowStockAlertLevel(
        minimumStockLevel,
        record.lowStockAlertLevel ??
          existing?.lowStockAlertLevel ??
          defaultLowStockAlertLevel(),
      );
      const category = record.category || existing?.category || "Other";
      const name =
        record.name || existing?.name || record.partNumber || "Imported Item";

      if (category) {
        importedCategories.add(category);
      }

      const importedItem = itemFromForm(
        {
          name,
          partNumber: record.partNumber || existing?.partNumber || "",
          description: record.description || existing?.description || "",
          category,
          quantityOnHand: Math.max(
            0,
            record.quantityOnHand ?? existing?.quantityOnHand ?? 0,
          ),
          stockUnit:
            record.stockUnit || existing?.stockUnit || DEFAULT_STOCK_UNIT,
          minimumStockLevel,
          lowStockAlertLevel,
          locationId:
            findOrCreateLocationId(record) ||
            existing?.locationId ||
            current.settings.defaultLocationId,
          vendorId: findOrCreateVendorId(record) || existing?.vendorId || "",
          costEach: Math.max(0, record.costEach ?? existing?.costEach ?? 0),
          itemUrl: record.itemUrl || existing?.itemUrl || "",
          notes: record.notes || existing?.notes || "",
          imagePlaceholder: existing?.imagePlaceholder || "",
          imageDataUrl: existing?.imageDataUrl || "",
          barcodePlaceholder: existing?.barcodePlaceholder || "",
          orderPlaced: record.orderPlaced ?? existing?.orderPlaced ?? true,
          reorderHold: record.reorderHold ?? existing?.reorderHold ?? false,
          hiddenFromWatchList: record.hiddenFromWatchList ?? existing?.hiddenFromWatchList ?? false,
          nonStocked: record.nonStocked ?? existing?.nonStocked ?? false,
        },
        existing,
      );
      const nextItem: InventoryItem = {
        ...importedItem,
        id: (existing?.id ?? record.id) || importedItem.id,
        createdAt:
          (existing?.createdAt ?? record.createdAt) || importedItem.createdAt,
        updatedAt: record.updatedAt || importedAt,
      };

      if (existing && existingIndex >= 0) {
        nextItems[existingIndex] = nextItem;
        result = { ...result, updated: result.updated + 1 };
        auditEntries.push(
          createAuditEntry(
            "Item",
            nextItem.id,
            "CSV Item Updated",
            `${name} was updated from CSV folder.`,
            "CSV Import",
          ),
        );
      } else {
        nextItems.unshift(nextItem);
        result = { ...result, created: result.created + 1 };
        auditEntries.push(
          createAuditEntry(
            "Item",
            nextItem.id,
            "CSV Item Created",
            `${name} was imported from CSV folder.`,
            "CSV Import",
          ),
        );
      }
    });

    auditEntries.push(
      createAuditEntry(
        "Import",
        "csv-folder",
        "CSV Folder Import Completed",
        `CSV folder import completed: ${result.created} inventory created, ${result.updated} inventory updated.`,
        "CSV Import",
      ),
    );

    const nextSettings =
      importedCategories.size > 0
        ? {
            ...current.settings,
            customCategories: normalizeCustomCategories([
              ...current.settings.customCategories,
              ...Array.from(importedCategories),
            ]),
            updatedAt: importedAt,
          }
        : current.settings;

    setData(
      stampData({
        ...current,
        items: nextItems,
        locations: nextLocations,
        vendors: nextVendors,
        settings: nextSettings,
        auditLog: trimAuditLogEntries([
          ...auditEntries.reverse(),
          ...current.auditLog,
        ]),
      }),
    );

    addNewLocationNotices(createdLocationNoticeIds);
    addNewVendorNotices(createdVendorNoticeIds);

    return result;
  }

  function confirmCsvFolderImport() {
    if (!ensurePermission("data:import")) {
      return;
    }

    if (!data || !csvFolderImportPreview) {
      return;
    }

    try {
      const result = importCsvFolderRows(csvFolderImportPreview);
      const message = `CSV folder import complete. ${result.created} created, ${result.updated} updated, ${result.locationsCreated} new location(s), ${result.vendorsCreated} new vendor(s), ${result.locationsUpdated} location(s) updated, ${result.vendorsUpdated} vendor(s) updated.`;

      setCsvFolderImportPreview(null);
      setCsvFolderStatus(message);
      if (
        result.created > 0 ||
        result.vendorsCreated > 0 ||
        result.locationsCreated > 0
      ) {
        setActivityNow(Date.now());
      }
      showToast("success", message);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "CSV folder import failed.";

      setCsvFolderStatus(message);
      showToast("danger", message);
    }
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
          auditLog: current.auditLog.filter((entry) => !entry.isDemo),
        },
        createAuditEntry(
          "Settings",
          "demo",
          "Demo Data Cleared",
          "Demo inventory data was removed.",
          "User",
        ),
      ),
    );
    showToast("success", "Demo data cleared.");
  }

  const markShownNewInventoryItems = useCallback((itemIds: string[]) => {
    markNewInventoryItemsSeen(itemIds);
    window.setTimeout(() => {
      setNewInventoryItemHighlightIds((current) =>
        current.filter((itemId) => !itemIds.includes(itemId)),
      );
    }, 8000);
  }, []);

  if (!data) {
    return <MaintenanceLoadingScreen />;
  }

  const backupSupported = isFileSystemBackupSupported();
  const csvFolderSupported = isCsvFolderSupported();
  const saveHealthRows = getSaveHealthRows(
    data,
    backupSupported,
    lastBackupAt,
    lastAutoImportAt,
    backupIndicator,
    backupMessage,
    showWebsiteModePanel ? "Backend API" : "IndexedDB",
  );
  const saveHealthTone = getOverallHealthTone(saveHealthRows);
  const recentAddAlerts = getRecentAddAlerts(data, activityNow);
  const canCollapseChrome = activePage !== "dashboard";
  const chromeCollapsed = canCollapseChrome && isChromeCollapsed;
  const isCompactChrome = activePage !== "dashboard";
  const isInventoryWorkspace = activePage === "inventory" && !isSettingsOpen;
  const isScreensaverModeActive =
    isDashboardScreensaverActive || isManualScreensaverActive;
  const watchListVisibilityItem = watchListVisibilityItemId
    ? (data.items.find((item) => item.id === watchListVisibilityItemId) ?? null)
    : null;
  const websiteUpdatePromptVisible =
    showWebsiteModePanel &&
    Boolean(
      websiteUpdateStatus?.ok &&
      websiteUpdateStatus.updateAvailable &&
      websiteUpdateStatus.remoteSha !== remindedLaterUpdateSha,
    );

  if (isScreensaverModeActive) {
    return (
      <main className="app-shell app-shell-screensaver min-h-screen text-slate-100">
        <IdleScreensaver />
      </main>
    );
  }

  return (
    <main
      className={`app-shell min-h-screen text-slate-100 ${isCompactChrome ? "compact-chrome" : ""} ${
        chromeCollapsed ? "chrome-collapsed" : ""
      } ${isInventoryWorkspace ? "inventory-workspace-mode" : ""} ${
        isInventoryWorkspace && chromeCollapsed
          ? "inventory-workspace-expanded"
          : ""
      }`}
    >
      <div
        className={`app-content flex flex-col gap-5 ${isCompactChrome ? "app-content-compact" : ""}`}
      >
        {chromeCollapsed && !isItemFormOpen && (
          <div
            className="floating-work-toolbar no-print"
            aria-label="Collapsed app controls"
          >
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
            <button
              className={`settings-gear floating-settings-gear ${isSettingsOpen ? "settings-gear-active" : ""}`}
              type="button"
              title="Settings"
              aria-label="Open settings"
              onClick={toggleSettingsPanel}
            >
              <GearIcon />
            </button>
          </div>
        )}

        {!chromeCollapsed && (
          <header
            className={`header-panel ${isCompactChrome ? "header-panel-compact" : ""}`}
          >
            <div className="flex min-w-0 items-center gap-3">
              <AppLogoMark />
              <div className="min-w-0">
                {isEditingHeaderBadge ? (
                  <input
                    className="header-badge-input"
                    autoFocus
                    value={headerBadgeDraft}
                    onBlur={saveHeaderBadge}
                    onChange={(event) =>
                      setHeaderBadgeDraft(event.target.value)
                    }
                    onKeyDown={handleHeaderBadgeKeyDown}
                  />
                ) : (
                  <button
                    className="header-badge-button"
                    type="button"
                    onClick={startHeaderBadgeEdit}
                  >
                    {data.settings.headerBadgeText}
                  </button>
                )}
                <h1 className="text-2xl font-black tracking-tight text-white md:text-3xl">
                  Maintenance Inventory Tracker
                </h1>
              </div>
            </div>
            <div className="header-actions">
              <button
                className={`settings-gear ${isSettingsOpen ? "settings-gear-active" : ""}`}
                type="button"
                title="Settings"
                aria-label="Open settings"
                onClick={toggleSettingsPanel}
              >
                <GearIcon />
              </button>
            </div>
          </header>
        )}

        {isSettingsOpen && (
          <SettingsPage
            backupSupported={backupSupported}
            backupMessage={backupMessage}
            csvFolderStatus={csvFolderStatus}
            csvFolderSupported={csvFolderSupported}
            data={data}
            isStartingWebsiteUpdate={isStartingWebsiteUpdate}
            isRunningWebsiteBackup={isRunningWebsiteBackup}
            lastBackupAt={lastBackupAt}
            lastAutoImportAt={lastAutoImportAt}
            onChooseBackupFolder={() => void handleChooseBackupFolder()}
            onChooseCsvFolder={() => void handleChooseCsvFolder()}
            onClose={closeSettingsPanel}
            onCreateRecoveryCode={() => void handleCreateRecoveryCode()}
            onDismissRecoveryCode={() => setNewRecoveryCode("")}
            onDownloadHistoryCsv={handleExportHistoryCsv}
            onDownloadInventoryCsv={handleExportCsv}
            onDownloadWebsiteBackupHistoryCsv={() =>
              void handleDownloadWebsiteBackup("history-csv")
            }
            onDownloadWebsiteBackupInventoryCsv={() =>
              void handleDownloadWebsiteBackup("inventory-csv")
            }
            onDownloadWebsiteBackupJson={() =>
              void handleDownloadWebsiteBackup("json")
            }
            onExportCsvFolderNow={() => void handleExportCsvFolderNow()}
            onImportInventoryCsv={(file) => void handleImportCsv(file)}
            onImportCsvFolder={() => void handlePrepareCsvFolderImport()}
            onImportJson={(file) => void handleImportJson(file)}
            onRunBackup={() => void runBackup(data, true)}
            onRunWebsiteBackup={() => void handleRunBackendWebsiteBackup()}
            onStartWebsiteUpdate={() => void startWebsiteUpdate()}
            onStartScreensaver={startManualScreensaverMode}
            newRecoveryCode={newRecoveryCode}
            onPurgeExpiredDeletedRecords={purgeExpiredDeletedRecordsFromData}
            onCheckWebsiteUpdate={() => void checkWebsiteUpdate(true)}
            onDeleteDeletedRecordForever={deleteDeletedRecordForever}
            onRestoreDeletedRecord={restoreDeletedRecord}
            saveHealthRows={saveHealthRows}
            isCheckingWebsiteUpdate={isCheckingWebsiteUpdate}
            updateSettings={updateSettings}
            websiteBackupStatus={websiteBackupStatus}
            websiteUpdateStatus={websiteUpdateStatus}
          />
        )}

        {!chromeCollapsed && (
          <div
            className={`chrome-navigation no-print ${activePage === "dashboard" ? "chrome-navigation-dashboard" : ""}`}
          >
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
            <nav
              className={`toolbar ${isCompactChrome ? "toolbar-compact" : ""}`}
              aria-label="Main pages"
            >
              {pages.map((page) => (
                <button
                  key={page.id}
                  className={
                    activePage === page.id ? "tab-active" : "tab-button"
                  }
                  type="button"
                  onClick={() => openPage(page.id)}
                >
                  <span className="tab-label-with-notice">
                    {page.label}
                    {page.id === "locations" &&
                      unseenNewLocationNoticeIds.length > 0 && (
                        <NewEntityBadge
                          count={unseenNewLocationNoticeIds.length}
                        />
                      )}
                    {page.id === "vendors" &&
                      unseenNewVendorNoticeIds.length > 0 && (
                        <NewEntityBadge
                          count={unseenNewVendorNoticeIds.length}
                        />
                      )}
                  </span>
                </button>
              ))}
            </nav>
          </div>
        )}

        {toast && <Toast {...toast} />}
        {backupDialog && (
          <BackupWorkflowDialog
            backupSupported={backupSupported}
            dialog={backupDialog}
            onCancel={() => setBackupDialog(null)}
            onChooseFolder={() => void handleChooseBackupFolder()}
            onConfirmImport={(dialogState) =>
              handleImportConfirmation(dialogState)
            }
            onImportExisting={(dialogState) =>
              void prepareFolderImportConfirmation(dialogState)
            }
            onNotNow={() => {
              setBackupDialog(null);
              showToast(
                "success",
                "Backup folder selected. No backup was written.",
              );
            }}
            onOverwrite={(selection) =>
              void handleOverwriteSelectedBackup(selection)
            }
            onRemindLater={() => {
              setupPromptDismissedRef.current = true;
              setBackupDialog(null);
            }}
            onSaveBackupNow={(selection) =>
              void handleSaveBackupInEmptyFolder(selection)
            }
          />
        )}
        {!backupDialog && manualUpdateNotice?.newerInstaller && (
          <ManualUpdateNoticeDialog
            updateCheck={manualUpdateNotice}
            onLater={() => setManualUpdateNotice(null)}
            onOpenFolder={() =>
              void openManualUpdateFolderFromNotice(manualUpdateNotice)
            }
            onUpdate={() =>
              void openManualUpdateInstallerFromNotice(manualUpdateNotice)
            }
          />
        )}
        {!backupDialog &&
          websiteUpdatePromptVisible &&
          websiteUpdateStatus?.ok && (
            <WebsiteUpdateNoticeDialog
              isStarting={isStartingWebsiteUpdate}
              message={websiteUpdateMessage}
              status={websiteUpdateStatus}
              onLater={remindWebsiteUpdateLater}
              onUpdate={() => void startWebsiteUpdate()}
            />
          )}
        {isWebsiteUpdateRestarting && (
          <WebsiteUpdateRestartDialog
            isLoadingLog={isLoadingWebsiteUpdateLog}
            logText={websiteUpdateLogText}
            message={websiteUpdateRestartMessage}
            runStatus={websiteUpdateRunStatus}
            onCheckAgain={() => void checkWebsiteUpdate(true)}
            onClose={() => setIsWebsiteUpdateRestarting(false)}
            onRefresh={() => window.location.reload()}
            onViewLog={() => void viewWebsiteUpdateLog()}
          />
        )}
        {csvImportPreview && (
          <CsvImportPreviewDialog
            preview={csvImportPreview}
            onCancel={() => setCsvImportPreview(null)}
            onConfirm={confirmCsvImport}
          />
        )}
        {csvFolderImportPreview && (
          <CsvFolderImportPreviewDialog
            preview={csvFolderImportPreview}
            onCancel={() => setCsvFolderImportPreview(null)}
            onConfirm={confirmCsvFolderImport}
          />
        )}
        {isCategoryManagerOpen && (
          <CategoryManagerDialog
            categories={getInventoryCategoryOptions(data)}
            onAddCategory={addCustomCategory}
            onClose={() => setIsCategoryManagerOpen(false)}
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
        {labelPreviewItem && (
          <InventoryLabelDialog
            data={data}
            item={labelPreviewItem}
            onClose={() => setLabelPreviewItem(null)}
            onPrint={printInventoryLabel}
          />
        )}
        {watchListVisibilityItem && (
          <ShowWatchListDialog
            item={watchListVisibilityItem}
            onClose={() => setWatchListVisibilityItemId(null)}
            onMoveToHeld={() =>
              updateWatchListVisibility(watchListVisibilityItem.id, "held")
            }
            onShow={() =>
              updateWatchListVisibility(watchListVisibilityItem.id, "visible")
            }
          />
        )}
        {selectedVendorId && (
          <VendorItemsDialog
            data={data}
            onWatchListVisibilityClick={toggleWatchListHidden}
            vendorId={selectedVendorId}
            onClose={() => setSelectedVendorId(null)}
          />
        )}
        {selectedLocationId && (
          <LocationItemsDialog
            data={data}
            locationId={selectedLocationId}
            onWatchListVisibilityClick={toggleWatchListHidden}
            onClose={() => setSelectedLocationId(null)}
          />
        )}
        {isItemFormOpen && (
          <ItemFormDrawer
            data={data}
            editingItemId={editingItemId}
            form={itemForm}
            onCancel={closeItemForm}
            onChange={setItemForm}
            onImageRemove={removeItemImage}
            onImageUpload={handleItemImageUpload}
            onPrintLabel={openCurrentItemFormLabel}
            onSubmit={handleItemSubmit}
          />
        )}

        {activePage === "dashboard" && (
          <DashboardPage
            data={data}
            isScreensaverActive={isDashboardScreensaverActive}
            onStockAction={startStockAction}
            recentAddAlerts={recentAddAlerts}
            reorderItems={reorderItems}
            setActivePage={openPage}
            onToggleHold={toggleReorderHold}
            onToggleOrdered={toggleOrderPlaced}
            onWatchListVisibilityClick={toggleWatchListHidden}
          />
        )}
        {activePage === "inventory" && (
          <InventoryPage
            columnFilters={inventoryColumnFilters}
            data={data}
            filteredItems={filteredItems}
            newestAddedItemId={newestAddedInventoryItemId}
            newItemHighlightIds={newInventoryItemHighlightIds}
            onClearColumnFilters={clearInventoryColumnFilters}
            onColumnFilterChange={updateInventoryColumnFilter}
            onDelete={deleteItem}
            onEdit={editItem}
            onExportCsv={handleExportCsv}
            onExportExcelCsv={handleExportExcelCsv}
            onExportExcelTemplate={() => void handleExportExcelTemplate()}
            onExportBlankImportTemplate={() => void handleExportBlankImportTemplate()}
            onImportCsv={(file) => void handleInventoryImportFile(file)}
            onAddItem={startAddItem}
            onManageCategories={openCategoryManager}
            onCreateRequisition={startInventoryRequisition}
            onNewItemsShown={markShownNewInventoryItems}
            onPrintLabel={openLabelPreview}
            onScanLookupWarning={(message) => showToast("warning", message)}
            onStockAction={startStockAction}
            onStatusFilter={setStatusFilter}
            onWatchListVisibilityClick={toggleWatchListHidden}
            onItemLinkOpenMessage={() =>
              showToast("warning", "Could not open item link.")
            }
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
            onImageRemove={removeItemImage}
            onImageUpload={handleItemImageUpload}
            onPrintLabel={openCurrentItemFormLabel}
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
            onPrintLabel={openLabelPreview}
            onSubmit={handleStockSubmit}
            onWatchListVisibilityClick={toggleWatchListHidden}
          />
        )}
        {activePage === "locations" && (
          <LocationsPage
            data={data}
            form={locationForm}
            isAddOpen={isAddLocationOpen}
            onChange={setLocationForm}
            onDelete={deleteLocation}
            onOpenItems={setSelectedLocationId}
            onSubmit={handleLocationSubmit}
            onToggleAdd={() => setIsAddLocationOpen((open) => !open)}
            newLocationNoticeIds={unseenNewLocationNoticeIds}
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
            onOpenItems={setSelectedVendorId}
            onSubmit={handleVendorSubmit}
            onToggleAdd={toggleVendorAddPanel}
            onUpdateNotes={updateVendorNotes}
            recentlySavedVendorNoteId={recentlySavedVendorNoteId}
            newVendorNoticeIds={unseenNewVendorNoticeIds}
          />
        )}
        {activePage === "reorder" && (
          <ReorderPage
            data={data}
            inventoryRequisitionLaunch={inventoryRequisitionLaunch}
            items={reorderItems}
            onDataChange={commitData}
            onStockAction={startStockAction}
            onWatchListVisibilityClick={toggleWatchListHidden}
          />
        )}
        {activePage === "history" && <HistoryPage data={data} />}
      </div>
    </main>
  );
}

function DashboardPage({
  data,
  isScreensaverActive,
  onStockAction,
  recentAddAlerts,
  reorderItems,
  setActivePage,
  onToggleHold,
  onToggleOrdered,
  onWatchListVisibilityClick,
}: {
  data: AppData;
  isScreensaverActive: boolean;
  onStockAction: (itemId: string, actionType?: StockActionType | "") => void;
  recentAddAlerts: RecentAddAlert[];
  reorderItems: InventoryItem[];
  setActivePage: (page: PageId) => void;
  onToggleHold: (itemId: string) => void;
  onToggleOrdered: (itemId: string) => void;
  onWatchListVisibilityClick: (itemId: string) => void;
}) {
  const [viewMode, setViewMode] = useState<"reorder" | "hold" | "ordered">(
    "reorder",
  );
  const [selectedRequisitionRecord, setSelectedRequisitionRecord] =
    useState<RequisitionMadeRecord | null>(null);
  const heldItemCount = data.items.filter((it) => it.reorderHold && !it.hiddenFromWatchList && !it.nonStocked).length;
  const orderedItemCount = data.items.filter(
    (it) =>
      it.orderPlaced && !it.hiddenFromWatchList && !it.nonStocked && isReorderNeeded(it, data.settings),
  ).length;
  const requisitionOrderedItemCount = data.items.filter(
    (it) =>
      it.orderPlaced &&
      !it.hiddenFromWatchList &&
      !it.nonStocked &&
      Boolean(it.orderRequisitionId) &&
      isReorderNeeded(it, data.settings),
  ).length;
  const hasWatchListItems =
    reorderItems.length > 0 ||
    heldItemCount > 0 ||
    requisitionOrderedItemCount > 0;

  useEffect(() => {
    if (!hasWatchListItems) {
      return;
    }

    if (viewMode === "reorder" && reorderItems.length === 0) {
      setViewMode(heldItemCount > 0 ? "hold" : "ordered");
    } else if (viewMode === "hold" && heldItemCount === 0) {
      setViewMode(reorderItems.length > 0 ? "reorder" : "ordered");
    } else if (viewMode === "ordered" && orderedItemCount === 0) {
      setViewMode(reorderItems.length > 0 ? "reorder" : "hold");
    }
  }, [
    hasWatchListItems,
    heldItemCount,
    orderedItemCount,
    reorderItems.length,
    viewMode,
  ]);

  const visibleReorderItems = useMemo(() => {
    if (viewMode === "hold") {
      return data.items
        .filter((it) => it.reorderHold && !it.hiddenFromWatchList && !it.nonStocked)
        .slice(0, 8);
    }

    if (viewMode === "ordered") {
      return data.items
        .filter(
          (it) =>
            it.orderPlaced &&
            !it.hiddenFromWatchList &&
            !it.nonStocked &&
            isReorderNeeded(it, data.settings),
        )
        .slice(0, 8);
    }

    return reorderItems.slice(0, 8);
  }, [viewMode, data.items, data.settings, reorderItems]);

  const requisitionRecordByItemId = useMemo(() => {
    const recordByItemId = new Map<string, RequisitionMadeRecord>();

    data.items.forEach((item) => {
      const record = getLinkedRequisitionMadeRecord(data, item);

      if (record) {
        recordByItemId.set(item.id, record);
      }
    });

    return recordByItemId;
  }, [data]);

  if (isScreensaverActive) {
    return <IdleScreensaver />;
  }

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

      {hasWatchListItems && (
        <section className="panel">
          <SectionHeader
            action={
              <button
                className="btn-small"
                type="button"
                onClick={() => setActivePage("reorder")}
              >
                Open Reorder List
              </button>
            }
            kicker="Watch list"
            title="Items Needing Attention"
          />

          <div
            className="watch-list-controls"
            style={{ display: "flex", gap: 8, marginBottom: 8 }}
          >
            <button
              className={`btn-small ${viewMode === "reorder" ? "tab-active" : "tab-button"}`}
              type="button"
              onClick={() => setViewMode("reorder")}
            >
              Reorder
            </button>
            <button
              className={`btn-small ${viewMode === "hold" ? "tab-active" : "tab-button"}`}
              type="button"
              onClick={() => setViewMode("hold")}
            >
              Held
            </button>
            <button
              className={`btn-small ${viewMode === "ordered" ? "tab-active" : "tab-button"}`}
              type="button"
              onClick={() => setViewMode("ordered")}
            >
              Ordered
            </button>
          </div>

          <div className="watch-list-grid">
            {visibleReorderItems.map((item) => {
              const status = getInventoryStatus(item, data.settings);
              const requisitionRecord =
                requisitionRecordByItemId.get(item.id) ?? null;

              const openStockEdit = () => onStockAction(item.id);
              const handleCardKeyDown = (
                event: React.KeyboardEvent<HTMLDivElement>,
              ) => {
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
                    <div className="watch-card-badges">
                      <StatusWithWatchVisibility
                        item={item}
                        settings={data.settings}
                        onWatchListVisibilityClick={onWatchListVisibilityClick}
                      />
                      <StockQuantity
                        compact
                        item={item}
                        settings={data.settings}
                      />
                    </div>
                    <div className="watch-card-actions">
                      <button
                        className="btn-small watch-card-action-button"
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleHold(item.id);
                        }}
                      >
                        <PauseIcon />
                        {item.reorderHold ? "Unhold" : "Hold"}
                      </button>
                      <button
                        className="btn-small watch-card-action-button watch-card-action-button-ordered"
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleOrdered(item.id);
                        }}
                      >
                        <OrderCheckIcon />
                        {item.orderPlaced ? "Ordered" : "Mark Ordered"}
                      </button>
                    </div>
                  </div>
                  <div className="watch-card-body">
                    <h3>{item.name}</h3>
                    <p>{item.partNumber || "No part number"}</p>
                    {viewMode === "ordered" && (
                      <div className="watch-card-order-details">
                        <span>
                          Vendor: {getVendorName(data, item.vendorId)}
                        </span>
                        <span>On hand: {formatStockQuantity(item)}</span>
                        <span
                          className={`watch-requisition-status ${requisitionRecord ? "watch-requisition-made" : "watch-requisition-missing"}`}
                        >
                          {requisitionRecord
                            ? "Requisition Made"
                            : "No Requisition Yet"}
                        </span>
                        {requisitionRecord && (
                          <button
                            className="btn-small watch-card-view-requisition"
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedRequisitionRecord(requisitionRecord);
                            }}
                          >
                            View Requisition
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
      {selectedRequisitionRecord && (
        <RequisitionMadeDetailDialog
          record={selectedRequisitionRecord}
          onClose={() => setSelectedRequisitionRecord(null)}
        />
      )}
    </section>
  );
}

function formatRequisitionType(type: RequisitionMadeRecord["requisitionType"]) {
  return type === "over100" ? "Over $100" : "Under $100";
}

function getRequisitionRecordTotal(record: RequisitionMadeRecord) {
  return record.itemSnapshots.reduce(
    (total, snapshot) => total + snapshot.totalCost,
    0,
  );
}

function escapeReportHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getPrintableReportDocument(
  title: string,
  bodyHtml: string,
  extraCss = "",
) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeReportHtml(title)}</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: #ffffff;
        color: #111827;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 11px;
      }
      .report {
        padding: 0.35in;
      }
      .report-header {
        border-bottom: 3px solid #0891b2;
        margin-bottom: 0.18in;
        padding-bottom: 0.14in;
      }
      .report-kicker {
        color: #0e7490;
        font-size: 10px;
        font-weight: 900;
        letter-spacing: 0;
        margin: 0 0 4px;
        text-transform: uppercase;
      }
      h1 {
        color: #0f172a;
        font-size: 20px;
        line-height: 1.2;
        margin: 0;
      }
      .report-meta {
        display: grid;
        gap: 5px;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        margin: 0.16in 0;
      }
      .report-meta div {
        border: 1px solid #cbd5e1;
        border-left: 4px solid #0891b2;
        padding: 7px;
      }
      .report-meta span {
        color: #475569;
        display: block;
        font-size: 9px;
        font-weight: 900;
        text-transform: uppercase;
      }
      .report-meta strong {
        color: #0f172a;
        display: block;
        margin-top: 2px;
        overflow-wrap: anywhere;
      }
      table {
        border-collapse: collapse;
        table-layout: fixed;
        width: 100%;
      }
      .report-wide-table th,
      .report-wide-table td {
        font-size: 8px;
        padding: 4px;
      }
      th {
        background: #0f172a;
        color: #e0f2fe;
        font-size: 9px;
        text-align: left;
        text-transform: uppercase;
      }
      th, td {
        border: 1px solid #cbd5e1;
        padding: 6px;
        vertical-align: top;
        word-break: break-word;
      }
      tr:nth-child(even) td {
        background: #f8fafc;
      }
      .text-right {
        text-align: right;
      }
      @media print {
        @page { margin: 0.25in; }
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .report { padding: 0.25in; }
        table { page-break-inside: auto; }
        thead { display: table-header-group; }
        tr { break-inside: avoid; }
        th, td {
          font-size: 9px;
          overflow-wrap: anywhere;
          word-break: normal;
        }
      }
    </style>
    ${extraCss ? `<style>${extraCss}</style>` : ""}
  </head>
  <body>${bodyHtml}</body>
</html>`;
}

const PRINT_IMAGE_LOAD_TIMEOUT_MS = 1500;
const STANDALONE_PRINT_URL_TTL_MS = 10 * 60 * 1000;
const MAX_STANDALONE_PRINT_URLS = 6;
const activeStandalonePrintUrls: string[] = [];

const standalonePrintPageCss = `
  .print-page-refresh-note {
    position: sticky;
    top: 0;
    z-index: 10;
    border-bottom: 1px solid #cbd5e1;
    background: #f8fafc;
    color: #334155;
    font-size: 12px;
    font-weight: 800;
    line-height: 1.4;
    padding: 10px 14px;
  }

  @media print {
    .print-page-refresh-note {
      display: none !important;
    }
  }
`;

function isMobileViewport() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 768px)").matches
  );
}

function rememberStandalonePrintUrl(url: string) {
  activeStandalonePrintUrls.push(url);

  while (activeStandalonePrintUrls.length > MAX_STANDALONE_PRINT_URLS) {
    const staleUrl = activeStandalonePrintUrls.shift();

    if (staleUrl) {
      URL.revokeObjectURL(staleUrl);
    }
  }

  window.setTimeout(() => {
    const index = activeStandalonePrintUrls.indexOf(url);

    if (index >= 0) {
      activeStandalonePrintUrls.splice(index, 1);
      URL.revokeObjectURL(url);
    }
  }, STANDALONE_PRINT_URL_TTL_MS);
}

async function waitForPrintImages(printDocument: Document) {
  const images = Array.from(printDocument.images);

  if (images.length === 0) {
    return;
  }

  const waitForImage = (image: HTMLImageElement) => {
    const decodeImage = () =>
      image.decode?.().catch(() => undefined) ?? Promise.resolve();

    if (image.complete) {
      return decodeImage();
    }

    return new Promise<void>((resolve) => {
      const finish = () => {
        void decodeImage().finally(resolve);
      };

      image.addEventListener("load", finish, { once: true });
      image.addEventListener("error", finish, { once: true });
    });
  };

  const imagesReady = Promise.all(
    images.map((image) => waitForImage(image)),
  ).then(() => undefined);

  await Promise.race([
    imagesReady,
    new Promise<void>((resolve) =>
      window.setTimeout(resolve, PRINT_IMAGE_LOAD_TIMEOUT_MS),
    ),
  ]);
}

async function openStandalonePrintableReport(
  title: string,
  bodyHtml: string,
  extraCss = "",
) {
  const html = getPrintableReportDocument(
    title,
    `<div class="print-page-refresh-note">If this page is closed, return to the app and tap Print / Save as PDF again.</div>${bodyHtml}`,
    `${standalonePrintPageCss}\n${extraCss}`,
  );
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  const printWindow = window.open(url, "_blank");

  if (!printWindow) {
    URL.revokeObjectURL(url);
    throw new Error(
      "Could not open print preview. Allow popups or use Copy Form Text.",
    );
  }

  rememberStandalonePrintUrl(url);

  const startPrint = () => {
    try {
      printWindow.focus();
      printWindow.print();
    } catch {
      // Mobile browsers may require the user to use Share/Print from the clean tab.
    }
  };

  printWindow.addEventListener(
    "load",
    () => window.setTimeout(startPrint, 250),
    { once: true },
  );
  window.setTimeout(startPrint, 1500);
}

async function openPrintableReport(
  title: string,
  bodyHtml: string,
  extraCss = "",
) {
  const frame = document.createElement("iframe");

  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.style.opacity = "0";
  frame.style.pointerEvents = "none";

  document.body.appendChild(frame);

  const cleanup = () => {
    window.setTimeout(() => frame.remove(), 500);
  };

  try {
    const printDocument =
      frame.contentDocument ?? frame.contentWindow?.document;
    const printWindow = frame.contentWindow;

    if (!printDocument || !printWindow) {
      throw new Error("Could not generate print file.");
    }

    printDocument.open();
    printDocument.write(getPrintableReportDocument(title, bodyHtml, extraCss));
    printDocument.close();

    await waitForPrintImages(printDocument);

    printWindow.addEventListener("afterprint", cleanup, { once: true });
    printWindow.focus();
    printWindow.print();
    window.setTimeout(() => frame.remove(), 30000);
  } catch (error) {
    frame.remove();

    if (error instanceof Error) {
      throw error;
    }

    throw new Error("Could not generate print file.");
  }
}

async function printRequisitionMadeRecord(record: RequisitionMadeRecord) {
  const total = getRequisitionRecordTotal(record);
  const rows = record.itemSnapshots
    .map(
      (snapshot) => `<tr>
        <td>${escapeReportHtml(snapshot.itemName)}</td>
        <td>${escapeReportHtml(snapshot.partNumber || "-")}</td>
        <td class="text-right">${escapeReportHtml(formatNumber(snapshot.quantityRequested))}</td>
        <td class="text-right">${escapeReportHtml(formatCurrency(snapshot.unitCost))}</td>
        <td class="text-right">${escapeReportHtml(formatCurrency(snapshot.totalCost))}</td>
      </tr>`,
    )
    .join("");

  await openPrintableReport(
    `Maintenance Inventory Tracker - Requisition ${record.vendorName}`,
    `<main class="report">
      <header class="report-header">
        <p class="report-kicker">Maintenance Inventory Tracker</p>
        <h1>Requisition Made - ${escapeReportHtml(record.vendorName)}</h1>
      </header>
      <section class="report-meta">
        <div><span>Status</span><strong>${escapeReportHtml(record.status)}</strong></div>
        <div><span>Form Type</span><strong>${escapeReportHtml(formatRequisitionType(record.requisitionType))}</strong></div>
        <div><span>PO Number</span><strong>${escapeReportHtml(record.poNo || "-")}</strong></div>
        <div><span>Total Cost</span><strong>${escapeReportHtml(formatCurrency(total))}</strong></div>
        <div><span>Created By</span><strong>${escapeReportHtml(record.createdBy || record.requisitionedBy || "-")}</strong></div>
        <div><span>PDF Generated</span><strong>${escapeReportHtml(formatDateTime(record.pdfGeneratedAt))}</strong></div>
        <div><span>Passed Date</span><strong>${escapeReportHtml(formatDateTime(record.passedAt))}</strong></div>
        <div><span>Line Items</span><strong>${escapeReportHtml(formatNumber(record.itemSnapshots.length))}</strong></div>
      </section>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Part Number</th>
            <th>Qty Requested</th>
            <th>Unit Cost</th>
            <th>Total Cost</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </main>`,
  );
}

function RequisitionMadeDetailDialog({
  onClose,
  record,
}: {
  onClose: () => void;
  record: RequisitionMadeRecord;
}) {
  const total = getRequisitionRecordTotal(record);
  const [printStatus, setPrintStatus] = useState("");
  const [printStatusType, setPrintStatusType] = useState<"success" | "error">(
    "success",
  );

  async function handlePrint() {
    try {
      await printRequisitionMadeRecord(record);
      setPrintStatus("Print view started.");
      setPrintStatusType("success");
    } catch {
      setPrintStatus("Could not generate print file.");
      setPrintStatusType("error");
    }
  }

  return (
    <div className="review-modal-backdrop" role="presentation">
      <section
        className="review-modal requisition-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="requisition-detail-title"
      >
        <div>
          <p className="eyebrow">Requisition record</p>
          <h3 id="requisition-detail-title">{record.vendorName}</h3>
        </div>
        <div className="requisition-detail-summary">
          <div>
            <span>Status</span>
            <strong>{record.status}</strong>
          </div>
          <div>
            <span>Form type</span>
            <strong>{formatRequisitionType(record.requisitionType)}</strong>
          </div>
          <div>
            <span>Total cost</span>
            <strong>{formatCurrency(total)}</strong>
          </div>
          <div>
            <span>PO number</span>
            <strong>{record.poNo || "-"}</strong>
          </div>
          <div>
            <span>Created by</span>
            <strong>{record.createdBy || record.requisitionedBy || "-"}</strong>
          </div>
          <div>
            <span>PDF generated</span>
            <strong>{formatDateTime(record.pdfGeneratedAt)}</strong>
          </div>
          <div>
            <span>Passed date</span>
            <strong>{formatDateTime(record.passedAt)}</strong>
          </div>
          <div>
            <span>Items</span>
            <strong>{formatNumber(record.itemSnapshots.length)}</strong>
          </div>
        </div>
        <div className="table-wrap requisition-detail-table">
          <table className="data-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Part Number</th>
                <th>Qty</th>
                <th>Unit Cost</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {record.itemSnapshots.map((snapshot) => (
                <tr key={`${record.id}-${snapshot.itemId}`}>
                  <td>{snapshot.itemName}</td>
                  <td>{snapshot.partNumber || "-"}</td>
                  <td>{formatNumber(snapshot.quantityRequested)}</td>
                  <td>{formatCurrency(snapshot.unitCost)}</td>
                  <td>{formatCurrency(snapshot.totalCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="review-modal-actions">
          <button className="btn-muted" type="button" onClick={onClose}>
            Close
          </button>
          <button className="btn-primary" type="button" onClick={handlePrint}>
            Print Record
          </button>
          {printStatus && (
            <span
              className={`requisition-status-message requisition-status-${printStatusType}`}
            >
              {printStatus}
            </span>
          )}
        </div>
      </section>
    </div>
  );
}

function InventoryCsvMenu({
  onExportCsv,
  onExportExcelCsv,
  onExportExcelTemplate,
  onExportBlankImportTemplate,
  onImportCsv,
}: {
  onExportCsv: () => void;
  onExportExcelCsv: () => void;
  onExportExcelTemplate: () => void;
  onExportBlankImportTemplate: () => void;
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
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsideClick);
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
            Import CSV / Excel
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
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsOpen(false);
              onExportExcelTemplate();
            }}
          >
            Export Excel Update Template
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsOpen(false);
              onExportBlankImportTemplate();
            }}
          >
            Export Blank Import Template
          </button>
        </div>
      )}
      <input
        ref={inputRef}
        hidden
        accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
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
  promptText,
}: {
  onApply: () => void;
  onCancel: () => void;
  onChange: (value: string) => void;
  promptText: string;
}) {
  return (
    <div className="vendor-ai-dialog-backdrop" role="presentation">
      <section
        className="vendor-ai-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vendor-ai-dialog-title"
      >
        <SectionHeader
          kicker="Vendor AI Help"
          title="AI Help Needs More Info"
        />
        <p id="vendor-ai-dialog-title">
          I could not tell enough from the website/vendor info. What do you use
          this vendor for?
        </p>
        <textarea
          className="input"
          autoFocus
          placeholder={
            "hydraulic hoses and fittings\nsensors and machine controls\nrobot grippers and vacuum cups\nheater bands and thermocouples"
          }
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
  onUpdate,
  updateCheck,
}: {
  onLater: () => void;
  onOpenFolder: () => void;
  onUpdate: () => void;
  updateCheck: ManualInstallerCheckResult;
}) {
  const installer = updateCheck.newerInstaller;

  if (!installer) {
    return null;
  }

  return (
    <div className="review-modal-backdrop" role="presentation">
      <section
        className="review-modal update-available-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-update-title"
      >
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
          <button className="btn-primary" type="button" onClick={onUpdate}>
            Yes, Update
          </button>
          <button className="btn-muted" type="button" onClick={onOpenFolder}>
            Open Update Folder
          </button>
          <button className="btn-muted" type="button" onClick={onLater}>
            Later
          </button>
        </div>
      </section>
    </div>
  );
}

function WebsiteUpdateNoticeDialog({
  isStarting,
  message,
  onLater,
  onUpdate,
  status,
}: {
  isStarting: boolean;
  message: string;
  onLater: () => void;
  onUpdate: () => void;
  status: Extract<WebsiteUpdateStatus, { ok: true }>;
}) {
  const updateStarted = message.startsWith("Update started.");

  return (
    <div className="review-modal-backdrop" role="presentation">
      <section
        className="review-modal update-available-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="website-update-title"
      >
        <h3 id="website-update-title">New MIT3 Update Available</h3>
        <p>
          A new update is available. Update will backup the database, pull
          latest code, rebuild, and restart MIT3.
        </p>
        <div className="review-modal-summary">
          <strong>Branch</strong>
          <span>{status.branch}</span>
        </div>
        <div className="review-modal-summary">
          <strong>Commits behind</strong>
          <span>
            {status.behindCount ?? (status.updateAvailable ? "Available" : "0")}
          </span>
        </div>
        {message && (
          <pre className="warning-bar whitespace-pre-wrap">{message}</pre>
        )}
        <div className="review-modal-actions">
          <button
            className="btn-primary"
            type="button"
            onClick={onUpdate}
            disabled={isStarting || updateStarted}
          >
            {isStarting
              ? "Starting Update..."
              : updateStarted
                ? "Update Started"
                : "Update Now"}
          </button>
          <button
            className="btn-muted"
            type="button"
            onClick={onLater}
            disabled={isStarting || updateStarted}
          >
            Wait
          </button>
        </div>
      </section>
    </div>
  );
}

function WebsiteUpdateRestartDialog({
  isLoadingLog,
  logText,
  message,
  onCheckAgain,
  onClose,
  onRefresh,
  onViewLog,
  runStatus,
}: {
  isLoadingLog: boolean;
  logText: string;
  message: string;
  onCheckAgain: () => void;
  onClose: () => void;
  onRefresh: () => void;
  onViewLog: () => void;
  runStatus: WebsiteUpdateRunStatus | null;
}) {
  const failed = runStatus?.phase === "failed" || runStatus?.ok === false;
  const complete = runStatus?.phase === "complete" && runStatus.ok === true;
  const title = failed
    ? "Update failed"
    : complete
      ? "MIT3 Update Complete"
      : "MIT3 Update Running";

  return (
    <div className="review-modal-backdrop" role="presentation">
      <section
        className="review-modal update-available-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="website-update-restart-title"
      >
        <h3 id="website-update-restart-title">{title}</h3>
        <p>{message || (failed ? "Update failed" : "Update running...")}</p>
        {runStatus && (
          <div className="review-modal-summary">
            <strong>Phase</strong>
            <span>{runStatus.phase}</span>
          </div>
        )}
        {runStatus?.message && (
          <div className="review-modal-summary">
            <strong>Status</strong>
            <span>{runStatus.message}</span>
          </div>
        )}
        {runStatus?.repoRoot && (
          <div className="review-modal-summary">
            <strong>Repo folder</strong>
            <span>{runStatus.repoRoot}</span>
          </div>
        )}
        {failed && runStatus?.error && (
          <pre className="warning-bar whitespace-pre-wrap">
            {runStatus.error}
          </pre>
        )}
        {runStatus?.logFile && (
          <div className="review-modal-summary">
            <strong>Log file</strong>
            <span>{runStatus.logFile}</span>
          </div>
        )}
        {logText && (
          <pre className="settings-log-output max-h-64 overflow-auto whitespace-pre-wrap">
            {logText}
          </pre>
        )}
        <div className="review-modal-actions">
          <button
            className="btn-primary"
            type="button"
            onClick={onViewLog}
            disabled={isLoadingLog}
          >
            {isLoadingLog ? "Loading Log..." : "View Update Log"}
          </button>
          <button className="btn-muted" type="button" onClick={onCheckAgain}>
            Check Again
          </button>
          <button className="btn-muted" type="button" onClick={onClose}>
            Close
          </button>
          <button className="btn-muted" type="button" onClick={onRefresh}>
            Refresh Now
          </button>
        </div>
      </section>
    </div>
  );
}

function InventoryLabelDialog({
  data,
  item,
  onClose,
  onPrint,
}: {
  data: AppData;
  item: InventoryItem;
  onClose: () => void;
  onPrint: () => void;
}) {
  const [labelSize, setLabelSize] = useState<LabelSizeKey>("small");
  const qrValue = getInventoryItemQrValue(item);

  return (
    <div className="label-modal-backdrop" role="presentation">
      <section
        className="label-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="inventory-label-title"
      >
        <div className="label-modal-header">
          <div>
            <p className="eyebrow">Printable bin label</p>
            <h3 id="inventory-label-title">Inventory Label</h3>
          </div>
          <button
            className="settings-close"
            type="button"
            aria-label="Close label preview"
            onClick={onClose}
          >
            X
          </button>
        </div>
        <label className="field-label">
          Label size
          <select
            className="input"
            value={labelSize}
            onChange={(event) =>
              setLabelSize(event.target.value as LabelSizeKey)
            }
          >
            {labelSizeOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <span className="field-helper">
            {
              labelSizeOptions.find((option) => option.id === labelSize)
                ?.description
            }
          </span>
        </label>
        <div className="label-preview-shell">
          <InventoryPrintableLabel
            data={data}
            item={item}
            labelSize={labelSize}
            qrValue={qrValue}
          />
        </div>
        <div className="review-modal-actions label-modal-actions">
          <button className="btn-primary" type="button" onClick={onPrint}>
            Print Label
          </button>
          <button className="btn-muted" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </section>
    </div>
  );
}

function InventoryPrintableLabel({
  data,
  item,
  labelSize,
  qrValue,
}: {
  data: AppData;
  item: InventoryItem;
  labelSize: LabelSizeKey;
  qrValue: string;
}) {
  const locationName = getLocationName(data, item.locationId);
  const vendorName = getVendorName(data, item.vendorId);
  const partNumber = item.partNumber || item.name || "No part number";
  const showVendor = item.vendorId && vendorName !== "Unassigned";

  return (
    <article
      className={`inventory-label-print-area inventory-label-size-${labelSize}`}
    >
      <div className="inventory-label-qr">
        <QRCodeSVG
          value={qrValue || partNumber}
          size={142}
          level="M"
          bgColor="#ffffff"
          fgColor="#000000"
          marginSize={3}
          title="Inventory item QR code"
        />
      </div>
      <div className="inventory-label-copy">
        <strong className="inventory-label-part">{partNumber}</strong>
        <span className="inventory-label-name">
          {item.name || "Unnamed item"}
        </span>
        <span>Location: {locationName}</span>
        <span>Qty: {formatStockQuantity(item)}</span>
        {showVendor && <span>Vendor: {vendorName}</span>}
      </div>
    </article>
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
  onSaveBackupNow,
}: {
  backupSupported: boolean;
  dialog: BackupDialogState;
  onCancel: () => void;
  onChooseFolder: () => void;
  onConfirmImport: (
    dialog: Extract<BackupDialogState, { kind: "confirm-import" }>,
  ) => void;
  onImportExisting: (
    dialog: Extract<BackupDialogState, { kind: "existing-file" }>,
  ) => void;
  onNotNow: () => void;
  onOverwrite: (selection: BackupDirectorySelection) => void;
  onRemindLater: () => void;
  onSaveBackupNow: (selection: BackupDirectorySelection) => void;
}) {
  if (dialog.kind === "setup") {
    return (
      <div className="csv-import-backdrop" role="presentation">
        <section
          className="csv-import-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="backup-setup-title"
        >
          <SectionHeader kicker="Backup setup" title="Choose Backup Folder" />
          <p id="backup-setup-title" className="backup-dialog-message">
            Backup folder is not set up yet. Please choose a folder so your
            inventory tracker can save backups and restore data on another
            computer.
          </p>
          <div className="csv-import-actions">
            <button className="btn-muted" type="button" onClick={onRemindLater}>
              Remind Me Later
            </button>
            <button
              className="btn-primary"
              type="button"
              onClick={onChooseFolder}
              disabled={!backupSupported}
            >
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
        <section
          className="csv-import-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="backup-existing-title"
        >
          <SectionHeader kicker="Backup file found" title="Existing Backup" />
          <p id="backup-existing-title" className="backup-dialog-message">
            A backup file already exists in this folder. What would you like to
            do?
          </p>
          <div className="backup-dialog-detail">
            <span>File</span>
            <strong>{BACKUP_LATEST_FILENAME}</strong>
            <span>Modified</span>
            <strong>
              {dialog.backupRead.lastModifiedAt
                ? formatDateTime(dialog.backupRead.lastModifiedAt)
                : "Unknown"}
            </strong>
          </div>
          <div className="csv-import-actions">
            <button className="btn-muted" type="button" onClick={onCancel}>
              Cancel
            </button>
            <button
              className="btn-muted"
              type="button"
              onClick={() => onOverwrite(dialog.selection)}
            >
              Overwrite With Current Data
            </button>
            <button
              className="btn-primary"
              type="button"
              onClick={() => onImportExisting(dialog)}
            >
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
        <section
          className="csv-import-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="backup-empty-title"
        >
          <SectionHeader kicker="Backup folder" title="No Backup File" />
          <p id="backup-empty-title" className="backup-dialog-message">
            No backup file was found in this folder. Save current inventory data
            here now?
          </p>
          <div className="csv-import-actions">
            <button className="btn-muted" type="button" onClick={onNotNow}>
              Not Now
            </button>
            <button
              className="btn-primary"
              type="button"
              onClick={() => onSaveBackupNow(dialog.selection)}
            >
              Save Backup Now
            </button>
          </div>
        </section>
      </div>
    );
  }

  const backupIsNewer = isBackupNewerThanLocal(
    dialog.backupTimestamp,
    dialog.localTimestamp,
  );

  return (
    <div className="csv-import-backdrop" role="presentation">
      <section
        className="csv-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="backup-confirm-title"
      >
        <SectionHeader
          kicker={
            dialog.source === "manual" ? "Manual JSON import" : "Backup import"
          }
          title="Confirm Import"
        />
        <p id="backup-confirm-title" className="backup-dialog-message">
          Importing replaces the current local inventory data. The backup file
          has been validated as a Maintenance Inventory Tracker backup.
        </p>
        <div className="backup-dialog-detail">
          <span>File</span>
          <strong>{dialog.fileName}</strong>
          <span>Backup timestamp</span>
          <strong>
            {dialog.backupTimestamp
              ? formatDateTime(dialog.backupTimestamp)
              : "Unknown"}
          </strong>
          <span>Local timestamp</span>
          <strong>
            {dialog.localTimestamp
              ? formatDateTime(dialog.localTimestamp)
              : "Unknown"}
          </strong>
          <span>File modified</span>
          <strong>
            {dialog.fileLastModifiedAt
              ? formatDateTime(dialog.fileLastModifiedAt)
              : "Unknown"}
          </strong>
        </div>
        <p
          className={
            backupIsNewer ? "backup-dialog-recommend" : "backup-dialog-warning"
          }
        >
          {backupIsNewer
            ? "This backup appears newer than the local inventory data. Importing is recommended."
            : "Local data appears newer or the same age. Import only if you want this file to replace the current inventory data."}
        </p>
        <div className="csv-import-actions">
          <button className="btn-muted" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn-primary"
            type="button"
            onClick={() => onConfirmImport(dialog)}
          >
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
  preview,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  preview: CsvImportPreview;
}) {
  return (
    <div className="csv-import-backdrop" role="presentation">
      <section
        className="csv-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="csv-import-title"
      >
        <SectionHeader
          action={
            <button
              className="settings-close"
              type="button"
              aria-label="Cancel CSV import"
              onClick={onCancel}
            >
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
          <ImportSummaryCard
            label="Existing updates"
            value={preview.updatedItems}
          />
          <ImportSummaryCard
            label="New vendors"
            value={preview.vendorsToCreate.length}
          />
          <ImportSummaryCard
            label="New locations"
            value={preview.locationsToCreate.length}
          />
        </div>
        <div className="csv-import-list-grid">
          <CsvImportNameList
            title="Vendors to create"
            names={preview.vendorsToCreate}
          />
          <CsvImportNameList
            title="Locations to create"
            names={preview.locationsToCreate}
          />
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

function CsvFolderImportPreviewDialog({
  onCancel,
  onConfirm,
  preview,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  preview: CsvFolderImportPreview;
}) {
  return (
    <div className="csv-import-backdrop" role="presentation">
      <section
        className="csv-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="csv-folder-import-title"
      >
        <SectionHeader
          action={
            <button
              className="settings-close"
              type="button"
              aria-label="Cancel CSV folder import"
              onClick={onCancel}
            >
              X
            </button>
          }
          kicker="CSV folder preview"
          title="Import CSV Folder"
        />
        <div className="csv-import-file">
          <span>{preview.folderPath}</span>
          <strong>
            {preview.inventoryFileFound
              ? "Inventory found"
              : "No inventory file"}{" "}
            / {preview.vendorFileFound ? "vendors found" : "no vendor file"} /{" "}
            {preview.locationFileFound ? "locations found" : "no location file"}
          </strong>
        </div>
        <div className="csv-import-summary-grid">
          <ImportSummaryCard
            label="Inventory rows"
            value={preview.inventoryRecords.length}
          />
          <ImportSummaryCard label="New items" value={preview.newItems} />
          <ImportSummaryCard
            label="Item updates"
            value={preview.updatedItems}
          />
          <ImportSummaryCard
            label="Vendor rows"
            value={preview.vendorRecords.length}
          />
          <ImportSummaryCard
            label="Location rows"
            value={preview.locationRecords.length}
          />
          <ImportSummaryCard
            label="Vendor updates"
            value={preview.updatedVendors}
          />
          <ImportSummaryCard
            label="Location updates"
            value={preview.updatedLocations}
          />
          <ImportSummaryCard label="New vendors" value={preview.newVendors} />
          <ImportSummaryCard
            label="New locations"
            value={preview.newLocations}
          />
        </div>
        <div className="csv-import-list-grid">
          <CsvImportNameList
            title="Vendors in folder"
            names={preview.vendorRecords.map((vendor) => vendor.name)}
          />
          <CsvImportNameList
            title="Locations in folder"
            names={preview.locationRecords.map((location) => location.name)}
          />
        </div>
        <div className="csv-import-actions">
          <button className="btn-muted" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn-primary" type="button" onClick={onConfirm}>
            Import CSV Folder
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

function CsvImportNameList({
  names,
  title,
}: {
  names: string[];
  title: string;
}) {
  return (
    <div className="csv-import-name-list">
      <span>{title}</span>
      {names.length > 0 ? (
        <p>
          {names.slice(0, 5).join(", ")}
          {names.length > 5 ? `, +${names.length - 5} more` : ""}
        </p>
      ) : (
        <p>None</p>
      )}
    </div>
  );
}

function CategoryManagerDialog({
  categories,
  onAddCategory,
  onClose,
}: {
  categories: string[];
  onAddCategory: (categoryName: string) => CategoryAddResult;
  onClose: () => void;
}) {
  const [categoryDraft, setCategoryDraft] = useState("");
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "warning">(
    "success",
  );

  function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const result = onAddCategory(categoryDraft);

    setMessage(result.message);
    setMessageType(result.ok ? "success" : "warning");

    if (result.ok) {
      setCategoryDraft("");
    }
  }

  return (
    <div className="csv-import-backdrop" role="presentation">
      <section
        className="csv-import-dialog category-manager-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Inventory Categories"
      >
        <SectionHeader
          action={
            <button
              className="settings-close"
              type="button"
              aria-label="Close category manager"
              onClick={onClose}
            >
              X
            </button>
          }
          kicker="Inventory"
          title="Inventory Categories"
        />
        <form className="category-manager-form" onSubmit={handleSubmit}>
          <label className="field-label">
            Add category
            <input
              className="input"
              value={categoryDraft}
              onChange={(event) => {
                setCategoryDraft(event.target.value);
                setMessage("");
              }}
            />
          </label>
          <button className="btn-primary" type="submit">
            Add Category
          </button>
        </form>
        {message && (
          <p
            className={`category-manager-message category-manager-message-${messageType}`}
          >
            {message}
          </p>
        )}
        <div
          className="category-manager-list"
          aria-label="Current inventory categories"
        >
          {categories.map((category) => (
            <span key={category}>{category}</span>
          ))}
        </div>
        <div className="csv-import-actions">
          <button className="btn-muted" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </section>
    </div>
  );
}

function InventoryPage({
  columnFilters,
  data,
  filteredItems,
  onClearColumnFilters,
  onColumnFilterChange,
  onAddItem,
  onManageCategories,
  onDelete,
  onEdit,
  onExportCsv,
  onExportExcelCsv,
  onExportExcelTemplate,
  onExportBlankImportTemplate,
  onImportCsv,
  onItemLinkOpenMessage,
  newestAddedItemId,
  newItemHighlightIds,
  onCreateRequisition,
  onNewItemsShown,
  onPrintLabel,
  onScanLookupWarning,
  onStockAction,
  onStatusFilter,
  onWatchListVisibilityClick,
  statusFilter,
}: {
  columnFilters: InventoryColumnFilters;
  data: AppData;
  filteredItems: InventoryItem[];
  onClearColumnFilters: () => void;
  onColumnFilterChange: (key: InventoryColumnFilterKey, value: string) => void;
  onAddItem: () => void;
  onManageCategories: () => void;
  onDelete: (itemId: string) => void;
  onEdit: (item: InventoryItem) => void;
  onExportCsv: () => void;
  onExportExcelCsv: () => void;
  onExportExcelTemplate: () => void;
  onExportBlankImportTemplate: () => void;
  onImportCsv: (file: File) => void;
  onItemLinkOpenMessage: (message: string) => void;
  newestAddedItemId: string | null;
  newItemHighlightIds: string[];
  onCreateRequisition: (itemIds: string[]) => void;
  onNewItemsShown: (itemIds: string[]) => void;
  onPrintLabel: (item: InventoryItem) => void;
  onScanLookupWarning: (message: string) => void;
  onStockAction: (itemId: string, actionType?: StockActionType | "") => void;
  onStatusFilter: (status: "All" | InventoryStatus) => void;
  onWatchListVisibilityClick: (itemId: string) => void;
  statusFilter: "All" | InventoryStatus;
}) {
  const [lookupScanValue, setLookupScanValue] = useState("");
  const [lookupMatches, setLookupMatches] = useState<InventoryItem[]>([]);
  const [isLookupExpanded, setIsLookupExpanded] = useState(false);
  const [activeColumnFilter, setActiveColumnFilter] =
    useState<InventoryColumnFilterKey | null>(null);
  const [selectedRequisitionItemIds, setSelectedRequisitionItemIds] = useState<
    string[]
  >([]);
  const isCompactInventoryLayout = useMediaQuery(
    INVENTORY_COMPACT_LAYOUT_QUERY,
  );
  const [inventoryPage, setInventoryPage] = useState(1);
  const [inventoryPageSize, setInventoryPageSize] = useState(
    DEFAULT_INVENTORY_PAGE_SIZE,
  );
  const [isAutoPaging, setIsAutoPaging] = useState(false);
  const [autoPagingTargetPage, setAutoPagingTargetPage] = useState<
    number | null
  >(null);
  const [autoPagingDirection, setAutoPagingDirection] = useState<
    "previous" | "next" | null
  >(null);
  const inventoryScrollRef = useRef<HTMLDivElement | null>(null);
  const inventoryTopSentinelRef = useRef<HTMLDivElement | null>(null);
  const inventoryBottomSentinelRef = useRef<HTMLDivElement | null>(null);
  const inventoryAutoPagingTimeoutRef = useRef<number | null>(null);
  const inventoryScrollResetFrameRef = useRef<number | null>(null);
  const inventoryScrollResetTimeoutRef = useRef<number | null>(null);
  const columnFilterPopoverRef = useRef<HTMLDivElement | null>(null);
  const lookupInputRef = useRef<HTMLInputElement | null>(null);
  const isAutoPagingRef = useRef(false);
  const hasUserScrolledInventoryRef = useRef(false);
  const shouldResetInventoryScrollRef = useRef(false);
  const inventoryScrollResetPositionRef = useRef<"bottom" | "top">("top");
  const inventoryIgnoreScrollUntilRef = useRef(0);
  const totalInventoryItems = filteredItems.length;
  const totalInventoryPages = Math.max(
    1,
    Math.ceil(totalInventoryItems / inventoryPageSize),
  );
  const safeInventoryPage = Math.min(inventoryPage, totalInventoryPages);
  const safeInventoryPageRef = useRef(safeInventoryPage);
  const totalInventoryPagesRef = useRef(totalInventoryPages);
  const pageStartIndex = (safeInventoryPage - 1) * inventoryPageSize;
  const paginatedItems = useMemo(
    () =>
      filteredItems.slice(pageStartIndex, pageStartIndex + inventoryPageSize),
    [filteredItems, inventoryPageSize, pageStartIndex],
  );
  const pageStartNumber = totalInventoryItems === 0 ? 0 : pageStartIndex + 1;
  const pageEndNumber =
    totalInventoryItems === 0 ? 0 : pageStartIndex + paginatedItems.length;
  const locationNameById = useMemo(
    () =>
      new Map(data.locations.map((location) => [location.id, location.name])),
    [data.locations],
  );
  const vendorNameById = useMemo(
    () => new Map(data.vendors.map((vendor) => [vendor.id, vendor.name])),
    [data.vendors],
  );
  const getLocationLabel = (locationId: string) =>
    locationNameById.get(locationId) || "Unassigned";
  const getVendorLabel = (vendorId: string) =>
    vendorNameById.get(vendorId) || "Unassigned";
  const hasActiveColumnFilters = hasActiveInventoryColumnFilters(columnFilters);
  const selectedRequisitionItemIdSet = useMemo(
    () => new Set(selectedRequisitionItemIds),
    [selectedRequisitionItemIds],
  );
    const newItemHighlightIdSet = useMemo(
    () => new Set(newItemHighlightIds),
    [newItemHighlightIds],
  );
safeInventoryPageRef.current = safeInventoryPage;
  totalInventoryPagesRef.current = totalInventoryPages;

  function scrollInventoryListToPosition(position: "bottom" | "top") {
    const scrollContainer = inventoryScrollRef.current;

    if (!scrollContainer) {
      return;
    }

    const top =
      position === "bottom"
        ? Math.max(
            0,
            scrollContainer.scrollHeight - scrollContainer.clientHeight - 96,
          )
        : 0;

    scrollContainer.scrollTo({ top, left: 0 });
  }

  function cancelInventoryScrollReset() {
    if (inventoryScrollResetFrameRef.current !== null) {
      window.cancelAnimationFrame(inventoryScrollResetFrameRef.current);
      inventoryScrollResetFrameRef.current = null;
    }

    if (inventoryScrollResetTimeoutRef.current !== null) {
      window.clearTimeout(inventoryScrollResetTimeoutRef.current);
      inventoryScrollResetTimeoutRef.current = null;
    }
  }

  function scheduleInventoryScrollReset() {
    cancelInventoryScrollReset();
    inventoryScrollResetFrameRef.current = window.requestAnimationFrame(() => {
      const resetPosition = inventoryScrollResetPositionRef.current;
      inventoryScrollResetFrameRef.current = null;
      scrollInventoryListToPosition(resetPosition);

      inventoryScrollResetFrameRef.current = window.requestAnimationFrame(
        () => {
          inventoryScrollResetFrameRef.current = null;
          scrollInventoryListToPosition(resetPosition);
        },
      );

      inventoryScrollResetTimeoutRef.current = window.setTimeout(() => {
        inventoryScrollResetTimeoutRef.current = null;
        scrollInventoryListToPosition(resetPosition);
      }, 80);
    });
  }

  function requestInventoryScrollReset(position: "bottom" | "top" = "top") {
    hasUserScrolledInventoryRef.current = false;
    inventoryIgnoreScrollUntilRef.current =
      Date.now() + INVENTORY_SCROLL_RESET_SUPPRESS_MS;
    inventoryScrollResetPositionRef.current = position;
    shouldResetInventoryScrollRef.current = true;
  }

  function finishInventoryAutoPaging() {
    if (!isAutoPagingRef.current) {
      return;
    }

    inventoryAutoPagingTimeoutRef.current = window.setTimeout(() => {
      inventoryAutoPagingTimeoutRef.current = null;
      isAutoPagingRef.current = false;
      setIsAutoPaging(false);
      setAutoPagingTargetPage(null);
      setAutoPagingDirection(null);
    }, 140);
  }

  function clearInventoryAutoPaging() {
    if (inventoryAutoPagingTimeoutRef.current !== null) {
      window.clearTimeout(inventoryAutoPagingTimeoutRef.current);
      inventoryAutoPagingTimeoutRef.current = null;
    }

    isAutoPagingRef.current = false;
    setIsAutoPaging(false);
    setAutoPagingTargetPage(null);
    setAutoPagingDirection(null);
  }

  function resetInventoryScrollTracking() {
    requestInventoryScrollReset();
    scheduleInventoryScrollReset();
  }

  function handleInventoryScroll() {
    const scrollContainer = inventoryScrollRef.current;

    if (
      !scrollContainer ||
      Date.now() < inventoryIgnoreScrollUntilRef.current
    ) {
      return;
    }

    const maxScrollTop =
      scrollContainer.scrollHeight - scrollContainer.clientHeight;

    if (maxScrollTop <= INVENTORY_AUTO_PAGE_EDGE_PX) {
      return;
    }

    const distanceFromBottom = maxScrollTop - scrollContainer.scrollTop;

    if (scrollContainer.scrollTop > 8) {
      hasUserScrolledInventoryRef.current = true;
    }

    if (!hasUserScrolledInventoryRef.current || isAutoPagingRef.current) {
      return;
    }

    if (scrollContainer.scrollTop <= INVENTORY_AUTO_PAGE_EDGE_PX) {
      startInventoryAutoPaging("previous");
      return;
    }

    if (distanceFromBottom <= INVENTORY_AUTO_PAGE_EDGE_PX) {
      startInventoryAutoPaging("next");
    }
  }

  function goToPreviousInventoryPage() {
    clearInventoryAutoPaging();
    requestInventoryScrollReset();
    setInventoryPage((current) => Math.max(1, current - 1));
  }

  function goToNextInventoryPage() {
    clearInventoryAutoPaging();
    requestInventoryScrollReset();
    setInventoryPage((current) =>
      Math.min(totalInventoryPagesRef.current, current + 1),
    );
  }

  function startInventoryAutoPaging(direction: "previous" | "next") {
    const currentPage = safeInventoryPageRef.current;
    const totalPages = totalInventoryPagesRef.current;
    const targetPage = direction === "next" ? currentPage + 1 : currentPage - 1;

    if (
      isAutoPagingRef.current ||
      (direction === "next" && currentPage >= totalPages) ||
      (direction === "previous" && currentPage <= 1)
    ) {
      return;
    }

    isAutoPagingRef.current = true;
    setIsAutoPaging(true);
    setAutoPagingDirection(direction);
    setAutoPagingTargetPage(targetPage);
    inventoryAutoPagingTimeoutRef.current = window.setTimeout(() => {
      inventoryAutoPagingTimeoutRef.current = null;
      requestInventoryScrollReset(direction === "previous" ? "bottom" : "top");
      setInventoryPage(() => targetPage);
    }, 320);
  }

  useEffect(() => {
    clearInventoryAutoPaging();
    resetInventoryScrollTracking();
    setInventoryPage(1);
  }, [inventoryPageSize, columnFilters, statusFilter]);

  useEffect(() => {
    if (!newestAddedItemId) {
      return;
    }

    clearInventoryAutoPaging();
    requestInventoryScrollReset();
    setInventoryPage(1);
  }, [newestAddedItemId]);

  useEffect(() => {
    const shownNewItemIds = paginatedItems
      .map((item) => item.id)
      .filter((itemId) => newItemHighlightIdSet.has(itemId));

    if (shownNewItemIds.length > 0) {
      onNewItemsShown(shownNewItemIds);
    }
  }, [newItemHighlightIdSet, onNewItemsShown, paginatedItems]);

  useEffect(() => {
    if (!activeColumnFilter) {
      return;
    }

    function closeFilterOnClickAway(event: MouseEvent) {
      const target = event.target;

      if (
        target instanceof Node &&
        columnFilterPopoverRef.current?.contains(target)
      ) {
        return;
      }

      setActiveColumnFilter(null);
    }

    document.addEventListener("mousedown", closeFilterOnClickAway);

    return () =>
      document.removeEventListener("mousedown", closeFilterOnClickAway);
  }, [activeColumnFilter]);

  useEffect(() => {
    if (isLookupExpanded) {
      lookupInputRef.current?.focus();
    }
  }, [isLookupExpanded]);

  useEffect(() => {
    setInventoryPage((current) => Math.min(current, totalInventoryPages));
  }, [totalInventoryPages]);

  useEffect(() => {
    if (!shouldResetInventoryScrollRef.current) {
      return;
    }

    shouldResetInventoryScrollRef.current = false;
    scheduleInventoryScrollReset();
    finishInventoryAutoPaging();
  }, [inventoryPageSize, pageStartIndex, safeInventoryPage]);

  useEffect(() => {
    const inventoryItemIds = new Set(data.items.map((item) => item.id));
    setSelectedRequisitionItemIds((current) =>
      current.filter((itemId) => inventoryItemIds.has(itemId)),
    );
  }, [data.items]);

  useEffect(() => {
    return () => {
      if (inventoryAutoPagingTimeoutRef.current !== null) {
        window.clearTimeout(inventoryAutoPagingTimeoutRef.current);
      }
      cancelInventoryScrollReset();
    };
  }, []);

  useEffect(() => {
    const scrollContainer = inventoryScrollRef.current;
    const bottomSentinel = inventoryBottomSentinelRef.current;
    const topSentinel = inventoryTopSentinelRef.current;

    if (
      !scrollContainer ||
      !bottomSentinel ||
      !topSentinel ||
      totalInventoryItems === 0
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const currentPage = safeInventoryPageRef.current;

        entries.forEach((entry) => {
          if (
            !entry.isIntersecting ||
            !hasUserScrolledInventoryRef.current ||
            isAutoPagingRef.current
          ) {
            return;
          }

          if (entry.target === bottomSentinel) {
            startInventoryAutoPaging("next");
          }

          if (entry.target === topSentinel && currentPage > 1) {
            startInventoryAutoPaging("previous");
          }
        });
      },
      {
        root: scrollContainer,
        rootMargin: "56px 0px 56px 0px",
        threshold: 0.01,
      },
    );

    observer.observe(topSentinel);
    observer.observe(bottomSentinel);

    return () => observer.disconnect();
  }, [
    isCompactInventoryLayout,
    totalInventoryItems,
    inventoryPageSize,
    columnFilters,
    statusFilter,
  ]);

  function handleInventoryPageSizeChange(
    event: React.ChangeEvent<HTMLSelectElement>,
  ) {
    const nextPageSize = Number(event.target.value);

    setInventoryPageSize(
      INVENTORY_PAGE_SIZE_OPTIONS.some((option) => option === nextPageSize)
        ? nextPageSize
        : DEFAULT_INVENTORY_PAGE_SIZE,
    );
  }

  function handleLookupScan() {
    const scanValue = cleanScanValue(lookupScanValue);

    if (!scanValue) {
      return;
    }

    const matches = findItemsByScannedValue(data.items, scanValue);

    if (matches.length === 1) {
      setLookupMatches([]);
      onEdit(matches[0]);
      return;
    }

    if (matches.length > 1) {
      setLookupMatches(matches);
      return;
    }

    setLookupMatches([]);
    onScanLookupWarning("No inventory item found for this QR code.");
  }

  function handleLookupScanKeyDown(
    event: React.KeyboardEvent<HTMLInputElement>,
  ) {
    if (event.key === "Enter") {
      event.preventDefault();
      handleLookupScan();
    }
  }

  function updateColumnFilter(key: InventoryColumnFilterKey, value: string) {
    onColumnFilterChange(key, value);
  }

  function clearColumnFilter(key: InventoryColumnFilterKey) {
    onColumnFilterChange(key, "");
  }

  function toggleInventoryRequisitionSelection(itemId: string) {
    setSelectedRequisitionItemIds((current) =>
      current.includes(itemId)
        ? current.filter((selectedId) => selectedId !== itemId)
        : [...current, itemId],
    );
  }

  function createInventoryRequisition() {
    if (selectedRequisitionItemIds.length === 0) {
      return;
    }

    onCreateRequisition(selectedRequisitionItemIds);
    setSelectedRequisitionItemIds([]);
  }

  const inventoryHeaders: React.ReactNode[] = [
    "Req",
    <InventoryColumnFilterHeader
      key="location"
      filterKey="location"
      isOpen={activeColumnFilter === "location"}
      label="Location"
      popoverRef={
        activeColumnFilter === "location" ? columnFilterPopoverRef : undefined
      }
      value={columnFilters.location}
      onChange={updateColumnFilter}
      onClear={clearColumnFilter}
      onClose={() => setActiveColumnFilter(null)}
      onToggle={setActiveColumnFilter}
    />,
    <InventoryColumnFilterHeader
      key="partNumber"
      filterKey="partNumber"
      isOpen={activeColumnFilter === "partNumber"}
      label="Part Number"
      popoverRef={
        activeColumnFilter === "partNumber" ? columnFilterPopoverRef : undefined
      }
      value={columnFilters.partNumber}
      onChange={updateColumnFilter}
      onClear={clearColumnFilter}
      onClose={() => setActiveColumnFilter(null)}
      onToggle={setActiveColumnFilter}
    />,
    <InventoryColumnFilterHeader
      key="category"
      filterKey="category"
      isOpen={activeColumnFilter === "category"}
      label="Category"
      popoverRef={
        activeColumnFilter === "category" ? columnFilterPopoverRef : undefined
      }
      value={columnFilters.category}
      onChange={updateColumnFilter}
      onClear={clearColumnFilter}
      onClose={() => setActiveColumnFilter(null)}
      onToggle={setActiveColumnFilter}
    />,
    <InventoryColumnFilterHeader
      key="description"
      filterKey="description"
      isOpen={activeColumnFilter === "description"}
      label="Description"
      popoverRef={
        activeColumnFilter === "description"
          ? columnFilterPopoverRef
          : undefined
      }
      value={columnFilters.description}
      onChange={updateColumnFilter}
      onClear={clearColumnFilter}
      onClose={() => setActiveColumnFilter(null)}
      onToggle={setActiveColumnFilter}
    />,
    "Stock On Hand",
    "Status",
    <InventoryColumnFilterHeader
      key="vendor"
      filterKey="vendor"
      isOpen={activeColumnFilter === "vendor"}
      label="Vendor"
      popoverRef={
        activeColumnFilter === "vendor" ? columnFilterPopoverRef : undefined
      }
      value={columnFilters.vendor}
      onChange={updateColumnFilter}
      onClear={clearColumnFilter}
      onClose={() => setActiveColumnFilter(null)}
      onToggle={setActiveColumnFilter}
    />,
    "Cost",
    "Actions",
  ];

  const inventoryAutoPagingStatus =
    isAutoPaging && autoPagingTargetPage !== null ? (
      <div
        className="inventory-auto-page-status"
        role="status"
        aria-live="polite"
      >
        <span className="inventory-auto-page-dot" aria-hidden="true" />
        Loading page {formatNumber(autoPagingTargetPage)}...
      </div>
    ) : null;

  const inventoryTopPagingSentinel = (
    <div
      ref={inventoryTopSentinelRef}
      className="inventory-auto-page-sentinel"
      aria-hidden="true"
    />
  );
  const inventoryBottomPagingSentinel = (
    <div
      ref={inventoryBottomSentinelRef}
      className="inventory-auto-page-sentinel"
      aria-hidden="true"
    />
  );

  return (
    <section className="panel inventory-panel">
      <div className="inventory-panel-header">
        <div className="inventory-title-block">
          <p className="eyebrow">Inventory</p>
          <h2>Parts Table</h2>
        </div>
        <div className="inventory-header-actions">
          <div className="inventory-primary-actions">
            <button
              className="inventory-add-button"
              type="button"
              onClick={onAddItem}
            >
              <span aria-hidden="true">+</span>
              Add Item
            </button>
            <button
              className="inventory-category-button"
              type="button"
              onClick={onManageCategories}
            >
              Manage Categories
            </button>
          </div>
          <InventoryCsvMenu
            onExportCsv={onExportCsv}
            onExportExcelCsv={onExportExcelCsv}
            onExportExcelTemplate={onExportExcelTemplate}
            onExportBlankImportTemplate={onExportBlankImportTemplate}
            onImportCsv={onImportCsv}
          />
        </div>
      </div>
      <div className="inventory-command-console">
        <div className="inventory-command-row">
          <div
            className={`scan-lookup-panel ${isLookupExpanded ? "scan-lookup-panel-open" : ""}`}
          >
            <div className="scan-lookup-bar">
              <button
                className="scan-icon-button"
                type="button"
                aria-label={
                  isLookupExpanded
                    ? "QR and barcode search"
                    : "Open QR and barcode search"
                }
                aria-expanded={isLookupExpanded}
                onClick={() => setIsLookupExpanded(true)}
              >
                <ScanLookupIcon />
              </button>
              {isLookupExpanded && (
                <div className="scan-lookup-expansion">
                  <input
                    ref={lookupInputRef}
                    className="input scan-lookup-input"
                    placeholder="Scan or enter code..."
                    value={lookupScanValue}
                    onChange={(event) => setLookupScanValue(event.target.value)}
                    onKeyDown={handleLookupScanKeyDown}
                  />
                  <button
                    className="btn-small scan-lookup-button"
                    type="button"
                    aria-label="Search QR or barcode"
                    onClick={handleLookupScan}
                  >
                    <SearchButtonIcon />
                    Search
                  </button>
                  <button
                    className="btn-small scan-collapse-button"
                    type="button"
                    aria-label="Collapse QR and barcode search"
                    onClick={() => {
                      setLookupMatches([]);
                      setIsLookupExpanded(false);
                    }}
                  >
                    X
                  </button>
                </div>
              )}
            </div>
            {isLookupExpanded && lookupMatches.length > 1 && (
              <div className="scan-match-list">
                <span>{lookupMatches.length} matching items</span>
                {lookupMatches.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setLookupMatches([]);
                      onEdit(item);
                    }}
                  >
                    <strong>{item.partNumber || item.name}</strong>
                    <small>{item.name}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="subtab-bar inventory-status-tabs">
            {(["All", "In Stock", "Low Stock", "Out of Stock", "Order As Needed"] as const).map(
              (status) => (
                <button
                  key={status}
                  className={
                    statusFilter === status ? "subtab-active" : "subtab-button"
                  }
                  type="button"
                  onClick={() => onStatusFilter(status)}
                >
                  {status}
                </button>
              ),
            )}
          </div>
          {hasActiveColumnFilters && (
            <button
              className="btn-small inventory-clear-filters-button"
              type="button"
              onClick={onClearColumnFilters}
            >
              Clear Filters
            </button>
          )}
          <div className="inventory-requisition-tray">
            <span>
              {formatNumber(selectedRequisitionItemIds.length)} selected
            </span>
            <button
              className="btn-small"
              type="button"
              onClick={createInventoryRequisition}
              disabled={selectedRequisitionItemIds.length === 0}
            >
              Create Requisition
            </button>
            {selectedRequisitionItemIds.length > 0 && (
              <button
                className="btn-small"
                type="button"
                onClick={() => setSelectedRequisitionItemIds([])}
              >
                Clear
              </button>
            )}
          </div>
          <InventoryPagination
            currentPage={safeInventoryPage}
            onNextPage={goToNextInventoryPage}
            onPageSizeChange={handleInventoryPageSizeChange}
            onPreviousPage={goToPreviousInventoryPage}
            pageEnd={pageEndNumber}
            pageSize={inventoryPageSize}
            pageStart={pageStartNumber}
            totalItems={totalInventoryItems}
            totalPages={totalInventoryPages}
          />
        </div>
      </div>
      {!isCompactInventoryLayout && (
        <div className="inventory-table-desktop">
          <SimpleTable
            emptyText="No inventory items found."
            leading={
              <>
                {inventoryTopPagingSentinel}
                {autoPagingDirection === "previous" &&
                  inventoryAutoPagingStatus}
              </>
            }
            headers={inventoryHeaders}
            footer={
              <>
                {autoPagingDirection !== "previous" &&
                  inventoryAutoPagingStatus}
                {inventoryBottomPagingSentinel}
              </>
            }
            onScroll={handleInventoryScroll}
            rowClassNames={paginatedItems.map((item) =>
              newItemHighlightIdSet.has(item.id) ? "inventory-row-new" : "",
            )}
            rowKeys={paginatedItems.map((item) => item.id)}
            rows={paginatedItems.map((item) => [
              <label key="req-select" className="inventory-requisition-select">
                <input
                  type="checkbox"
                  checked={selectedRequisitionItemIdSet.has(item.id)}
                  aria-label={`Select ${item.partNumber || item.name} for requisition`}
                  onChange={() => toggleInventoryRequisitionSelection(item.id)}
                />
              </label>,
              getLocationLabel(item.locationId),
              <PartNumberCell
                key="part-number"
                item={item}
                onOpenError={onItemLinkOpenMessage}
              />,
              item.category || "-",
              item.description || "-",
              <StockQuantity
                key="quantity"
                item={item}
                settings={data.settings}
                compact
                onClick={() => onStockAction(item.id)}
                title="Edit stock"
                ariaLabel={`Edit stock for ${item.partNumber || item.name || "item"}`}
              />,
              <StatusWithWatchVisibility
                key="status"
                item={item}
                settings={data.settings}
                onClick={() => onStockAction(item.id)}
                onWatchListVisibilityClick={onWatchListVisibilityClick}
                title="Edit stock"
                ariaLabel={`Edit stock status for ${item.partNumber || item.name || "item"}`}
              />,
              getVendorLabel(item.vendorId),
              formatCurrency(item.costEach),
              <InventoryRowActions
                key="actions"
                isSelectedForRequisition={selectedRequisitionItemIdSet.has(
                  item.id,
                )}
                item={item}
                onDelete={onDelete}
                onEdit={onEdit}
                onPrintLabel={onPrintLabel}
                onToggleRequisition={toggleInventoryRequisitionSelection}
              />,
            ])}
            scrollRef={inventoryScrollRef}
          />
        </div>
      )}
      {isCompactInventoryLayout && (
        <div
          className="inventory-card-list"
          ref={inventoryScrollRef}
          onScroll={handleInventoryScroll}
        >
          {inventoryTopPagingSentinel}
          {autoPagingDirection === "previous" && inventoryAutoPagingStatus}
          {totalInventoryItems === 0 && (
            <div className="inventory-empty-card">
              No inventory items found.
            </div>
          )}
          {paginatedItems.map((item) => (
            <InventoryItemCard
              key={item.id}
              data={data}
              item={item}
              isNewItem={newItemHighlightIdSet.has(item.id)}
              onDelete={onDelete}
              onEdit={onEdit}
              onItemLinkOpenMessage={onItemLinkOpenMessage}
              onPrintLabel={onPrintLabel}
              onToggleRequisition={toggleInventoryRequisitionSelection}
              isSelectedForRequisition={selectedRequisitionItemIdSet.has(
                item.id,
              )}
              onStockAction={onStockAction}
              onWatchListVisibilityClick={onWatchListVisibilityClick}
            />
          ))}
          {autoPagingDirection !== "previous" && inventoryAutoPagingStatus}
          {inventoryBottomPagingSentinel}
        </div>
      )}
    </section>
  );
}

function InventoryColumnFilterHeader({
  filterKey,
  isOpen,
  label,
  onChange,
  onClear,
  onClose,
  onToggle,
  popoverRef,
  value,
}: {
  filterKey: InventoryColumnFilterKey;
  isOpen: boolean;
  label: string;
  onChange: (key: InventoryColumnFilterKey, value: string) => void;
  onClear: (key: InventoryColumnFilterKey) => void;
  onClose: () => void;
  onToggle: (key: InventoryColumnFilterKey | null) => void;
  popoverRef?: React.Ref<HTMLDivElement>;
  value: string;
}) {
  const hasFilter = value.trim().length > 0;

  return (
    <div className="inventory-column-filter-header" ref={popoverRef}>
      <button
        className={`inventory-column-filter-trigger ${hasFilter ? "inventory-column-filter-active" : ""}`}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => onToggle(isOpen ? null : filterKey)}
      >
        <span>{label}</span>
        <SearchButtonIcon />
        {hasFilter && (
          <span className="inventory-column-filter-dot" aria-hidden="true" />
        )}
      </button>
      {isOpen && (
        <div
          className="inventory-column-filter-popover"
          role="dialog"
          aria-label={`${label} filter`}
        >
          <label className="inventory-column-filter-input-label">
            <span className="sr-only">Search {label}</span>
            <input
              autoFocus
              className="input inventory-column-filter-input"
              placeholder={`Search ${label}...`}
              value={value}
              onChange={(event) => onChange(filterKey, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  onClose();
                }
              }}
            />
          </label>
          <div className="inventory-column-filter-actions">
            <button
              className="btn-small"
              type="button"
              onClick={() => onClear(filterKey)}
              disabled={!hasFilter}
            >
              Clear
            </button>
            <button className="btn-small" type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function InventoryPagination({
  currentPage,
  onNextPage,
  onPageSizeChange,
  onPreviousPage,
  pageEnd,
  pageSize,
  pageSizeOptions = INVENTORY_PAGE_SIZE_OPTIONS,
  pageStart,
  totalItems,
  totalPages,
}: {
  currentPage: number;
  onNextPage: () => void;
  onPageSizeChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  onPreviousPage: () => void;
  pageEnd: number;
  pageSize: number;
  pageSizeOptions?: readonly number[];
  pageStart: number;
  totalItems: number;
  totalPages: number;
}) {
  return (
    <div className="inventory-pagination">
      <span className="inventory-pagination-summary">
        {totalItems === 0
          ? "No items"
          : `Showing ${formatNumber(pageStart)}-${formatNumber(pageEnd)} of ${formatNumber(totalItems)}`}
      </span>
      <div className="inventory-pagination-controls">
        <label className="inventory-pagination-select">
          Rows
          <select value={pageSize} onChange={onPageSizeChange}>
            {pageSizeOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn-small inventory-page-button"
          type="button"
          onClick={onPreviousPage}
          disabled={currentPage <= 1}
        >
          Previous
        </button>
        <strong className="inventory-page-status">
          Page {formatNumber(currentPage)} of {formatNumber(totalPages)}
        </strong>
        <button
          className="btn-small inventory-page-button"
          type="button"
          onClick={onNextPage}
          disabled={currentPage >= totalPages}
        >
          Next
        </button>
      </div>
    </div>
  );
}

function ScanLookupIcon() {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-hidden="true">
      <path d="M4 7V4h3" />
      <path d="M17 4h3v3" />
      <path d="M20 17v3h-3" />
      <path d="M7 20H4v-3" />
      <path d="M8 8v8" />
      <path d="M11 8v8" />
      <path d="M14 8v8" />
      <path d="M17 8v8" />
    </svg>
  );
}

function SearchButtonIcon() {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-hidden="true">
      <path d="M8 6v12" />
      <path d="M16 6v12" />
    </svg>
  );
}

function OrderCheckIcon() {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-hidden="true">
      <path d="M4 6h2l2 10h8l3-7H7" />
      <path d="m9 12 2 2 4-4" />
      <path d="M10 20h.01" />
      <path d="M17 20h.01" />
    </svg>
  );
}

function InventoryRowActions({
  isSelectedForRequisition = false,
  item,
  onDelete,
  onEdit,
  onPrintLabel,
  onToggleRequisition,
}: {
  isSelectedForRequisition?: boolean;
  item: InventoryItem;
  onDelete: (itemId: string) => void;
  onEdit: (item: InventoryItem) => void;
  onPrintLabel: (item: InventoryItem) => void;
  onToggleRequisition?: (itemId: string) => void;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({
    left: 0,
    minWidth: 168,
    top: 0,
  });
  const actionMenuIdRef = useRef(`inventory-action-menu-${item.id}`);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  function openActionMenu() {
    const button = menuButtonRef.current;

    if (!button) {
      return;
    }

    const rect = button.getBoundingClientRect();
    const menuWidth = 190;
    const menuHeight = onToggleRequisition ? 146 : 104;
    const left = Math.min(
      Math.max(8, rect.left),
      Math.max(8, window.innerWidth - menuWidth - 8),
    );
    const top =
      rect.bottom + menuHeight + 12 > window.innerHeight
        ? Math.max(8, rect.top - menuHeight - 6)
        : rect.bottom + 6;

    window.dispatchEvent(
      new CustomEvent("inventory-action-menu-open", {
        detail: actionMenuIdRef.current,
      }),
    );
    setMenuPosition({ left, minWidth: Math.max(168, rect.width), top });
    setIsMenuOpen(true);
  }

  function closeActionMenu() {
    setIsMenuOpen(false);
  }

  function handleActionMenuClick(event: React.MouseEvent<HTMLButtonElement>) {
    if (isMenuOpen && event.detail === 0) {
      closeActionMenu();
      return;
    }

    if (!isMenuOpen) {
      openActionMenu();
    }
  }

  function handleActionMenuMouseEnter() {
    if (window.matchMedia("(hover: hover)").matches) {
      openActionMenu();
    }
  }

  function runAction(action: () => void) {
    closeActionMenu();
    action();
  }

  useEffect(() => {
    function handleOtherMenuOpen(event: Event) {
      if ((event as CustomEvent<string>).detail !== actionMenuIdRef.current) {
        closeActionMenu();
      }
    }

    window.addEventListener("inventory-action-menu-open", handleOtherMenuOpen);

    return () =>
      window.removeEventListener(
        "inventory-action-menu-open",
        handleOtherMenuOpen,
      );
  }, []);

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target;

      if (
        target instanceof Node &&
        (menuRef.current?.contains(target) ||
          menuButtonRef.current?.contains(target))
      ) {
        return;
      }

      closeActionMenu();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeActionMenu();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", closeActionMenu);
    window.addEventListener("scroll", closeActionMenu, true);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", closeActionMenu);
      window.removeEventListener("scroll", closeActionMenu, true);
    };
  }, [isMenuOpen]);

  const actionMenu =
    isMenuOpen &&
    createPortal(
      <div
        ref={menuRef}
        className="inventory-action-dropdown"
        role="menu"
        style={{
          left: menuPosition.left,
          minWidth: menuPosition.minWidth,
          top: menuPosition.top,
        }}
      >
        {onToggleRequisition && (
          <button
            type="button"
            role="menuitem"
            onClick={() => runAction(() => onToggleRequisition(item.id))}
          >
            <RequisitionActionIcon />
            <span>
              {isSelectedForRequisition
                ? "Remove from Requisition"
                : "Add to Requisition"}
            </span>
          </button>
        )}
        <button
          type="button"
          role="menuitem"
          onClick={() => runAction(() => onEdit(item))}
        >
          <EditActionIcon />
          <span>Edit</span>
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => runAction(() => onPrintLabel(item))}
        >
          <PrintActionIcon />
          <span>Print Label</span>
        </button>
      </div>,
      document.body,
    );

  return (
    <div className="inventory-actions">
      <button
        ref={menuButtonRef}
        className="btn-small inventory-action-menu-trigger"
        type="button"
        aria-haspopup="menu"
        aria-expanded={isMenuOpen}
        onClick={handleActionMenuClick}
        onMouseEnter={handleActionMenuMouseEnter}
      >
        <ActionsMenuIcon />
        <span>Actions</span>
        <span aria-hidden="true">v</span>
      </button>
      {actionMenu}
      <button
        className="btn-danger inventory-delete-button"
        type="button"
        onClick={() => onDelete(item.id)}
      >
        Delete
      </button>
    </div>
  );
}

function ActionsMenuIcon() {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </svg>
  );
}

function RequisitionActionIcon() {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-hidden="true">
      <path d="M6 7h12l-1 11H7z" />
      <path d="M9 7a3 3 0 0 1 6 0" />
      <path d="M12 10v5" />
      <path d="M9.5 12.5h5" />
    </svg>
  );
}

function EditActionIcon() {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-hidden="true">
      <path d="M4 20h4l11-11-4-4L4 16z" />
      <path d="m13 7 4 4" />
    </svg>
  );
}

function PrintActionIcon() {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-hidden="true">
      <path d="M7 8V4h10v4" />
      <path d="M7 17H5v-6h14v6h-2" />
      <path d="M7 14h10v6H7z" />
    </svg>
  );
}

function InventoryItemCard({
  data,
  isNewItem,
  isSelectedForRequisition,
  item,
  onDelete,
  onEdit,
  onItemLinkOpenMessage,
  onPrintLabel,
  onToggleRequisition,
  onStockAction,
  onWatchListVisibilityClick,
}: {
  data: AppData;
  isNewItem: boolean;
  isSelectedForRequisition: boolean;
  item: InventoryItem;
  onDelete: (itemId: string) => void;
  onEdit: (item: InventoryItem) => void;
  onItemLinkOpenMessage: (message: string) => void;
  onPrintLabel: (item: InventoryItem) => void;
  onToggleRequisition: (itemId: string) => void;
  onStockAction: (itemId: string, actionType?: StockActionType | "") => void;
  onWatchListVisibilityClick: (itemId: string) => void;
}) {
  return (
    <article
      className={`inventory-item-card ${isNewItem ? "inventory-card-new" : ""}`}
    >
      <div className="inventory-item-card-header">
        <div>
          <h3>{item.name}</h3>
          <p>{getLocationName(data, item.locationId)}</p>
        </div>
        <div className="inventory-item-card-header-actions">
          <label className="inventory-card-requisition-select">
            <input
              type="checkbox"
              checked={isSelectedForRequisition}
              aria-label={`Select ${item.partNumber || item.name} for requisition`}
              onChange={() => onToggleRequisition(item.id)}
            />
            <span>Req</span>
          </label>
          <StatusWithWatchVisibility
            item={item}
            settings={data.settings}
            onClick={() => onStockAction(item.id)}
            onWatchListVisibilityClick={onWatchListVisibilityClick}
            title="Edit stock"
            ariaLabel={`Edit stock status for ${item.partNumber || item.name || "item"}`}
          />
        </div>
      </div>
      <div className="inventory-item-card-grid">
        <InventoryCardField
          label="Part number"
          value={
            <PartNumberCell item={item} onOpenError={onItemLinkOpenMessage} />
          }
        />
        <InventoryCardField
          label="Stock on hand"
          value={
            <StockQuantity
              item={item}
              settings={data.settings}
              compact
              onClick={() => onStockAction(item.id)}
              title="Edit stock"
              ariaLabel={`Edit stock for ${item.partNumber || item.name || "item"}`}
            />
          }
        />
        <InventoryCardField
          label="Vendor"
          value={getVendorName(data, item.vendorId)}
        />
        <InventoryCardField
          label="Cost"
          value={formatCurrency(item.costEach)}
        />
      </div>
      <InventoryRowActions
        isSelectedForRequisition={isSelectedForRequisition}
        item={item}
        onDelete={onDelete}
        onEdit={onEdit}
        onPrintLabel={onPrintLabel}
        onToggleRequisition={onToggleRequisition}
      />
    </article>
  );
}

function InventoryCardField({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
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
  onImageRemove: () => void;
  onImageUpload: (file: File) => Promise<void>;
  onPrintLabel: () => void;
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
  onImageRemove,
  onImageUpload,
  onPrintLabel,
  onSubmit,
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
      <section
        className="item-form-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={editingItemId ? "Edit item" : "Add item"}
      >
        <ItemFormContent
          data={data}
          editingItemId={editingItemId}
          form={form}
          headerAction={
            <button
              className="settings-close item-form-close-button"
              type="button"
              aria-label="Close item form"
              onClick={onCancel}
            >
              X
            </button>
          }
          onCancel={onCancel}
          onChange={onChange}
          onImageRemove={onImageRemove}
          onImageUpload={onImageUpload}
          onPrintLabel={onPrintLabel}
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
  onImageRemove,
  onImageUpload,
  onPrintLabel,
  onSubmit,
}: ItemFormContentProps) {
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [scanValue, setScanValue] = useState("");
  const [showMediaOptions, setShowMediaOptions] = useState(() =>
    Boolean(form.imageDataUrl || form.imagePlaceholder || form.barcodePlaceholder),
  );
  const qrValue = getFormQrCodeValue(form, editingItemId);
  const imageAltText = `${form.name || form.partNumber || "Inventory item"} photo`;
  const cleanFormScanValue = cleanScanValue(scanValue);
  const scanUrlHref = getScanUrlHref(cleanFormScanValue);
  const scanSuggestedTarget = getScanSuggestedTarget(cleanFormScanValue);
  const scanSuggestionText =
    scanSuggestedTarget === "itemUrl"
      ? "Suggested target: Hyperlink / Part Info URL"
      : "Suggested target: Part Number";
  const inventoryCategoryOptions = getInventoryCategoryOptions(
    data,
    form.category,
  );

  function handleImageInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";

    if (file) {
      void onImageUpload(file);
    }
  }

  function applyScannedValue(target: ScanApplyTarget) {
    if (!cleanFormScanValue) {
      return;
    }

    if (target === "itemUrl") {
      if (!scanUrlHref) {
        return;
      }

      onChange({ ...form, itemUrl: scanUrlHref });
      return;
    }

    onChange({ ...form, [target]: cleanFormScanValue });
  }

  function applySuggestedScannedValue() {
    applyScannedValue(scanSuggestedTarget);
  }

  function handleFormScanKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      applySuggestedScannedValue();
    }
  }

  return (
    <>
      <div className="item-form-header">
        <SectionHeader
          action={headerAction}
          kicker="Item master"
          title={editingItemId ? "Edit Item" : "Add Item"}
        />
      </div>
      <form className="item-form-grid" onSubmit={onSubmit}>
        <label className="field-label xl:col-span-2">
          Item name
          <input
            className="input"
            value={form.name}
            onChange={(event) =>
              onChange({ ...form, name: event.target.value })
            }
          />
        </label>
        <label className="field-label">
          Part number
          <input
            className="input"
            value={form.partNumber}
            onChange={(event) =>
              onChange({ ...form, partNumber: event.target.value })
            }
          />
        </label>
        <label className="field-label xl:col-span-2">
          Hyperlink / Part Info URL
          <input
            className="input"
            placeholder="https://vendor.example/part"
            value={form.itemUrl}
            onChange={(event) =>
              onChange({ ...form, itemUrl: event.target.value })
            }
          />
        </label>
        <div className="scan-apply-panel md:col-span-2 xl:col-span-4">
          <label className="field-label">
            Scan Part / QR
            <input
              className="input"
              placeholder="Click here and scan with USB scanner"
              value={scanValue}
              onChange={(event) => setScanValue(event.target.value)}
              onKeyDown={handleFormScanKeyDown}
            />
          </label>
          <div className="scan-apply-actions">
            <span>
              {cleanFormScanValue ? scanSuggestionText : "No scan value yet."}
            </span>
            <button
              className="btn-small"
              type="button"
              onClick={applySuggestedScannedValue}
              disabled={!cleanFormScanValue}
            >
              Apply Suggested
            </button>
            <button
              className="btn-small"
              type="button"
              onClick={() => applyScannedValue("partNumber")}
              disabled={!cleanFormScanValue}
            >
              Apply to Part Number
            </button>
            <button
              className="btn-small"
              type="button"
              onClick={() => applyScannedValue("barcodePlaceholder")}
              disabled={!cleanFormScanValue}
            >
              Apply to QR Code Value
            </button>
            <button
              className="btn-small"
              type="button"
              onClick={() => applyScannedValue("itemUrl")}
              disabled={!scanUrlHref}
            >
              Apply to URL
            </button>
          </div>
        </div>
        <label className="field-label">
          Category
          <select
            className="input"
            value={form.category}
            onChange={(event) =>
              onChange({ ...form, category: event.target.value })
            }
          >
            {inventoryCategoryOptions.map((category) => (
              <option key={category}>{category}</option>
            ))}
          </select>
        </label>
        <label className="field-label md:col-span-2 xl:col-span-4">
          Description
          <textarea
            className="input min-h-24"
            value={form.description}
            onChange={(event) =>
              onChange({ ...form, description: event.target.value })
            }
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
                  allowNegative: data.settings.allowNegativeStockOverride,
                }),
              })
            }
          />
        </label>
        <label className="field-label">
          Stock unit
          <select
            className="input"
            value={normalizeStockUnit(form.stockUnit)}
            onChange={(event) =>
              onChange({
                ...form,
                stockUnit: normalizeStockUnit(event.target.value),
              })
            }
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
            onChange={(event) =>
              onChange({
                ...form,
                minimumStockLevel: normalizeWholeNumberInput(
                  event.target.value,
                ),
              })
            }
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
                lowStockAlertLevel: normalizeWholeNumberInput(
                  event.target.value,
                ),
              })
            }
          />
          <span className="field-helper">
            Set to 0 to turn off low stock alerts.
          </span>
        </label>
        <label className="field-label checkbox-field">
          <input
            type="checkbox"
            checked={Boolean(form.nonStocked)}
            onChange={(event) =>
              onChange({ ...form, nonStocked: event.currentTarget.checked })
            }
          />
          <span>Not stocked in-house / order as needed</span>
        </label>
        <label className="field-label">
          Location
          <select
            className="input"
            value={form.locationId}
            onChange={(event) =>
              onChange({ ...form, locationId: event.target.value })
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
          Vendor
          <select
            className="input"
            value={form.vendorId}
            onChange={(event) =>
              onChange({ ...form, vendorId: event.target.value })
            }
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
            onChange={(event) =>
              onChange({
                ...form,
                costEach: normalizeDecimalInput(event.target.value),
              })
            }
          />
        </label>
        <label className="field-label md:col-span-2 xl:col-span-3">
          Notes
          <input
            className="input"
            value={form.notes}
            onChange={(event) =>
              onChange({ ...form, notes: event.target.value })
            }
          />
        </label>
        <label className="field-label checkbox-field md:col-span-2 xl:col-span-4">
          <input
            type="checkbox"
            checked={showMediaOptions}
            onChange={(event) => setShowMediaOptions(event.currentTarget.checked)}
          />
          <span>Use image / QR label options</span>
        </label>
        {showMediaOptions && (
          <>
        <div className="media-placeholder md:col-span-1 xl:col-span-2">
          <span>Image / Photo</span>
          <div
            className={`image-upload-preview ${form.imageDataUrl ? "image-upload-preview-filled" : ""}`}
          >
            {form.imageDataUrl ? (
              <img src={form.imageDataUrl} alt={imageAltText} />
            ) : (
              <strong>No image selected</strong>
            )}
          </div>
          <div className="image-upload-actions">
            <input
              ref={imageInputRef}
              accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
              className="image-file-input"
              type="file"
              onChange={handleImageInputChange}
            />
            <button
              className="btn-muted"
              type="button"
              onClick={() => imageInputRef.current?.click()}
            >
              Choose Image
            </button>
            {form.imageDataUrl && (
              <button
                className="btn-muted"
                type="button"
                onClick={onImageRemove}
              >
                Remove Image
              </button>
            )}
          </div>
          <label className="field-label mt-3">
            Image note
            <input
              aria-label="Image note"
              className="input"
              placeholder="Optional image note"
              value={form.imagePlaceholder}
              onChange={(event) =>
                onChange({ ...form, imagePlaceholder: event.target.value })
              }
            />
          </label>
        </div>
        <div className="qr-placeholder md:col-span-1 xl:col-span-2">
          <span>QR label preview</span>
          <QrPreview value={qrValue} />
          <label className="field-label mt-3">
            QR Code Value
            <input
              className="input"
              placeholder="Optional QR value"
              value={form.barcodePlaceholder}
              onChange={(event) =>
                onChange({ ...form, barcodePlaceholder: event.target.value })
              }
            />
            <span className="field-helper">
              Leave blank to use part number.
            </span>
          </label>
        </div>
          </>
        )}
        <label className="field-label">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={Boolean(form.orderPlaced)}
              onChange={(event) =>
                onChange({ ...form, orderPlaced: event.currentTarget.checked })
              }
            />
            <span>Order placed (hide from dashboard)</span>
          </div>
        </label>
        <label className="field-label">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={Boolean(form.reorderHold)}
              onChange={(event) =>
                onChange({ ...form, reorderHold: event.currentTarget.checked })
              }
            />
            <span>Hold for reorder (show in held list)</span>
          </div>
          <span className="field-helper">
            If checked, this item will be excluded from the normal reorder
            alerts.
          </span>
        </label>
        <div className="item-form-actions">
          <button className="btn-primary" type="submit">
            {editingItemId ? "Update Item" : "Add Item"}
          </button>
          {editingItemId && (
            <button className="btn-small" type="button" onClick={onPrintLabel}>
              Print Label
            </button>
          )}
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
  onPrintLabel,
  onSubmit,
  onWatchListVisibilityClick,
}: {
  data: AppData;
  form: StockFormState;
  onChange: (form: StockFormState) => void;
  onLowStockAlertChange: (itemId: string, lowStockAlertLevel: number) => void;
  onMinimumStockChange: (itemId: string, minimumStockLevel: number) => void;
  onPrintLabel: (item: InventoryItem) => void;
  onSubmit: (event: FormEvent) => void;
  onWatchListVisibilityClick: (itemId: string) => void;
}) {
  const selectedItem = data.items.find((item) => item.id === form.itemId);
  const selectedStatus = selectedItem
    ? getInventoryStatus(selectedItem, data.settings)
    : null;
  const [minimumEdit, setMinimumEdit] = useState<{
    value: string;
    warning: string;
  } | null>(null);
  const [lowAlertEdit, setLowAlertEdit] = useState("");
  const skipLowAlertBlurRef = useRef(false);
  const quantityText = String(form.quantity).trim();
  const parsedQuantity = quantityText
    ? wholeNumberValue(form.quantity, Number.NaN)
    : Number.NaN;
  const hasValidQuantity =
    selectedItem !== undefined &&
    Number.isFinite(parsedQuantity) &&
    parsedQuantity !== 0;
  const previewQuantity =
    selectedItem && hasValidQuantity
      ? selectedItem.quantityOnHand + parsedQuantity
      : null;
  const validPreviewQuantity =
    previewQuantity !== null && previewQuantity >= 0 ? previewQuantity : null;
  const previewQuantityItem =
    selectedItem && validPreviewQuantity !== null
      ? { ...selectedItem, quantityOnHand: validPreviewQuantity }
      : null;
  const quantityChangeActionLabel =
    hasValidQuantity && parsedQuantity > 0
      ? "Add Stock"
      : hasValidQuantity && parsedQuantity < 0
        ? "Pull Stock"
        : "Waiting for quantity";

  useEffect(() => {
    setMinimumEdit(null);
  }, [selectedItem?.id]);

  useEffect(() => {
    setLowAlertEdit(
      selectedItem ? String(selectedItem.lowStockAlertLevel) : "",
    );
  }, [selectedItem?.id, selectedItem?.lowStockAlertLevel]);

  const saveMinimumEdit = () => {
    if (!selectedItem || !minimumEdit) {
      return;
    }

    const parsed = wholeNumberValue(minimumEdit.value, Number.NaN);

    if (!Number.isFinite(parsed) || parsed < 0) {
      setMinimumEdit({
        ...minimumEdit,
        warning: "Minimum stock level cannot be negative.",
      });
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

  const handleLowAlertKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    }

    if (event.key === "Escape") {
      event.preventDefault();
      skipLowAlertBlurRef.current = true;
      setLowAlertEdit(
        selectedItem ? String(selectedItem.lowStockAlertLevel) : "",
      );
      event.currentTarget.blur();
    }
  };

  const stockFlagStateForItem = (itemId: string) => {
    const item = data.items.find((candidate) => candidate.id === itemId);

    return {
      orderPlaced: Boolean(item?.orderPlaced),
      reorderHold: Boolean(item?.reorderHold),
    };
  };

  return (
    <section className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
      <section className="panel">
        <SectionHeader title="Stock Edit" />
        <form className="grid gap-4" onSubmit={onSubmit}>
          <label className="field-label">
            Select item
            <select
              className="input"
              value={form.itemId}
              onChange={(event) => {
                const itemId = event.target.value;
                onChange({ ...form, itemId, ...stockFlagStateForItem(itemId) });
              }}
            >
              <option value="">Choose item</option>
              {data.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} {item.partNumber ? `- ${item.partNumber}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            Quantity Change
            <input
              className="input"
              placeholder="Example: 5 or -2"
              step="1"
              type="number"
              value={form.quantity}
              onChange={(event) =>
                onChange({
                  ...form,
                  quantity: normalizeWholeNumberInput(event.target.value, {
                    allowNegative: true,
                  }),
                })
              }
            />
            <span className="field-helper">
              Use positive numbers to add stock. Use negative numbers to pull
              stock.
            </span>
          </label>
          {selectedItem && (
            <div className="stock-reorder-options">
              <label className="checkbox-card">
                <input
                  type="checkbox"
                  checked={Boolean(form.orderPlaced)}
                  onChange={(event) =>
                    onChange({
                      ...form,
                      orderPlaced: event.currentTarget.checked,
                    })
                  }
                />
                <span>Order placed / hide from Dashboard</span>
              </label>
              <label className="checkbox-card">
                <input
                  type="checkbox"
                  checked={Boolean(form.reorderHold)}
                  onChange={(event) =>
                    onChange({
                      ...form,
                      reorderHold: event.currentTarget.checked,
                    })
                  }
                />
                <span>Hold for reorder / show in Held list</span>
              </label>
            </div>
          )}
          {selectedItem && (
            <div className="stock-count-preview">
              <div>
                <span>Current Stock On Hand</span>
                <strong>{formatStockQuantity(selectedItem)}</strong>
              </div>
              <div>
                <span>Detected Action</span>
                <strong>{quantityChangeActionLabel}</strong>
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
              placeholder="Repair use, restock, cycle count note..."
              value={form.reason}
              onChange={(event) =>
                onChange({ ...form, reason: event.target.value })
              }
            />
          </label>
          <label className="field-label">
            Used by / Added by
            <input
              className="input"
              value={form.actor}
              onChange={(event) =>
                onChange({ ...form, actor: event.target.value })
              }
            />
          </label>
          <label className="field-label">
            Date/time
            <input
              className="input"
              type="datetime-local"
              value={form.occurredAt}
              onChange={(event) =>
                onChange({ ...form, occurredAt: event.target.value })
              }
            />
          </label>
          <label className="field-label">
            Notes
            <textarea
              className="input min-h-24"
              value={form.notes}
              onChange={(event) =>
                onChange({ ...form, notes: event.target.value })
              }
            />
          </label>
          <button className="btn-primary btn-stock-save" type="submit">
            Save Stock Change
          </button>
        </form>
      </section>
      <section className="panel">
        <SectionHeader
          kicker="Selected item"
          title={selectedItem?.name ?? "No item selected"}
        />
        {selectedItem ? (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <StatCard
                label="Stock On Hand"
                tone="cyan"
                value={formatStockQuantity(selectedItem)}
              />
              <button
                className="metric-card metric-amber metric-action-card"
                type="button"
                aria-label={`Edit minimum stock level for ${selectedItem.partNumber || selectedItem.name}`}
                title="Edit minimum stock level"
                onClick={() =>
                  setMinimumEdit({
                    value: String(selectedItem.minimumStockLevel),
                    warning: "",
                  })
                }
              >
                <span className="block text-xs font-bold uppercase text-slate-400">
                  Minimum
                </span>
                <span className="mt-2 block text-2xl font-black text-white">
                  {formatNumber(selectedItem.minimumStockLevel)}
                </span>
              </button>
              <StatCard
                label="Low Alert"
                tone="amber"
                value={formatNumber(selectedItem.lowStockAlertLevel)}
              />
              <StatusStatCard
                item={selectedItem}
                onWatchListVisibilityClick={onWatchListVisibilityClick}
                settings={data.settings}
                status={selectedStatus ?? "In Stock"}
              />
            </div>
            {previewQuantityItem && (
              <div className="stock-preview-card">
                <span>New Quantity After Save</span>
                <strong>{formatStockQuantity(previewQuantityItem)}</strong>
              </div>
            )}
            {minimumEdit && (
              <div
                className="minimum-edit-popover"
                role="dialog"
                aria-label="Edit minimum stock level"
              >
                <div>
                  <p className="eyebrow">Minimum Stock Level</p>
                  <h3>{selectedItem.partNumber || selectedItem.name}</h3>
                  <span>
                    Current minimum:{" "}
                    {formatNumber(selectedItem.minimumStockLevel)}
                  </span>
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
                      setMinimumEdit({
                        value: normalizeWholeNumberInput(event.target.value),
                        warning: "",
                      })
                    }
                  />
                </label>
                {minimumEdit.warning && (
                  <p className="warning-bar">{minimumEdit.warning}</p>
                )}
                <div className="minimum-edit-actions">
                  <button
                    className="btn-primary"
                    type="button"
                    onClick={saveMinimumEdit}
                  >
                    Save
                  </button>
                  <button
                    className="btn-muted"
                    type="button"
                    onClick={() => setMinimumEdit(null)}
                  >
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
                onChange={(event) =>
                  setLowAlertEdit(normalizeWholeNumberInput(event.target.value))
                }
                onKeyDown={handleLowAlertKeyDown}
              />
              <span className="field-helper">
                Set to 0 to turn off low stock alerts.
              </span>
            </label>
            <div className="summary-strip">
              <span>{selectedItem.partNumber || "No part number"}</span>
              <span>{selectedItem.category || "No category"}</span>
              <span>{getLocationName(data, selectedItem.locationId)}</span>
              <span>{getVendorName(data, selectedItem.vendorId)}</span>
            </div>
            <button
              className="btn-small"
              type="button"
              onClick={() => onPrintLabel(selectedItem)}
            >
              Print Label
            </button>
            <p className="warning-bar">
              Signed stock changes cannot pull more than the current stock on
              hand.
            </p>
          </div>
        ) : (
          <p className="text-sm font-semibold text-slate-400">
            Choose an item to preview quantity and status.
          </p>
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
  onOpenItems,
  onSubmit,
  onToggleAdd,
  newLocationNoticeIds,
  updateSettings,
}: {
  data: AppData;
  form: LocationFormState;
  isAddOpen: boolean;
  onChange: (form: LocationFormState) => void;
  onDelete: (locationId: string) => void;
  onOpenItems: (locationId: string) => void;
  onSubmit: (event: FormEvent) => void;
  onToggleAdd: () => void;
  newLocationNoticeIds: string[];
  updateSettings: (settings: AppSettings, auditSummary?: string) => void;
}) {
  const [locationSearch, setLocationSearch] = useState("");
  const locationItemCounts = useMemo(() => {
    const counts = new Map<string, number>();

    data.items.forEach((item) => {
      counts.set(item.locationId, (counts.get(item.locationId) ?? 0) + 1);
    });

    return counts;
  }, [data.items]);
  const filteredLocations = useMemo(() => {
    const search = locationSearch.trim().toLowerCase();

    if (!search) {
      return data.locations;
    }

    return data.locations.filter((location) =>
      [location.name, location.description, location.notes]
        .join(" ")
        .toLowerCase()
        .includes(search),
    );
  }, [data.locations, locationSearch]);

  return (
    <section className="space-y-5 entity-directory-page">
      <section
        className={`collapsible-add-panel vendor-add-panel location-add-panel${isAddOpen ? " vendor-add-panel-open" : ""}`}
      >
        <button
          className="collapsible-add-trigger vendor-add-trigger location-add-trigger"
          type="button"
          aria-expanded={isAddOpen}
          onClick={onToggleAdd}
        >
          <span>{isAddOpen ? "-" : "+"}</span>
          Add Location
        </button>
        {isAddOpen && (
          <form className="collapsible-add-form" onSubmit={onSubmit}>
            <label className="field-label">
              Location name
              <input
                className="input"
                value={form.name}
                onChange={(event) =>
                  onChange({ ...form, name: event.target.value })
                }
              />
            </label>
            <label className="field-label">
              Description
              <input
                className="input"
                value={form.description}
                onChange={(event) =>
                  onChange({ ...form, description: event.target.value })
                }
              />
            </label>
            <label className="field-label">
              Notes
              <textarea
                className="input min-h-24"
                value={form.notes}
                onChange={(event) =>
                  onChange({ ...form, notes: event.target.value })
                }
              />
            </label>
            <button className="btn-primary" type="submit">
              Add Location
            </button>
          </form>
        )}
      </section>
      <section className="panel entity-directory-panel">
        <SectionHeader kicker="Storage map" title="Locations" />
        <div className="entity-directory-toolbar">
          <label className="entity-search-field">
            <span>Search locations</span>
            <input
              className="input"
              placeholder="Search name, description, or notes"
              value={locationSearch}
              onChange={(event) => setLocationSearch(event.target.value)}
            />
          </label>
        </div>
        <SimpleTable
          emptyText={
            locationSearch.trim()
              ? "No location found. Add this location if needed."
              : "No locations saved."
          }
          headers={[
            "Name",
            "Description",
            "Items",
            "Default",
            "Notes",
            "Actions",
          ]}
          rowKeys={filteredLocations.map((location) => location.id)}
          rowClassNames={filteredLocations.map((location) =>
            newLocationNoticeIds.includes(location.id)
              ? "new-entity-row"
              : "",
          )}
          rows={filteredLocations.map((location) => {
            const itemCount = locationItemCounts.get(location.id) ?? 0;

            return [
              <span key="name" className="entity-name-with-chip">
                {location.name}
                {newLocationNoticeIds.includes(location.id) && (
                  <NewEntityChip />
                )}
              </span>,
              location.description || "-",
              <button
                key="items"
                className="entity-count-button"
                type="button"
                onClick={() => onOpenItems(location.id)}
                title={`Open ${location.name} inventory items`}
              >
                {formatNumber(itemCount)}
              </button>,
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
                      `${location.name} was set as the default location.`,
                    )
                  }
                >
                  Set Default
                </button>
              ),
              location.notes || "-",
              <button
                key="delete"
                className="btn-danger"
                type="button"
                onClick={() => onDelete(location.id)}
              >
                Delete
              </button>,
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
  onOpenItems,
  onSubmit,
  onToggleAdd,
  onUpdateNotes,
  recentlySavedVendorNoteId,
  newVendorNoticeIds,
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
  onInlineAiHelp: (
    vendor: VendorRecord,
    currentDraft: string,
  ) => Promise<string | null>;
  onOpenItems: (vendorId: string) => void;
  onSubmit: (event: FormEvent) => void;
  onToggleAdd: () => void;
  onUpdateNotes: (vendorId: string, notes: string) => void;
  recentlySavedVendorNoteId: string | null;
  newVendorNoticeIds: string[];
}) {
  const isEditing = Boolean(editingVendorId);
  const panelTitle = isEditing ? "Edit Vendor" : "Add Vendor";
  const [vendorSearch, setVendorSearch] = useState("");
  const vendorItemCounts = useMemo(() => {
    const counts = new Map<string, number>();

    data.items.forEach((item) => {
      counts.set(item.vendorId, (counts.get(item.vendorId) ?? 0) + 1);
    });

    return counts;
  }, [data.items]);
  const filteredVendors = useMemo(() => {
    const search = vendorSearch.trim().toLowerCase();

    if (!search) {
      return data.vendors;
    }

    return data.vendors.filter((vendor) =>
      [
        vendor.name,
        vendor.contactName,
        vendor.contactEmail,
        vendor.phone,
        vendor.email,
        vendor.website,
        vendor.notes,
      ]
        .join(" ")
        .toLowerCase()
        .includes(search),
    );
  }, [data.vendors, vendorSearch]);

  return (
    <section className="space-y-5 entity-directory-page">
      <section
        className={`collapsible-add-panel vendor-add-panel${isAddOpen ? " vendor-add-panel-open" : ""}`}
      >
        <button
          className="collapsible-add-trigger vendor-add-trigger"
          type="button"
          aria-expanded={isAddOpen}
          onClick={onToggleAdd}
        >
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
              <input
                className="input"
                value={form.name}
                onChange={(event) =>
                  onChange({ ...form, name: event.target.value })
                }
              />
            </label>
            <label className="field-label">
              Contact
              <input
                className="input"
                value={form.contactName}
                onChange={(event) =>
                  onChange({ ...form, contactName: event.target.value })
                }
              />
            </label>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="field-label">
                Phone
                <input
                  className="input"
                  value={form.phone}
                  onChange={(event) =>
                    onChange({ ...form, phone: event.target.value })
                  }
                />
              </label>
              <label className="field-label">
                Contact Email
                <input
                  className="input"
                  value={form.contactEmail}
                  onChange={(event) =>
                    onChange({ ...form, contactEmail: event.target.value })
                  }
                />
              </label>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="field-label">
                General Email / Sales / Service
                <input
                  className="input"
                  value={form.email}
                  onChange={(event) =>
                    onChange({ ...form, email: event.target.value })
                  }
                />
              </label>
              <label className="field-label">
                Website
                <input
                  className="input"
                  value={form.website}
                  onChange={(event) =>
                    onChange({ ...form, website: event.target.value })
                  }
                />
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
                      notes: cleanMaintenanceNote(currentForm.notes),
                    }))
                  }
                  disabled={!form.notes.trim()}
                >
                  Clean Note
                </button>
              </div>
              <textarea
                className="input min-h-24"
                value={form.notes}
                onChange={(event) =>
                  onChange({ ...form, notes: event.target.value })
                }
              />
              <span className="field-helper">
                Clean Note is basic local cleanup. AI Suggest builds the vendor
                purpose note.
              </span>
            </div>
            <div className="vendor-form-actions">
              <button className="btn-primary" type="submit">
                {isEditing ? "Update Vendor" : "Add Vendor"}
              </button>
              {isEditing && (
                <button
                  className="btn-muted"
                  type="button"
                  onClick={onCancelEdit}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        )}
      </section>
      <section className="panel entity-directory-panel">
        <SectionHeader kicker="Supplier list" title="Vendors" />
        <div className="entity-directory-toolbar">
          <label className="entity-search-field">
            <span>Search vendors</span>
            <input
              className="input"
              placeholder="Search name, contact, phone, email, website, or notes"
              value={vendorSearch}
              onChange={(event) => setVendorSearch(event.target.value)}
            />
          </label>
        </div>
        <div className="vendor-table">
          <SimpleTable
            emptyText={
              vendorSearch.trim()
                ? "No vendor found. Add this vendor if needed."
                : "No vendors saved."
            }
            headers={[
              "Name",
              "Contact",
              "Phone",
              "General Email",
              "Website",
              "Items",
              "Notes",
              "Actions",
            ]}
            rowKeys={filteredVendors.map(
              (vendor) => `${vendor.id}-${vendor.updatedAt}-${vendor.notes}`,
            )}
            rowClassNames={filteredVendors.map((vendor) =>
              newVendorNoticeIds.includes(vendor.id) ? "new-entity-row" : "",
            )}
            rows={filteredVendors.map((vendor) => {
              const itemCount = vendorItemCounts.get(vendor.id) ?? 0;

              return [
                <span key="name" className="entity-name-with-chip">
                  {vendor.name}
                  {newVendorNoticeIds.includes(vendor.id) && (
                    <NewEntityChip />
                  )}
                </span>,
                <VendorContactCell key="contact" vendor={vendor} />,
                vendor.phone || "-",
                <VendorEmailCell key="email" email={vendor.email} />,
                <VendorWebsiteCell key="website" website={vendor.website} />,
                <button
                  key="items"
                  className="entity-count-button"
                  type="button"
                  onClick={() => onOpenItems(vendor.id)}
                  title={`Open ${vendor.name} inventory items`}
                >
                  {formatNumber(itemCount)}
                </button>,
                <VendorNotesCell
                  key="notes"
                  isRecentlySaved={recentlySavedVendorNoteId === vendor.id}
                  onAiHelp={onInlineAiHelp}
                  onSave={onUpdateNotes}
                  vendor={vendor}
                />,
                <div key="actions" className="vendor-action-group">
                  <button
                    className="vendor-edit-button"
                    type="button"
                    onClick={() => onEdit(vendor)}
                  >
                    Edit
                  </button>
                  <button
                    className="vendor-delete-button"
                    type="button"
                    onClick={() => onDelete(vendor.id)}
                  >
                    Delete
                  </button>
                </div>,
              ];
            })}
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
    <a
      className="vendor-link vendor-website-link"
      href={href}
      target="_blank"
      rel="noreferrer"
      title={trimmedWebsite}
    >
      <span className="vendor-website-text">{displayText}</span>
    </a>
  );
}

function VendorNotesCell({
  isRecentlySaved,
  onAiHelp,
  onSave,
  vendor,
}: {
  isRecentlySaved: boolean;
  onAiHelp: (
    vendor: VendorRecord,
    currentDraft: string,
  ) => Promise<string | null>;
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
        <textarea
          className="input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
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
          <button
            className="vendor-note-button"
            type="button"
            onClick={saveNotes}
          >
            Save
          </button>
          <button
            className="vendor-note-button"
            type="button"
            onClick={cancelNotes}
          >
            Cancel
          </button>
        </div>
        <p className="vendor-note-helper">
          Clean Note is basic local cleanup. AI Suggest builds the vendor
          purpose note.
        </p>
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

type PartsReportColumn = {
  header: string;
  value: (item: InventoryItem) => string;
};

async function printPartsReport({
  columns,
  entityName,
  entityType,
  itemCount,
  items,
}: {
  columns: PartsReportColumn[];
  entityName: string;
  entityType: "Vendor" | "Location";
  itemCount: number;
  items: InventoryItem[];
}) {
  const generatedAt = nowIso();
  const tableRows = items
    .map(
      (item) =>
        `<tr>${columns
          .map((column) => `<td>${escapeReportHtml(column.value(item))}</td>`)
          .join("")}</tr>`,
    )
    .join("");

  await openPrintableReport(
    `Maintenance Inventory Tracker - ${entityType} Parts - ${entityName}`,
    `<main class="report">
      <header class="report-header">
        <p class="report-kicker">Maintenance Inventory Tracker</p>
        <h1>${escapeReportHtml(entityName)} Parts List</h1>
      </header>
      <section class="report-meta">
        <div><span>${escapeReportHtml(entityType)}</span><strong>${escapeReportHtml(entityName)}</strong></div>
        <div><span>Generated</span><strong>${escapeReportHtml(formatDateTime(generatedAt))}</strong></div>
        <div><span>Total Items</span><strong>${escapeReportHtml(formatNumber(itemCount))}</strong></div>
      </section>
      <table>
        <thead>
          <tr>${columns.map((column) => `<th>${escapeReportHtml(column.header)}</th>`).join("")}</tr>
        </thead>
        <tbody>${tableRows || `<tr><td colspan="${columns.length}">No inventory items found.</td></tr>`}</tbody>
      </table>
    </main>`,
  );
}

function EntityDetailField({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="entity-detail-field">
      <span>{label}</span>
      <strong>{value || "-"}</strong>
    </div>
  );
}

function VendorItemsDialog({
  data,
  onClose,
  onWatchListVisibilityClick,
  vendorId,
}: {
  data: AppData;
  onClose: () => void;
  onWatchListVisibilityClick: (itemId: string) => void;
  vendorId: string;
}) {
  const vendor = data.vendors.find((candidate) => candidate.id === vendorId);
  const items = useMemo(
    () =>
      data.items
        .filter((item) => item.vendorId === vendorId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [data.items, vendorId],
  );
  const [printStatus, setPrintStatus] = useState("");
  const [printStatusType, setPrintStatusType] = useState<"success" | "error">(
    "success",
  );

  if (!vendor) {
    return null;
  }

  const vendorName = vendor.name;
  const websiteHref = getExternalHref(vendor.website);
  const title = `${vendorName} - ${formatNumber(items.length)} Inventory Items`;

  async function handlePrint() {
    try {
      await printPartsReport({
        entityName: vendorName,
        entityType: "Vendor",
        itemCount: items.length,
        items,
        columns: [
          {
            header: "Location",
            value: (item) => getLocationName(data, item.locationId),
          },
          { header: "Part Number", value: (item) => item.partNumber || "-" },
          { header: "Category", value: (item) => item.category || "-" },
          {
            header: "Description / Name",
            value: (item) => item.description || item.name,
          },
          { header: "Stock On Hand", value: formatStockQuantity },
          {
            header: "Status",
            value: (item) => getInventoryStatus(item, data.settings),
          },
          { header: "Cost", value: (item) => formatCurrency(item.costEach) },
        ],
      });
      setPrintStatus("Vendor parts print view started.");
      setPrintStatusType("success");
    } catch (error) {
      setPrintStatus(
        error instanceof Error
          ? error.message
          : "Could not generate print file.",
      );
      setPrintStatusType("error");
    }
  }

  return (
    <div className="review-modal-backdrop" role="presentation">
      <section
        className="review-modal entity-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vendor-items-title"
      >
        <div className="entity-detail-header">
          <div>
            <p className="eyebrow">Vendor parts</p>
            <h3 id="vendor-items-title">{title}</h3>
          </div>
          <div className="entity-detail-actions">
            {websiteHref && (
              <a
                className="btn-muted entity-website-button"
                href={websiteHref}
                target="_blank"
                rel="noreferrer"
              >
                Website
              </a>
            )}
            <button className="btn-primary" type="button" onClick={handlePrint}>
              Print Vendor Parts PDF
            </button>
            <button className="btn-muted" type="button" onClick={onClose}>
              Close
            </button>
            {printStatus && (
              <span
                className={`requisition-status-message requisition-status-${printStatusType}`}
              >
                {printStatus}
              </span>
            )}
          </div>
        </div>
        <div className="entity-detail-grid">
          <EntityDetailField
            label="Contact"
            value={vendor.contactName || "-"}
          />
          <EntityDetailField label="Phone" value={vendor.phone || "-"} />
          <EntityDetailField
            label="Email"
            value={vendor.email || vendor.contactEmail || "-"}
          />
          <EntityDetailField label="Items" value={formatNumber(items.length)} />
          <EntityDetailField label="Notes" value={vendor.notes || "-"} />
        </div>
        <SimpleTable
          emptyText="No inventory items assigned to this vendor."
          headers={[
            "Location",
            "Part Number",
            "Category",
            "Description / Name",
            "Stock On Hand",
            "Status",
            "Cost",
          ]}
          rowKeys={items.map((item) => item.id)}
          rows={items.map((item) => [
            getLocationName(data, item.locationId),
            item.partNumber || "-",
            item.category || "-",
            item.description || item.name,
            formatStockQuantity(item),
            <StatusWithWatchVisibility
              key="status"
              item={item}
              settings={data.settings}
              onWatchListVisibilityClick={onWatchListVisibilityClick}
            />,
            formatCurrency(item.costEach),
          ])}
        />
      </section>
    </div>
  );
}

function LocationItemsDialog({
  data,
  locationId,
  onClose,
  onWatchListVisibilityClick,
}: {
  data: AppData;
  locationId: string;
  onClose: () => void;
  onWatchListVisibilityClick: (itemId: string) => void;
}) {
  const location = data.locations.find(
    (candidate) => candidate.id === locationId,
  );
  const items = useMemo(
    () =>
      data.items
        .filter((item) => item.locationId === locationId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [data.items, locationId],
  );
  const [printStatus, setPrintStatus] = useState("");
  const [printStatusType, setPrintStatusType] = useState<"success" | "error">(
    "success",
  );

  if (!location) {
    return null;
  }

  const locationName = location.name;
  const title = `${locationName} - ${formatNumber(items.length)} Inventory Items`;

  async function handlePrint() {
    try {
      await printPartsReport({
        entityName: locationName,
        entityType: "Location",
        itemCount: items.length,
        items,
        columns: [
          {
            header: "Vendor",
            value: (item) => getVendorName(data, item.vendorId),
          },
          { header: "Part Number", value: (item) => item.partNumber || "-" },
          { header: "Category", value: (item) => item.category || "-" },
          {
            header: "Description / Name",
            value: (item) => item.description || item.name,
          },
          { header: "Stock On Hand", value: formatStockQuantity },
          {
            header: "Status",
            value: (item) => getInventoryStatus(item, data.settings),
          },
          { header: "Cost", value: (item) => formatCurrency(item.costEach) },
        ],
      });
      setPrintStatus("Location parts print view started.");
      setPrintStatusType("success");
    } catch (error) {
      setPrintStatus(
        error instanceof Error
          ? error.message
          : "Could not generate print file.",
      );
      setPrintStatusType("error");
    }
  }

  return (
    <div className="review-modal-backdrop" role="presentation">
      <section
        className="review-modal entity-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="location-items-title"
      >
        <div className="entity-detail-header">
          <div>
            <p className="eyebrow">Location parts</p>
            <h3 id="location-items-title">{title}</h3>
          </div>
          <div className="entity-detail-actions">
            <button className="btn-primary" type="button" onClick={handlePrint}>
              Print Location Parts PDF
            </button>
            <button className="btn-muted" type="button" onClick={onClose}>
              Close
            </button>
            {printStatus && (
              <span
                className={`requisition-status-message requisition-status-${printStatusType}`}
              >
                {printStatus}
              </span>
            )}
          </div>
        </div>
        <div className="entity-detail-grid">
          <EntityDetailField
            label="Description"
            value={location.description || "-"}
          />
          <EntityDetailField label="Items" value={formatNumber(items.length)} />
          <EntityDetailField label="Notes" value={location.notes || "-"} />
        </div>
        <SimpleTable
          emptyText="No inventory items assigned to this location."
          headers={[
            "Vendor",
            "Part Number",
            "Category",
            "Description / Name",
            "Stock On Hand",
            "Status",
            "Cost",
          ]}
          rowKeys={items.map((item) => item.id)}
          rows={items.map((item) => [
            getVendorName(data, item.vendorId),
            item.partNumber || "-",
            item.category || "-",
            item.description || item.name,
            formatStockQuantity(item),
            <StatusWithWatchVisibility
              key="status"
              item={item}
              settings={data.settings}
              onWatchListVisibilityClick={onWatchListVisibilityClick}
            />,
            formatCurrency(item.costEach),
          ])}
        />
      </section>
    </div>
  );
}

async function printReorderHistoryReport(
  historyRows: {
    record: RequisitionMadeRecord;
    snapshot: RequisitionMadeRecord["itemSnapshots"][number];
  }[],
  historyFilters: {
    year: string;
    vendor: string;
    poNo: string;
    partNumber: string;
    itemName: string;
  },
) {
  const activeFilters = [
    historyFilters.year.trim() ? `Year: ${historyFilters.year.trim()}` : "",
    historyFilters.vendor.trim()
      ? `Vendor: ${historyFilters.vendor.trim()}`
      : "",
    historyFilters.poNo.trim() ? `PO: ${historyFilters.poNo.trim()}` : "",
    historyFilters.partNumber.trim()
      ? `Part Number: ${historyFilters.partNumber.trim()}`
      : "",
    historyFilters.itemName.trim()
      ? `Item: ${historyFilters.itemName.trim()}`
      : "",
  ].filter(Boolean);
  const rows = historyRows
    .map(
      ({ record, snapshot }) => `<tr>
      <td>${escapeReportHtml(formatDateTime(getRequisitionRecordDate(record)))}</td>
      <td>${escapeReportHtml(getRequisitionRecordYear(record) || "-")}</td>
      <td>${escapeReportHtml(record.vendorName)}</td>
      <td>${escapeReportHtml(record.poNo || "-")}</td>
      <td>${escapeReportHtml(formatRequisitionType(record.requisitionType))}</td>
      <td>${escapeReportHtml(record.status)}</td>
      <td>${escapeReportHtml(snapshot.itemName)}</td>
      <td>${escapeReportHtml(snapshot.partNumber || "-")}</td>
      <td class="text-right">${escapeReportHtml(formatNumber(snapshot.quantityRequested))}</td>
      <td class="text-right">${escapeReportHtml(formatCurrency(snapshot.unitCost))}</td>
      <td class="text-right">${escapeReportHtml(formatCurrency(snapshot.totalCost))}</td>
      <td>${escapeReportHtml(record.createdBy || record.requisitionedBy || "-")}</td>
    </tr>`,
    )
    .join("");

  await openPrintableReport(
    "Maintenance Inventory Tracker - Reorder History",
    `<main class="report">
      <header class="report-header">
        <p class="report-kicker">Maintenance Inventory Tracker</p>
        <h1>Reorder History</h1>
      </header>
      <section class="report-meta">
        <div><span>Generated</span><strong>${escapeReportHtml(formatDateTime(nowIso()))}</strong></div>
        <div><span>Filters</span><strong>${escapeReportHtml(activeFilters.join(" | ") || "None")}</strong></div>
        <div><span>Records</span><strong>${escapeReportHtml(formatNumber(historyRows.length))}</strong></div>
      </section>
      <table class="report-wide-table">
        <thead>
          <tr>
            <th>Created</th>
            <th>Year</th>
            <th>Vendor</th>
            <th>PO</th>
            <th>Form Type</th>
            <th>Status</th>
            <th>Item</th>
            <th>Part Number</th>
            <th>Qty</th>
            <th>Unit Cost</th>
            <th>Total Cost</th>
            <th>Created By</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </main>`,
  );
}

function ReorderPage({
  data,
  inventoryRequisitionLaunch,
  items,
  onDataChange,
  onStockAction,
  onWatchListVisibilityClick,
}: {
  data: AppData;
  inventoryRequisitionLaunch: { id: string; itemIds: string[] } | null;
  items: InventoryItem[];
  onDataChange: (updater: (current: AppData) => AppData) => void;
  onStockAction: (itemId: string, actionType?: StockActionType | "") => void;
  onWatchListVisibilityClick: (itemId: string) => void;
}) {
  const [reorderView, setReorderView] = useState<
    "items" | "forms" | "made" | "history"
  >("items");
  const [selectedReorderItemIds, setSelectedReorderItemIds] = useState<
    string[]
  >([]);
  const [manualRequisitionDraft, setManualRequisitionDraft] =
    useState<ManualRequisitionDraft>(() => blankManualRequisitionDraft());
  const [manualRequisitionItems, setManualRequisitionItems] = useState<
    InventoryItem[]
  >([]);
  const [isManualRequisitionOpen, setIsManualRequisitionOpen] = useState(false);
  const [requisitionInventorySearch, setRequisitionInventorySearch] =
    useState("");
  const [requisitionLines, setRequisitionLines] = useState<
    Record<string, RequisitionLineDraft>
  >({});
  const [requisitionHeaders, setRequisitionHeaders] = useState<
    Record<string, RequisitionHeaderDraft>
  >({});
  const [activeRequisitionGroupIndex, setActiveRequisitionGroupIndex] =
    useState(0);
  const [completedRequisitionVendorKeys, setCompletedRequisitionVendorKeys] =
    useState<string[]>([]);
  const [pendingReviewVendorKey, setPendingReviewVendorKey] = useState<
    string | null
  >(null);
  const [pendingReviewPdfGeneratedAt, setPendingReviewPdfGeneratedAt] =
    useState("");
  const [selectedMadeRecord, setSelectedMadeRecord] =
    useState<RequisitionMadeRecord | null>(null);
  const [historyFilters, setHistoryFilters] =
    useState<RequisitionHistoryFilters>(() => blankRequisitionHistoryFilters());
  const [historyPrintStatus, setHistoryPrintStatus] = useState("");
  const [historyPrintStatusType, setHistoryPrintStatusType] = useState<
    "success" | "error"
  >("success");
  const [requisitionHistoryPage, setRequisitionHistoryPage] = useState(1);
  const [requisitionHistoryPageSize, setRequisitionHistoryPageSize] = useState(
    DEFAULT_REQUISITION_HISTORY_PAGE_SIZE,
  );
  const [reorderWarning, setReorderWarning] = useState("");

  const activeMadeRecords = useMemo(
    () => getActiveRequisitionMadeRecords(data),
    [data],
  );
  const activeRequisitionMadeItemIds = useMemo(
    () => getActiveRequisitionMadeItemIds(data),
    [data],
  );
  const selectedItemIdSet = useMemo(
    () => new Set(selectedReorderItemIds),
    [selectedReorderItemIds],
  );
  const requisitionSourceItems = useMemo(() => {
    const reorderItemIds = new Set(items.map((item) => item.id));
    const selectedExtraItems = data.items.filter(
      (item) => selectedItemIdSet.has(item.id) && !reorderItemIds.has(item.id),
    );

    return [...manualRequisitionItems, ...selectedExtraItems, ...items];
  }, [data.items, items, manualRequisitionItems, selectedItemIdSet]);
  const requisitionSourceItemById = useMemo(
    () => new Map(requisitionSourceItems.map((item) => [item.id, item])),
    [requisitionSourceItems],
  );
  const selectedItems = useMemo(
    () =>
      requisitionSourceItems.filter(
        (item) =>
          selectedItemIdSet.has(item.id) &&
          (isManualRequisitionItem(item) ||
            !activeRequisitionMadeItemIds.has(item.id)),
      ),
    [activeRequisitionMadeItemIds, requisitionSourceItems, selectedItemIdSet],
  );
  const vendorGroups = useMemo(
    () => groupItemsByVendor(data, selectedItems),
    [data, selectedItems],
  );
  const activeVendorGroup = vendorGroups[activeRequisitionGroupIndex];
  const activeRequisitionHeader = activeVendorGroup
    ? (requisitionHeaders[activeVendorGroup.vendorKey] ??
      createDefaultRequisitionHeaderForGroup(activeVendorGroup))
    : null;
  const activeVendorGroupCompleted = activeVendorGroup
    ? completedRequisitionVendorKeys.includes(activeVendorGroup.vendorKey)
    : false;
  const allSelectedVendorFormsReviewed =
    vendorGroups.length > 0 &&
    vendorGroups.every((group) =>
      completedRequisitionVendorKeys.includes(group.vendorKey),
    );
  const pendingReviewVendorGroup = pendingReviewVendorKey
    ? vendorGroups.find((group) => group.vendorKey === pendingReviewVendorKey)
    : null;
  const madeRows = useMemo(
    () =>
      activeMadeRecords.flatMap((record) =>
        record.itemSnapshots.map((snapshot) => ({
          record,
          snapshot,
        })),
      ),
    [activeMadeRecords],
  );
  const historyYears = useMemo(
    () => getRequisitionHistoryYears(data.requisitionMadeRecords),
    [data.requisitionMadeRecords],
  );
  const historyRows = useMemo(
    () =>
      getFilteredRequisitionHistoryRows(
        data.requisitionMadeRecords,
        historyFilters,
      ),
    [data.requisitionMadeRecords, historyFilters],
  );
  const totalRequisitionHistoryItems = historyRows.length;
  const totalRequisitionHistoryPages = Math.max(
    1,
    Math.ceil(totalRequisitionHistoryItems / requisitionHistoryPageSize),
  );
  const safeRequisitionHistoryPage = Math.min(
    requisitionHistoryPage,
    totalRequisitionHistoryPages,
  );
  const requisitionHistoryPageStartIndex =
    (safeRequisitionHistoryPage - 1) * requisitionHistoryPageSize;
  const paginatedHistoryRows = historyRows.slice(
    requisitionHistoryPageStartIndex,
    requisitionHistoryPageStartIndex + requisitionHistoryPageSize,
  );
  const requisitionHistoryPageStartNumber =
    totalRequisitionHistoryItems === 0
      ? 0
      : requisitionHistoryPageStartIndex + 1;
  const requisitionHistoryPageEndNumber =
    totalRequisitionHistoryItems === 0
      ? 0
      : requisitionHistoryPageStartIndex + paginatedHistoryRows.length;
  const inventoryPickerResults = useMemo(
    () =>
      getRequisitionInventoryPickerResults(
        data,
        requisitionInventorySearch,
        selectedItemIdSet,
      ),
    [data, requisitionInventorySearch, selectedItemIdSet],
  );

  useEffect(() => {
    if (!inventoryRequisitionLaunch?.itemIds.length) {
      return;
    }

    setSelectedReorderItemIds((current) =>
      Array.from(new Set([...current, ...inventoryRequisitionLaunch.itemIds])),
    );
    setReorderView("forms");
    setReorderWarning("");
  }, [inventoryRequisitionLaunch]);

  useEffect(() => {
    const availableInventoryItemIds = new Set(
      data.items
        .filter((item) => !activeRequisitionMadeItemIds.has(item.id))
        .map((item) => item.id),
    );
    const manualItemIds = new Set(
      manualRequisitionItems.map((item) => item.id),
    );

    setSelectedReorderItemIds((current) =>
      current.filter(
        (itemId) =>
          availableInventoryItemIds.has(itemId) || manualItemIds.has(itemId),
      ),
    );
  }, [activeRequisitionMadeItemIds, data.items, manualRequisitionItems]);

  useEffect(() => {
    const selectedIds = new Set(selectedReorderItemIds);

    setRequisitionLines((current) => {
      let changed = false;
      const next = { ...current };

      selectedReorderItemIds.forEach((itemId) => {
        const item = requisitionSourceItemById.get(itemId);

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
  }, [requisitionSourceItemById, selectedReorderItemIds]);

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
    setRequisitionHistoryPage(1);
  }, [historyFilters, requisitionHistoryPageSize]);

  useEffect(() => {
    setRequisitionHistoryPage((current) =>
      Math.min(current, totalRequisitionHistoryPages),
    );
  }, [totalRequisitionHistoryPages]);

  function handleRequisitionHistoryPageSizeChange(
    event: React.ChangeEvent<HTMLSelectElement>,
  ) {
    const nextPageSize = Number(event.target.value);

    setRequisitionHistoryPageSize(
      REQUISITION_HISTORY_PAGE_SIZE_OPTIONS.some(
        (option) => option === nextPageSize,
      )
        ? nextPageSize
        : DEFAULT_REQUISITION_HISTORY_PAGE_SIZE,
    );
  }

  async function handlePrintReorderHistory() {
    try {
      await printReorderHistoryReport(historyRows, historyFilters);
      setHistoryPrintStatus("Print view started.");
      setHistoryPrintStatusType("success");
    } catch {
      setHistoryPrintStatus("Could not generate print file.");
      setHistoryPrintStatusType("error");
    }
  }

  useEffect(() => {
    const vendorKeys = new Set(vendorGroups.map((group) => group.vendorKey));

    setRequisitionHeaders((current) => {
      let changed = false;
      const next = { ...current };

      vendorGroups.forEach((group) => {
        if (!next[group.vendorKey]) {
          next[group.vendorKey] = createDefaultRequisitionHeaderForGroup(group);
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
    const item = requisitionSourceItemById.get(itemId);

    if (!item) {
      return;
    }

    if (
      !isManualRequisitionItem(item) &&
      activeRequisitionMadeItemIds.has(itemId)
    ) {
      setReorderWarning("This item already has a requisition made.");
      return;
    }

    setReorderWarning("");
    setSelectedReorderItemIds((current) =>
      current.includes(itemId)
        ? current.filter((selectedId) => selectedId !== itemId)
        : [...current, itemId],
    );
  }

  function selectAllReorderItems() {
    const selectableItemIds = requisitionSourceItems
      .filter(
        (item) =>
          isManualRequisitionItem(item) ||
          !activeRequisitionMadeItemIds.has(item.id),
      )
      .map((item) => item.id);

    setSelectedReorderItemIds(selectableItemIds);
    setReorderWarning(
      selectableItemIds.length === 0 && requisitionSourceItems.length > 0
        ? "All reorder items already have requisitions made."
        : "",
    );
  }

  function clearSelectedReorderItems() {
    setSelectedReorderItemIds([]);
    setReorderWarning("");
  }

  function createRequisitionForms() {
    if (!hasPermission(readAuthRecord()?.role, "requisitions:create")) {
      setReorderWarning(PERMISSION_DENIED_MESSAGE);
      return;
    }

    if (selectedReorderItemIds.length === 0) {
      return;
    }

    const selectableItemIds = selectedReorderItemIds.filter((itemId) => {
      const item = requisitionSourceItemById.get(itemId);
      return (
        item &&
        (isManualRequisitionItem(item) ||
          !activeRequisitionMadeItemIds.has(itemId))
      );
    });

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

  function updateRequisitionLine(
    itemId: string,
    patch: Partial<RequisitionLineDraft>,
  ) {
    const item = requisitionSourceItemById.get(itemId);

    if (!item) {
      return;
    }

    setRequisitionLines((current) => ({
      ...current,
      [itemId]: {
        ...(current[itemId] ?? createRequisitionLineDraft(item)),
        ...patch,
        itemId,
      },
    }));
  }

  function addManualRequisitionLine() {
    const item = createManualRequisitionItem(manualRequisitionDraft);

    if (!item) {
      setReorderWarning(
        "Type an item name, description, or part number before adding a manual requisition line.",
      );
      return;
    }

    setManualRequisitionItems((current) => [item, ...current]);
    setSelectedReorderItemIds((current) =>
      current.includes(item.id) ? current : [item.id, ...current],
    );
    setRequisitionLines((current) => ({
      ...current,
      [item.id]: createRequisitionLineDraft(item),
    }));
    setManualRequisitionDraft(blankManualRequisitionDraft());
    setIsManualRequisitionOpen(false);
    setReorderWarning("");
  }

  function removeManualRequisitionLine(itemId: string) {
    setManualRequisitionItems((current) =>
      current.filter((item) => item.id !== itemId),
    );
    setSelectedReorderItemIds((current) =>
      current.filter((selectedId) => selectedId !== itemId),
    );
    setRequisitionLines((current) => {
      if (!current[itemId]) {
        return current;
      }

      const next = { ...current };
      delete next[itemId];
      return next;
    });
  }

  function updateRequisitionHeader(
    vendorKey: string,
    updater: SetStateAction<RequisitionHeaderDraft>,
  ) {
    const group = vendorGroups.find(
      (candidate) => candidate.vendorKey === vendorKey,
    );

    if (!group) {
      return;
    }

    setRequisitionHeaders((current) => {
      const currentHeader =
        current[vendorKey] ?? createDefaultRequisitionHeaderForGroup(group);
      const nextHeader =
        typeof updater === "function" ? updater(currentHeader) : updater;

      return {
        ...current,
        [vendorKey]: nextHeader,
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
    if (!hasPermission(readAuthRecord()?.role, "requisitions:create")) {
      setReorderWarning(PERMISSION_DENIED_MESSAGE);
      setPendingReviewVendorKey(null);
      setPendingReviewPdfGeneratedAt("");
      return;
    }

    const group = vendorGroups.find(
      (candidate) => candidate.vendorKey === vendorKey,
    );
    const header = group
      ? (requisitionHeaders[vendorKey] ??
        createDefaultRequisitionHeaderForGroup(group))
      : null;

    if (!group || !header) {
      setPendingReviewVendorKey(null);
      setPendingReviewPdfGeneratedAt("");
      return;
    }

    const record = createRequisitionMadeRecord({
      group,
      header,
      lineDrafts: requisitionLines,
      pdfGeneratedAt:
        pendingReviewVendorKey === vendorKey
          ? pendingReviewPdfGeneratedAt
          : undefined,
    });
    const passedItemIds = new Set(record.itemIds);
    const currentIndex = vendorGroups.findIndex(
      (candidate) => candidate.vendorKey === vendorKey,
    );
    const hasNextVendor =
      currentIndex >= 0 && currentIndex < vendorGroups.length - 1;

    void saveRequisitionToSqlite(record).catch((error) => {
      if (import.meta.env.DEV) {
        console.warn(
          "[sqlite-requisition-mirror] Requisition SQLite save failed. JSON fallback remains available.",
          error,
        );
      }
    });

    onDataChange((current) => {
      const updatedAt = nowIso();

      return {
        ...current,
        items: current.items.map((item) =>
          passedItemIds.has(item.id)
            ? {
                ...item,
                orderPlaced: true,
                orderRequisitionId: record.id,
                updatedAt,
              }
            : item,
        ),
        requisitionMadeRecords: [record, ...current.requisitionMadeRecords],
      };
    });

    setCompletedRequisitionVendorKeys((current) =>
      current.includes(group.vendorKey)
        ? current
        : [...current, group.vendorKey],
    );
    setPendingReviewVendorKey(null);
    setPendingReviewPdfGeneratedAt("");
    setSelectedReorderItemIds((current) =>
      current.filter((itemId) => !passedItemIds.has(itemId)),
    );
    setManualRequisitionItems((current) =>
      current.filter((item) => !passedItemIds.has(item.id)),
    );

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
          <button
            className={`reorder-tab-button ${reorderView === "history" ? "reorder-tab-active" : ""}`}
            type="button"
            aria-pressed={reorderView === "history"}
            onClick={() => setReorderView("history")}
          >
            History
          </button>
        </div>
        {reorderView !== "made" && reorderView !== "history" && (
          <div className="reorder-selection-toolbar no-print">
            <span>{selectedReorderItemIds.length} selected</span>
            <button
              className="btn-small"
              type="button"
              onClick={selectAllReorderItems}
              disabled={requisitionSourceItems.length === 0}
            >
              Select All Reorder Items
            </button>
            <button
              className="btn-small"
              type="button"
              onClick={clearSelectedReorderItems}
              disabled={selectedReorderItemIds.length === 0}
            >
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
          <div className="requisition-auto-type-strip">
            Form type is selected automatically by vendor total.
          </div>
        )}
        {reorderWarning && <div className="warning-bar">{reorderWarning}</div>}
      </div>

      {reorderView === "items" && (
        <>
          {isManualRequisitionOpen ? (
            <div
              className="manual-requisition-panel no-print"
              id="manual-requisition-line-panel"
            >
              <span>Manual requisition line</span>
              <input
                className="input"
                placeholder="Item name / description"
                value={manualRequisitionDraft.description}
                onChange={(event) =>
                  setManualRequisitionDraft((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
              />
              <input
                className="input"
                placeholder="Part number"
                value={manualRequisitionDraft.partNumber}
                onChange={(event) =>
                  setManualRequisitionDraft((current) => ({
                    ...current,
                    partNumber: event.target.value,
                  }))
                }
              />
              <input
                className="input"
                placeholder="Vendor"
                value={manualRequisitionDraft.vendorName}
                onChange={(event) =>
                  setManualRequisitionDraft((current) => ({
                    ...current,
                    vendorName: event.target.value,
                  }))
                }
              />
              <input
                className="input"
                inputMode="numeric"
                placeholder="Qty"
                value={manualRequisitionDraft.quantity}
                onChange={(event) =>
                  setManualRequisitionDraft((current) => ({
                    ...current,
                    quantity: normalizeWholeNumberInput(event.target.value),
                  }))
                }
              />
              <input
                className="input"
                inputMode="decimal"
                placeholder="Cost"
                value={manualRequisitionDraft.costEach}
                onChange={(event) =>
                  setManualRequisitionDraft((current) => ({
                    ...current,
                    costEach: event.target.value,
                  }))
                }
              />
              <input
                className="input manual-requisition-notes"
                placeholder="Notes"
                value={manualRequisitionDraft.notes}
                onChange={(event) =>
                  setManualRequisitionDraft((current) => ({
                    ...current,
                    notes: event.target.value,
                  }))
                }
              />
              <div className="manual-requisition-actions">
                <button
                  className="btn-small"
                  type="button"
                  onClick={addManualRequisitionLine}
                >
                  Add Manual Line
                </button>
                <button
                  className="btn-small btn-muted"
                  type="button"
                  onClick={() => setIsManualRequisitionOpen(false)}
                >
                  Collapse
                </button>
              </div>
            </div>
          ) : (
            <div className="manual-requisition-toggle-row no-print">
              <button
                className="btn-small manual-requisition-toggle"
                type="button"
                aria-controls="manual-requisition-line-panel"
                aria-expanded={false}
                onClick={() => setIsManualRequisitionOpen(true)}
              >
                + Add Manual Requisition Line
              </button>
            </div>
          )}
          <div className="requisition-inventory-picker no-print">
            <label className="entity-search-field requisition-inventory-search-field">
              <span>Search inventory for requisition</span>
              <input
                className="input"
                placeholder="Search part, item, description, vendor, or location"
                value={requisitionInventorySearch}
                onChange={(event) =>
                  setRequisitionInventorySearch(event.target.value)
                }
              />
            </label>
            {requisitionInventorySearch.trim() && (
              <div className="requisition-picker-results">
                {inventoryPickerResults.length === 0 && (
                  <span>No matching inventory items.</span>
                )}
                {inventoryPickerResults.map((item) => (
                  <div key={item.id} className="requisition-picker-row">
                    <div>
                      <strong>{item.partNumber || item.name}</strong>
                      <span>
                        {item.name} / {getVendorName(data, item.vendorId)} /{" "}
                        {getLocationName(data, item.locationId)}
                      </span>
                    </div>
                    <button
                      className="btn-small"
                      type="button"
                      onClick={() => toggleReorderItemSelection(item.id)}
                    >
                      Add
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <SimpleTable
            emptyText="No low/out of stock items. Add a manual requisition line if needed."
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
              "Actions",
            ]}
            rowKeys={requisitionSourceItems.map((item) => item.id)}
            rows={requisitionSourceItems.map((item) => {
              const isManual = isManualRequisitionItem(item);
              const hasRequisitionMade =
                !isManual && activeRequisitionMadeItemIds.has(item.id);

              return [
                <label
                  key="select"
                  className="reorder-select-cell"
                  title={
                    hasRequisitionMade
                      ? "This item already has a requisition made."
                      : undefined
                  }
                  onClick={(event) => {
                    if (hasRequisitionMade) {
                      event.preventDefault();
                      setReorderWarning(
                        "This item already has a requisition made.",
                      );
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
                isManual ? (
                  <span
                    key="manual"
                    className="requisition-made-badge requisition-manual-badge"
                  >
                    Manual
                  </span>
                ) : (
                  <StatusWithWatchVisibility
                    key="status"
                    item={item}
                    settings={data.settings}
                    onWatchListVisibilityClick={onWatchListVisibilityClick}
                  />
                ),
                hasRequisitionMade ? (
                  <span
                    key="made"
                    className="requisition-made-badge requisition-made-badge-green"
                  >
                    Requisition Made
                  </span>
                ) : (
                  "-"
                ),
                item.name,
                item.partNumber || "-",
                isManual ? "-" : formatStockQuantity(item),
                isManual ? "-" : formatNumber(item.minimumStockLevel),
                isManual ? "-" : getLocationName(data, item.locationId),
                getRequisitionItemVendorName(data, item),
                formatCurrency(item.costEach),
                isManual ? (
                  <button
                    key="remove"
                    className="btn-small"
                    type="button"
                    onClick={() => removeManualRequisitionLine(item.id)}
                  >
                    Remove
                  </button>
                ) : (
                  <button
                    key="stock"
                    className="btn-small"
                    type="button"
                    onClick={() => onStockAction(item.id)}
                  >
                    Stock Edit
                  </button>
                ),
              ];
            })}
          />
        </>
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
            "Actions",
          ]}
          rowKeys={madeRows.map(
            ({ record, snapshot }) => `${record.id}-${snapshot.itemId}`,
          )}
          rows={madeRows.map(({ record, snapshot }) => [
            <span
              key="status"
              className="requisition-made-badge requisition-made-badge-green"
            >
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
            <div key="actions" className="requisition-made-actions">
              <button
                className="btn-small"
                type="button"
                onClick={() => setSelectedMadeRecord(record)}
              >
                View
              </button>
              <button
                className="btn-small"
                type="button"
                onClick={() => onStockAction(snapshot.itemId)}
              >
                Stock Edit
              </button>
            </div>,
          ])}
        />
      )}

      {reorderView === "history" && (
        <div className="requisition-history-section">
          <div className="requisition-history-year-row">
            <button
              className={`btn-small ${historyFilters.year === "All" ? "reorder-tab-active" : ""}`}
              type="button"
              onClick={() =>
                setHistoryFilters((current) => ({ ...current, year: "All" }))
              }
            >
              All Years
            </button>
            {historyYears.map((year) => (
              <button
                key={year}
                className={`btn-small ${historyFilters.year === year ? "reorder-tab-active" : ""}`}
                type="button"
                onClick={() =>
                  setHistoryFilters((current) => ({ ...current, year }))
                }
              >
                {year}
              </button>
            ))}
          </div>
          <div className="requisition-history-filters">
            <label className="field-label">
              From
              <input
                className="input"
                type="date"
                value={historyFilters.dateFrom}
                onChange={(event) =>
                  setHistoryFilters((current) => ({
                    ...current,
                    dateFrom: event.target.value,
                  }))
                }
              />
            </label>
            <label className="field-label">
              To
              <input
                className="input"
                type="date"
                value={historyFilters.dateTo}
                onChange={(event) =>
                  setHistoryFilters((current) => ({
                    ...current,
                    dateTo: event.target.value,
                  }))
                }
              />
            </label>
            <label className="field-label">
              Vendor
              <input
                className="input"
                value={historyFilters.vendor}
                onChange={(event) =>
                  setHistoryFilters((current) => ({
                    ...current,
                    vendor: event.target.value,
                  }))
                }
              />
            </label>
            <label className="field-label">
              PO Number
              <input
                className="input"
                value={historyFilters.poNo}
                onChange={(event) =>
                  setHistoryFilters((current) => ({
                    ...current,
                    poNo: event.target.value,
                  }))
                }
              />
            </label>
            <label className="field-label">
              Part Number
              <input
                className="input"
                value={historyFilters.partNumber}
                onChange={(event) =>
                  setHistoryFilters((current) => ({
                    ...current,
                    partNumber: event.target.value,
                  }))
                }
              />
            </label>
            <label className="field-label">
              Item Name
              <input
                className="input"
                value={historyFilters.itemName}
                onChange={(event) =>
                  setHistoryFilters((current) => ({
                    ...current,
                    itemName: event.target.value,
                  }))
                }
              />
            </label>
            <button
              className="btn-small"
              type="button"
              onClick={handlePrintReorderHistory}
            >
              Print Reorder History
            </button>
            {historyPrintStatus && (
              <span
                className={`requisition-status-message requisition-status-${historyPrintStatusType}`}
              >
                {historyPrintStatus}
              </span>
            )}
            <button
              className="btn-small"
              type="button"
              onClick={() =>
                setHistoryFilters(blankRequisitionHistoryFilters())
              }
            >
              Clear History Filters
            </button>
          </div>
          <InventoryPagination
            currentPage={safeRequisitionHistoryPage}
            onNextPage={() =>
              setRequisitionHistoryPage((current) =>
                Math.min(totalRequisitionHistoryPages, current + 1),
              )
            }
            onPageSizeChange={handleRequisitionHistoryPageSizeChange}
            onPreviousPage={() =>
              setRequisitionHistoryPage((current) => Math.max(1, current - 1))
            }
            pageEnd={requisitionHistoryPageEndNumber}
            pageSize={requisitionHistoryPageSize}
            pageSizeOptions={REQUISITION_HISTORY_PAGE_SIZE_OPTIONS}
            pageStart={requisitionHistoryPageStartNumber}
            totalItems={totalRequisitionHistoryItems}
            totalPages={totalRequisitionHistoryPages}
          />
          <SimpleTable
            emptyText="No requisition history matches those filters."
            headers={[
              "Created",
              "Year",
              "Vendor",
              "PO",
              "Item / Part Number",
              "Qty",
              "Unit Cost",
              "Created By",
              "Actions",
            ]}
            rowKeys={paginatedHistoryRows.map(
              ({ record, snapshot }) => `${record.id}-${snapshot.itemId}`,
            )}
            rows={paginatedHistoryRows.map(({ record, snapshot }) => [
              formatDateTime(getRequisitionRecordDate(record)),
              getRequisitionRecordYear(record) || "-",
              record.vendorName,
              record.poNo || "-",
              <span key="item" className="requisition-made-item">
                <strong>{snapshot.itemName}</strong>
                <span>{snapshot.partNumber || "-"}</span>
              </span>,
              formatNumber(snapshot.quantityRequested),
              formatCurrency(snapshot.unitCost),
              record.createdBy || record.requisitionedBy || "-",
              <button
                key="view"
                className="btn-small"
                type="button"
                onClick={() => setSelectedMadeRecord(record)}
              >
                View
              </button>,
            ])}
          />
        </div>
      )}

      {reorderView === "forms" && (
        <div className="requisition-builder">
          {selectedItems.length === 0 ? (
            <div className="warning-bar">
              Select reorder items or add a manual line first, then create
              requisition forms.
            </div>
          ) : activeVendorGroup && activeRequisitionHeader ? (
            <>
              <div className="requisition-workflow-toolbar no-requisition-print">
                <div className="requisition-workflow-info">
                  <span>
                    Form {activeRequisitionGroupIndex + 1} of{" "}
                    {vendorGroups.length}
                  </span>
                  <strong>{activeVendorGroup.vendorName}</strong>
                  {allSelectedVendorFormsReviewed && (
                    <em>All selected vendor forms reviewed.</em>
                  )}
                </div>
                <div className="requisition-workflow-actions">
                  <button
                    className="btn-muted"
                    type="button"
                    onClick={() =>
                      setActiveRequisitionGroupIndex((current) =>
                        Math.max(0, current - 1),
                      )
                    }
                    disabled={activeRequisitionGroupIndex === 0}
                  >
                    Previous Vendor
                  </button>
                  <button
                    className="btn-muted"
                    type="button"
                    onClick={() =>
                      setActiveRequisitionGroupIndex((current) =>
                        Math.min(vendorGroups.length - 1, current + 1),
                      )
                    }
                    disabled={
                      activeRequisitionGroupIndex >= vendorGroups.length - 1
                    }
                  >
                    Next Vendor
                  </button>
                  <button
                    className="btn-muted"
                    type="button"
                    onClick={() =>
                      setActiveRequisitionGroupIndex((current) =>
                        Math.min(vendorGroups.length - 1, current + 1),
                      )
                    }
                    disabled={
                      activeRequisitionGroupIndex >= vendorGroups.length - 1
                    }
                  >
                    Next Vendor
                  </button>
                  <button
                    className="btn-muted"
                    type="button"
                    onClick={skipActiveVendor}
                  >
                    Skip Vendor
                  </button>
                  {activeVendorGroupCompleted && (
                    <span className="requisition-done-badge">
                      Reviewed / Done
                    </span>
                  )}
                </div>
              </div>
              <RequisitionFormPreview
                key={activeVendorGroup.vendorKey}
                group={activeVendorGroup}
                header={activeRequisitionHeader}
                isCompleted={activeVendorGroupCompleted}
                lineDrafts={requisitionLines}
                onHeaderChange={(updater) =>
                  updateRequisitionHeader(activeVendorGroup.vendorKey, updater)
                }
                onOfficialPdfGenerated={() => {
                  setPendingReviewPdfGeneratedAt(nowIso());
                  setPendingReviewVendorKey(activeVendorGroup.vendorKey);
                }}
                onLineChange={updateRequisitionLine}
              />
            </>
          ) : (
            <div className="warning-bar">
              Select reorder items or add a manual line first, then create
              requisition forms.
            </div>
          )}
        </div>
      )}

      {pendingReviewVendorKey && (
        <div className="review-modal-backdrop">
          <section
            className="review-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-official-pdf-title"
          >
            <div>
              <p className="eyebrow">Official requisition</p>
              <h3 id="review-official-pdf-title">Review Official PDF</h3>
            </div>
            <p>
              Open the generated PDF and review it. If it looks good, click
              Pass. If it needs changes, click Needs Fix and edit the form.
            </p>
            {pendingReviewVendorGroup && (
              <div className="review-modal-summary">
                <span>{pendingReviewVendorGroup.vendorName}</span>
                <strong>
                  {pendingReviewVendorGroup.items.length} line item
                  {pendingReviewVendorGroup.items.length === 1 ? "" : "s"}
                </strong>
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
      {selectedMadeRecord && (
        <RequisitionMadeDetailDialog
          record={selectedMadeRecord}
          onClose={() => setSelectedMadeRecord(null)}
        />
      )}
    </section>
  );
}

function getRecommendedReorderQuantity(item: InventoryItem) {
  return Math.max(1, item.minimumStockLevel - item.quantityOnHand);
}

function blankManualRequisitionDraft(): ManualRequisitionDraft {
  return {
    costEach: "",
    description: "",
    notes: "",
    partNumber: "",
    quantity: "1",
    vendorName: "",
  };
}

function blankRequisitionHistoryFilters(): RequisitionHistoryFilters {
  return {
    dateFrom: "",
    dateTo: "",
    itemName: "",
    partNumber: "",
    poNo: "",
    vendor: "",
    year: "All",
  };
}

function getRequisitionRecordDate(record: RequisitionMadeRecord) {
  return record.createdAt || record.passedAt || record.pdfGeneratedAt;
}

function getRequisitionRecordYear(record: RequisitionMadeRecord) {
  const date = new Date(getRequisitionRecordDate(record));
  return Number.isNaN(date.getTime()) ? "" : String(date.getFullYear());
}

function getRequisitionHistoryYears(records: RequisitionMadeRecord[]) {
  return Array.from(
    new Set(records.map(getRequisitionRecordYear).filter(Boolean)),
  ).sort((a, b) => Number(b) - Number(a));
}

function getDateInputTime(value: string, endOfDay = false) {
  if (!value) {
    return null;
  }

  const date = new Date(
    `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`,
  );
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function getFilteredRequisitionHistoryRows(
  records: RequisitionMadeRecord[],
  filters: RequisitionHistoryFilters,
) {
  const vendorFilter = filters.vendor.trim().toLowerCase();
  const poFilter = filters.poNo.trim().toLowerCase();
  const partFilter = filters.partNumber.trim().toLowerCase();
  const itemFilter = filters.itemName.trim().toLowerCase();
  const fromTime = getDateInputTime(filters.dateFrom);
  const toTime = getDateInputTime(filters.dateTo, true);

  return records
    .flatMap((record) => {
      const recordTime = new Date(getRequisitionRecordDate(record)).getTime();

      if (
        filters.year !== "All" &&
        getRequisitionRecordYear(record) !== filters.year
      ) {
        return [];
      }

      if (
        fromTime !== null &&
        Number.isFinite(recordTime) &&
        recordTime < fromTime
      ) {
        return [];
      }

      if (
        toTime !== null &&
        Number.isFinite(recordTime) &&
        recordTime > toTime
      ) {
        return [];
      }

      if (
        vendorFilter &&
        !record.vendorName.toLowerCase().includes(vendorFilter)
      ) {
        return [];
      }

      if (poFilter && !(record.poNo ?? "").toLowerCase().includes(poFilter)) {
        return [];
      }

      return record.itemSnapshots
        .filter((snapshot) => {
          if (
            partFilter &&
            !snapshot.partNumber.toLowerCase().includes(partFilter)
          ) {
            return false;
          }

          if (
            itemFilter &&
            !snapshot.itemName.toLowerCase().includes(itemFilter)
          ) {
            return false;
          }

          return true;
        })
        .map((snapshot) => ({ record, snapshot }));
    })
    .sort((a, b) =>
      getRequisitionRecordDate(b.record).localeCompare(
        getRequisitionRecordDate(a.record),
      ),
    );
}

function getRequisitionInventoryPickerResults(
  data: AppData,
  searchValue: string,
  selectedItemIds: Set<string>,
) {
  const search = searchValue.trim().toLowerCase();

  if (!search) {
    return [];
  }

  return data.items
    .filter((item) => {
      if (selectedItemIds.has(item.id)) {
        return false;
      }

      const vendorName = getVendorName(data, item.vendorId);
      const locationName = getLocationName(data, item.locationId);

      return [
        item.partNumber,
        item.name,
        item.description,
        vendorName,
        locationName,
      ]
        .join(" ")
        .toLowerCase()
        .includes(search);
    })
    .slice(0, 8);
}

function isManualRequisitionItem(item: Pick<InventoryItem, "id">) {
  return item.id.startsWith(MANUAL_REQUISITION_ITEM_PREFIX);
}

function getManualRequisitionVendorName(item: Pick<InventoryItem, "vendorId">) {
  return item.vendorId.startsWith(MANUAL_REQUISITION_VENDOR_PREFIX)
    ? item.vendorId.slice(MANUAL_REQUISITION_VENDOR_PREFIX.length).trim()
    : "";
}

function getRequisitionItemVendorName(data: AppData, item: InventoryItem) {
  return (
    getManualRequisitionVendorName(item) ||
    (item.vendorId ? getVendorName(data, item.vendorId) : "Unassigned Vendor")
  );
}

function getRequisitionLineDescription(item: InventoryItem) {
  const description = item.description || item.name;
  const notes = isManualRequisitionItem(item) ? item.notes.trim() : "";

  return notes ? `${description} - Notes: ${notes}` : description;
}

function createManualRequisitionItem(
  draft: ManualRequisitionDraft,
): InventoryItem | null {
  const description = draft.description.trim();
  const partNumber = draft.partNumber.trim();

  if (!description && !partNumber) {
    return null;
  }

  const quantity = Math.max(1, wholeNumberValue(draft.quantity, 1));
  const vendorName = draft.vendorName.trim();
  const now = nowIso();

  return {
    id: `${MANUAL_REQUISITION_ITEM_PREFIX}${createId()}`,
    name: description || partNumber,
    partNumber,
    description: description || partNumber,
    category: "Manual",
    quantityOnHand: 0,
    stockUnit: DEFAULT_STOCK_UNIT,
    minimumStockLevel: quantity,
    lowStockAlertLevel: 0,
    locationId: "",
    vendorId: vendorName
      ? `${MANUAL_REQUISITION_VENDOR_PREFIX}${vendorName}`
      : "",
    costEach: Math.max(0, numberValue(draft.costEach)),
    itemUrl: "",
    notes: draft.notes.trim(),
    imagePlaceholder: "",
    imageDataUrl: "",
    barcodePlaceholder: "",
    reorderHold: false,
    orderPlaced: false,
    orderRequisitionId: "",
    createdAt: now,
    updatedAt: now,
  };
}

function createRequisitionLineDraft(item: InventoryItem): RequisitionLineDraft {
  return {
    dueDate: toDateInput(),
    itemId: item.id,
    quantity: String(getRecommendedReorderQuantity(item)),
  };
}

function groupItemsByVendor(
  data: AppData,
  selectedItems: InventoryItem[],
): RequisitionVendorGroup[] {
  const groups = new Map<string, InventoryItem[]>();

  selectedItems.forEach((item) => {
    const vendorName = getRequisitionItemVendorName(data, item);
    const key = item.vendorId || `unassigned-${vendorName}`;

    groups.set(key, [...(groups.get(key) ?? []), item]);
  });

  return Array.from(groups.entries()).map(([vendorKey, groupItems]) => {
    const vendorId = groupItems[0]?.vendorId || "";
    const vendor = vendorId.startsWith(MANUAL_REQUISITION_VENDOR_PREFIX)
      ? undefined
      : data.vendors.find((candidate) => candidate.id === vendorId);
    const manualVendorName = groupItems[0]
      ? getManualRequisitionVendorName(groupItems[0])
      : "";

    return {
      vendorKey,
      vendor,
      vendorName: vendor?.name || manualVendorName || "Unassigned Vendor",
      items: groupItems,
    };
  });
}

function getVendorRequisitionDetails(vendor?: VendorRecord) {
  if (!vendor) {
    return "";
  }

  return vendor.phone ? `Phone: ${vendor.phone}` : "";
}

function createDefaultRequisitionHeader(
  vendor?: VendorRecord,
): RequisitionHeaderDraft {
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
    workOrderNo: "",
  };
}

function createDefaultRequisitionHeaderForGroup(
  group: RequisitionVendorGroup,
): RequisitionHeaderDraft {
  const header = createDefaultRequisitionHeader(group.vendor);

  if (header.vendorName || group.vendorName === "Unassigned Vendor") {
    return header;
  }

  return {
    ...header,
    vendorName: group.vendorName,
  };
}

function getRequisitionLineQuantity(
  item: InventoryItem,
  lineDrafts: Record<string, RequisitionLineDraft>,
) {
  const value = lineDrafts[item.id]?.quantity;

  if (value === undefined || value.trim() === "") {
    return getRecommendedReorderQuantity(item);
  }

  const parsed = wholeNumberValue(value, Number.NaN);

  return Number.isFinite(parsed)
    ? Math.max(0, parsed)
    : getRecommendedReorderQuantity(item);
}

function getRequisitionTotal(
  items: InventoryItem[],
  lineDrafts: Record<string, RequisitionLineDraft>,
) {
  return items.reduce(
    (total, item) =>
      total + getRequisitionLineQuantity(item, lineDrafts) * item.costEach,
    0,
  );
}

function getAutoRequisitionType(total: number): "under100" | "over100" {
  return total <= 100 ? "under100" : "over100";
}

function getActiveRequisitionMadeItemIds(data: AppData) {
  return new Set(
    getActiveRequisitionMadeRecords(data).flatMap((record) => record.itemIds),
  );
}

function createRequisitionMadeRecord({
  group,
  header,
  lineDrafts,
  pdfGeneratedAt,
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
      totalCost: quantityRequested * unitCost,
    };
  });
  const totalCost = itemSnapshots.reduce(
    (sum, snapshot) => sum + snapshot.totalCost,
    0,
  );
  const passedAt = nowIso();

  return {
    id: createId(),
    vendorKey: group.vendorKey,
    vendorName: header.vendorName || group.vendorName,
    createdAt: passedAt,
    createdBy: header.requisitionedBy || header.poInitiator || "User",
    itemIds: itemSnapshots.map((snapshot) => snapshot.itemId),
    itemSnapshots,
    poNo: header.poNo,
    totalCost,
    requisitionType: getAutoRequisitionType(totalCost),
    pdfGeneratedAt: pdfGeneratedAt || passedAt,
    passedAt,
    requisitionedBy: header.requisitionedBy,
    status: "Made",
  };
}

function getRequisitionTitleFromTotal(total: number) {
  return getAutoRequisitionType(total) === "under100"
    ? "PURCHASE ORDER REQUISITION Under $100.00"
    : "PURCHASE ORDER REQUISITION";
}

function formatDateInputForDisplay(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value || "-"
    : date.toLocaleDateString();
}

function buildRequisitionFormText({
  group,
  header,
  lineDrafts,
}: {
  group: RequisitionVendorGroup;
  header: RequisitionHeaderDraft;
  lineDrafts: Record<string, RequisitionLineDraft>;
}) {
  const title = getRequisitionTitleFromTotal(
    getRequisitionTotal(group.items, lineDrafts),
  );
  const lines = group.items.map((item, index) => {
    const quantity = getRequisitionLineQuantity(item, lineDrafts);
    const itemNumber = item.partNumber || item.name;
    const description = getRequisitionLineDescription(item);
    const total = quantity * item.costEach;

    return `${index + 1}. ${quantity} ${normalizeStockUnit(item.stockUnit)} ${itemNumber} - ${description} - ${formatCurrency(
      item.costEach,
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
    `Grand Total: ${formatCurrency(getRequisitionTotal(group.items, lineDrafts))}`,
  ].join("\n");
}

function getPrintableRequisitionTitle(
  requisitionType: RequisitionMadeRecord["requisitionType"],
) {
  return `PURCHASE ORDER REQUISITION ${requisitionType === "under100" ? "Under" : "Over"} $100.00`;
}

function printableValue(value: unknown) {
  const text = String(value ?? "").trim();
  return text.length > 0 ? escapeReportHtml(text) : "&nbsp;";
}

function buildPrintableField(label: string, value: unknown, className = "") {
  return `<div class="po-field ${className}"><span>${escapeReportHtml(label)}</span><strong>${printableValue(
    value,
  )}</strong></div>`;
}

function printableDateInputValue(value: string) {
  const text = value.trim();

  if (!text) {
    return "&nbsp;";
  }

  const date = new Date(`${text}T00:00:00`);

  return printableValue(
    Number.isNaN(date.getTime()) ? text : date.toLocaleDateString(),
  );
}

const requisitionPrintCss = `
  @page { size: letter; margin: 0.35in; }

  body {
    background: #ffffff;
    color: #111827;
  }

  .po-requisition {
    color: #111827;
    font-size: 10px;
    line-height: 1.35;
    padding: 0;
  }

  .po-header {
    align-items: stretch;
    border: 2px solid #111827;
    display: grid;
    gap: 12px;
    grid-template-columns: 1.75in minmax(0, 1fr);
    margin-bottom: 0.12in;
    min-height: 0.62in;
  }

  .po-logo-box {
    align-items: center;
    display: flex;
    justify-content: flex-start;
    padding: 0.08in 0.12in;
  }

  .po-logo-box img,
  .po-template-logo {
    display: block;
    max-height: 0.42in;
    max-width: 1.6in;
    object-fit: contain;
  }

  .po-header-main {
    align-items: center;
    border-left: 2px solid #111827;
    display: flex;
    padding: 0.12in 0.14in;
    text-align: left;
  }

  .po-header h1 {
    font-size: 18px;
    letter-spacing: 0;
    margin: 0;
  }

  .po-field-grid {
    display: grid;
    gap: 0.06in;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    margin-bottom: 0.1in;
  }

  .po-field-grid-three {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .po-field {
    border: 1px solid #94a3b8;
    min-height: 0.34in;
    padding: 0.05in 0.06in;
  }

  .po-field-wide {
    grid-column: span 2;
  }

  .po-field-full {
    grid-column: 1 / -1;
  }

  .po-field span,
  .po-section-title {
    color: #475569;
    display: block;
    font-size: 8px;
    font-weight: 900;
    text-transform: uppercase;
  }

  .po-field strong {
    color: #111827;
    display: block;
    font-size: 10px;
    font-weight: 800;
    margin-top: 2px;
    min-height: 16px;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .po-section {
    margin-bottom: 0.1in;
  }

  .po-section-title {
    border-bottom: 2px solid #111827;
    margin: 0 0 0.05in;
    padding-bottom: 0.03in;
  }

  .po-lines {
    margin-bottom: 0.1in;
  }

  .po-lines th {
    background: #111827;
    color: #ffffff;
    font-size: 7.5px;
    padding: 5px;
  }

  .po-lines td {
    background: #ffffff;
    color: #111827;
    font-size: 8.5px;
    padding: 5px;
  }

  .po-lines th,
  .po-lines td {
    border: 1px solid #111827;
  }

  .po-lines .po-qty { width: 0.55in; }
  .po-lines .po-uom { width: 0.7in; }
  .po-lines .po-item { width: 1.05in; }
  .po-lines .po-date { width: 0.78in; }
  .po-lines .po-money { width: 0.75in; }

  .po-total-row {
    align-items: center;
    border: 2px solid #111827;
    display: flex;
    justify-content: flex-end;
    gap: 0.15in;
    margin-top: 0.05in;
    padding: 0.08in;
  }

  .po-total-row span {
    color: #475569;
    font-size: 8px;
    font-weight: 900;
    text-transform: uppercase;
  }

  .po-total-row strong {
    color: #111827;
    font-size: 15px;
    font-weight: 900;
  }

  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .po-requisition { padding: 0; }
    .po-field-grid { break-inside: avoid; }
    .po-section { break-inside: avoid; }
    .po-lines thead { display: table-header-group; }
    .po-lines tr { break-inside: avoid; }
  }
`;

function buildPrintableRequisitionDocument({
  group,
  header,
  lineDrafts,
  requisitionType,
}: {
  group: RequisitionVendorGroup;
  header: RequisitionHeaderDraft;
  lineDrafts: Record<string, RequisitionLineDraft>;
  requisitionType: RequisitionMadeRecord["requisitionType"];
}) {
  const printableTitle = getPrintableRequisitionTitle(requisitionType);
  const total = getRequisitionTotal(group.items, lineDrafts);
  const vendorName = header.vendorName || group.vendorName;
  const lineRows = group.items
    .map((item) => {
      const draft = lineDrafts[item.id] ?? createRequisitionLineDraft(item);
      const quantity = getRequisitionLineQuantity(item, lineDrafts);
      const unitPrice = Number.isFinite(item.costEach) ? item.costEach : 0;

      return `<tr>
        <td class="text-right">${printableValue(formatNumber(quantity))}</td>
        <td>${printableValue(normalizeStockUnit(item.stockUnit))}</td>
        <td>${printableValue(item.partNumber || item.name)}</td>
        <td>${printableValue(getRequisitionLineDescription(item))}</td>
        <td>${printableDateInputValue(draft.dueDate)}</td>
        <td class="text-right">${printableValue(formatCurrency(unitPrice))}</td>
        <td class="text-right">${printableValue(formatCurrency(quantity * unitPrice))}</td>
      </tr>`;
    })
    .join("");

  return `<main class="report po-requisition">
    <header class="po-header">
      <div class="po-logo-box">
        <img class="po-template-logo" src="${escapeReportHtml(jbtUsaRequisitionLogo)}" alt="JBT USA Maintenance" />
      </div>
      <div class="po-header-main">
        <h1>${escapeReportHtml(printableTitle)}</h1>
      </div>
    </header>

    <section class="po-section">
      <div class="po-field-grid">
        ${buildPrintableField("Vendor Name", vendorName, "po-field-wide")}
        ${buildPrintableField("P.O. No.", header.poNo)}
        ${buildPrintableField("P.O. Initiator", header.poInitiator)}
        ${buildPrintableField("Ship Via", header.shipVia)}
        ${buildPrintableField("P.O. Class", header.poClass)}
        ${buildPrintableField("Tax Exempt", header.taxExempt)}
        ${buildPrintableField("F.O.B.", header.fob)}
        ${buildPrintableField("Req. Date", header.reqDate.trim() ? formatDateInputForDisplay(header.reqDate) : "")}
        ${buildPrintableField("Material Cert", header.materialCert)}
      </div>
    </section>

    <section class="po-section">
      <p class="po-section-title">Tooling Orders Only</p>
      <div class="po-field-grid">
        ${buildPrintableField("Asset No.", header.assetNo)}
        ${buildPrintableField("Mold No.", header.moldNo)}
        ${buildPrintableField("Equipment No.", header.equipmentNo)}
        ${buildPrintableField("Part No.", header.partNo)}
        ${buildPrintableField("Job No.", header.jobNo)}
        ${buildPrintableField("Initials", header.initials)}
        ${buildPrintableField("T/S No.", header.tsNo)}
        ${buildPrintableField("Code No.", header.codeNo)}
        ${buildPrintableField("Work Order No.", header.workOrderNo, "po-field-wide")}
      </div>
    </section>

    <section class="po-section">
      <div class="po-field-grid po-field-grid-three">
        ${buildPrintableField("Vendor Address / Phone", header.vendorAddress, "po-field-wide")}
        ${buildPrintableField("Confirmed With", header.confirmedWith)}
      </div>
    </section>

    <section class="po-section">
      <p class="po-section-title">Line Items</p>
      <table class="po-lines">
        <thead>
          <tr>
            <th class="po-qty">Quantity</th>
            <th class="po-uom">Unit of Measure</th>
            <th class="po-item">Item Number</th>
            <th>Item Description / Revision</th>
            <th class="po-date">Due Date</th>
            <th class="po-money">Unit Price</th>
            <th class="po-money">Total Price</th>
          </tr>
        </thead>
        <tbody>${lineRows || `<tr><td colspan="7">No line items selected.</td></tr>`}</tbody>
      </table>
    </section>

    <section class="po-section">
      <div class="po-field-grid">
        ${buildPrintableField("Comments", header.comments, "po-field-full")}
        ${buildPrintableField("Priority", header.priority)}
        ${buildPrintableField("Authorized By", header.authorizedBy)}
        ${buildPrintableField("Department Manager", header.departmentManager)}
        ${buildPrintableField("Requisitioned By", header.requisitionedBy)}
      </div>
      <div class="po-total-row">
        <span>Grand Total</span>
        <strong>${escapeReportHtml(formatCurrency(total))}</strong>
      </div>
    </section>
  </main>`;
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
    /not found|requires|system cannot find|com class factory|activex component|new-object/i.test(
      message,
    )
  );
}

function RequisitionFormPreview({
  group,
  header,
  isCompleted,
  lineDrafts,
  onHeaderChange,
  onOfficialPdfGenerated,
  onLineChange,
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
  const [copyStatusType, setCopyStatusType] = useState<
    "idle" | "success" | "error" | "working"
  >("idle");
  const [isGeneratingOfficialPdf, setIsGeneratingOfficialPdf] = useState(false);
  const [pdfEngineStatus, setPdfEngineStatus] =
    useState<PdfEngineStatus | null>(null);
  const total = getRequisitionTotal(group.items, lineDrafts);
  const requisitionType = getAutoRequisitionType(total);
  const title = getRequisitionTitleFromTotal(total);
  const isWebsiteMode = isWebsiteBrowserMode();
  const autoStatus =
    requisitionType === "under100"
      ? "Auto selected: Under $100 form"
      : "Auto selected: Over $100 form";
  const showPdfSetupWarning =
    !isWebsiteMode &&
    pdfEngineStatus !== null &&
    !pdfEngineStatus.ready &&
    pdfEngineStatus.preferredEngine !== "Desktop app required";

  useEffect(() => {
    let cancelled = false;

    if (isWebsiteMode) {
      setPdfEngineStatus(null);
      return;
    }

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
  }, [isWebsiteMode]);

  function updateHeader<K extends keyof RequisitionHeaderDraft>(
    field: K,
    value: RequisitionHeaderDraft[K],
  ) {
    onHeaderChange((current) => ({ ...current, [field]: value }));
  }

  function updatePriority(priority: "Low" | "High") {
    onHeaderChange((current) => {
      const defaultComment = "Maintenance inventory restock.";
      const shouldAdjustComment =
        current.comments.trim() === defaultComment ||
        current.comments.trim() ===
          "High priority maintenance inventory restock." ||
        current.comments.trim() ===
          "Low priority maintenance inventory restock.";

      return {
        ...current,
        priority,
        comments: shouldAdjustComment
          ? priority === "High"
            ? "High priority maintenance inventory restock."
            : "Low priority maintenance inventory restock."
          : current.comments,
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
      try {
        await navigator.clipboard.writeText(text);
        setCopyStatus("Copied form text.");
        setCopyStatusType("success");
        clearStatusAfterDelay();
        return;
      } catch {
        // Some browser contexts expose clipboard but reject writes unless the page is focused.
      }
    }

    window.prompt("Copy requisition text", text);
    setCopyStatus("Copy form text opened.");
    setCopyStatusType("success");
    clearStatusAfterDelay();
  }

  async function handleGenerateOfficialPdf() {
    if (isGeneratingOfficialPdf) {
      return;
    }

    try {
      setIsGeneratingOfficialPdf(true);
      const engineStatus = await checkPdfExportEngines();
      setPdfEngineStatus(engineStatus);

      if (
        !engineStatus.ready &&
        engineStatus.preferredEngine !== "Desktop app required"
      ) {
        setCopyStatus(
          "PDF export setup needed. Install LibreOffice from Settings > PDF Export Setup.",
        );
        setCopyStatusType("error");
        return;
      }

      setCopyStatus(
        "Building official requisition PDF. Large requisitions may take a little longer...",
      );
      setCopyStatusType("working");

      const { generateOfficialPdfFromExcelTemplate } =
        await import("./lib/requisitionOfficialPdf");

      await generateOfficialPdfFromExcelTemplate({
        group,
        header,
        lineDrafts,
        requisitionType,
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

          if (
            !engineStatus.ready &&
            engineStatus.preferredEngine !== "Desktop app required"
          ) {
            setCopyStatus(
              "PDF export setup needed. Install LibreOffice from Settings > PDF Export Setup.",
            );
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

  async function handleBrowserPrintPdf() {
    const printTitle = "Maintenance Requisition";
    const printBody = buildPrintableRequisitionDocument({
      group,
      header,
      lineDrafts,
      requisitionType,
    });

    try {
      if (isWebsiteMode && isMobileViewport()) {
        await openStandalonePrintableReport(
          printTitle,
          printBody,
          requisitionPrintCss,
        );
        setCopyStatus(
          "Clean requisition print page opened. Use Share or Print from that tab.",
        );
      } else {
        await openPrintableReport(printTitle, printBody, requisitionPrintCss);
        setCopyStatus(
          "Browser print view opened. Choose Save as PDF in the print dialog.",
        );
      }

      setCopyStatusType("success");
      onOfficialPdfGenerated();
      clearStatusAfterDelay();
    } catch (error) {
      setCopyStatus(
        error instanceof Error
          ? error.message
          : "Could not open browser print view.",
      );
      setCopyStatusType("error");
    }
  }

  return (
    <section className="requisition-form-card requisition-print-card">
      <div className="requisition-form-header">
        <div>
          <p className="eyebrow">{group.vendorName}</p>
          <h3>{title}</h3>
          <span>
            {group.items.length} line item{group.items.length === 1 ? "" : "s"}
          </span>
          <span className="requisition-auto-type-badge">{autoStatus}</span>
          {isCompleted && (
            <span className="requisition-done-badge">Reviewed / Done</span>
          )}
        </div>
        <div className="requisition-total-bar requisition-valid">
          <span>Grand Total</span>
          <strong>{formatCurrency(total)}</strong>
        </div>
      </div>

      {showPdfSetupWarning && (
        <div className="warning-bar">
          Official PDF export needs Microsoft Excel or LibreOffice. Go to
          Settings &gt; PDF Export Setup.
        </div>
      )}

      <div className="requisition-form-grid">
        <label className="field-label">
          P.O. No.
          <input
            className="input"
            value={header.poNo}
            onChange={(event) => updateHeader("poNo", event.target.value)}
          />
        </label>
        <label className="field-label">
          P.O. Initiator
          <input
            className="input"
            value={header.poInitiator}
            onChange={(event) =>
              updateHeader("poInitiator", event.target.value)
            }
          />
        </label>
        <label className="field-label">
          Ship Via
          <input
            className="input"
            value={header.shipVia}
            onChange={(event) => updateHeader("shipVia", event.target.value)}
          />
        </label>
        <label className="field-label">
          P.O. Class
          <input
            className="input"
            value={header.poClass}
            onChange={(event) => updateHeader("poClass", event.target.value)}
          />
        </label>
        <label className="field-label">
          Tax Exempt?
          <select
            className="input"
            value={header.taxExempt}
            onChange={(event) =>
              updateHeader("taxExempt", event.target.value as "Yes" | "No")
            }
          >
            <option>Yes</option>
            <option>No</option>
          </select>
        </label>
        <label className="field-label">
          F.O.B.
          <select
            className="input"
            value={header.fob}
            onChange={(event) => updateHeader("fob", event.target.value)}
          >
            <option value="">Blank</option>
            <option value="Origin">Origin</option>
            <option value="Destination">Destination</option>
          </select>
        </label>
        <label className="field-label">
          Req. Date
          <input
            className="input"
            type="date"
            value={header.reqDate}
            onChange={(event) => updateHeader("reqDate", event.target.value)}
          />
        </label>
        <label className="field-label">
          Material Cert?
          <select
            className="input"
            value={header.materialCert}
            onChange={(event) =>
              updateHeader("materialCert", event.target.value as "Yes" | "No")
            }
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
            <input
              className="input"
              value={header.assetNo}
              onChange={(event) => updateHeader("assetNo", event.target.value)}
            />
          </label>
          <label className="field-label">
            Mold No.
            <input
              className="input"
              value={header.moldNo}
              onChange={(event) => updateHeader("moldNo", event.target.value)}
            />
          </label>
          <label className="field-label">
            Equipment No.
            <input
              className="input"
              value={header.equipmentNo}
              onChange={(event) =>
                updateHeader("equipmentNo", event.target.value)
              }
            />
          </label>
          <label className="field-label">
            Part No.
            <input
              className="input"
              value={header.partNo}
              onChange={(event) => updateHeader("partNo", event.target.value)}
            />
          </label>
          <label className="field-label">
            Job No.
            <input
              className="input"
              value={header.jobNo}
              onChange={(event) => updateHeader("jobNo", event.target.value)}
            />
          </label>
          <label className="field-label">
            Initials
            <input
              className="input"
              value={header.initials}
              onChange={(event) => updateHeader("initials", event.target.value)}
            />
          </label>
          <label className="field-label">
            T/S No.
            <input
              className="input"
              value={header.tsNo}
              onChange={(event) => updateHeader("tsNo", event.target.value)}
            />
          </label>
          <label className="field-label">
            Code No.
            <input
              className="input"
              value={header.codeNo}
              onChange={(event) => updateHeader("codeNo", event.target.value)}
            />
          </label>
          <label className="field-label">
            Work Order No.
            <input
              className="input"
              value={header.workOrderNo}
              onChange={(event) =>
                updateHeader("workOrderNo", event.target.value)
              }
            />
          </label>
        </div>
      </div>

      <div className="requisition-vendor-section">
        <label className="field-label">
          Vendor Name
          <input
            className="input"
            value={header.vendorName}
            onChange={(event) => updateHeader("vendorName", event.target.value)}
          />
        </label>
        <label className="field-label">
          Vendor Address / Phone
          <textarea
            className="input min-h-24"
            value={header.vendorAddress}
            onChange={(event) =>
              updateHeader("vendorAddress", event.target.value)
            }
          />
        </label>
        <label className="field-label">
          Confirmed With
          <input
            className="input"
            value={header.confirmedWith}
            onChange={(event) =>
              updateHeader("confirmedWith", event.target.value)
            }
          />
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
              const draft =
                lineDrafts[item.id] ?? createRequisitionLineDraft(item);
              const quantity = getRequisitionLineQuantity(item, lineDrafts);

              return (
                <tr key={item.id}>
                  <td>
                    <input
                      className="input requisition-line-input"
                      value={draft.quantity}
                      inputMode="numeric"
                      onChange={(event) =>
                        onLineChange(item.id, {
                          quantity: normalizeWholeNumberInput(
                            event.target.value,
                          ),
                        })
                      }
                    />
                  </td>
                  <td>{normalizeStockUnit(item.stockUnit)}</td>
                  <td>{item.partNumber || item.name}</td>
                  <td>{getRequisitionLineDescription(item)}</td>
                  <td>
                    <input
                      className="input requisition-date-input"
                      type="date"
                      value={draft.dueDate}
                      onChange={(event) =>
                        onLineChange(item.id, { dueDate: event.target.value })
                      }
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
          <textarea
            className="input min-h-24"
            value={header.comments}
            onChange={(event) => updateHeader("comments", event.target.value)}
          />
        </label>
        <label className="field-label">
          Priority
          <div className="requisition-priority-toggle">
            <label>
              <input
                type="radio"
                checked={header.priority === "Low"}
                onChange={() => updatePriority("Low")}
              />
              Low Priority
            </label>
            <label>
              <input
                type="radio"
                checked={header.priority === "High"}
                onChange={() => updatePriority("High")}
              />
              High Priority
            </label>
          </div>
        </label>
        <label className="field-label">
          Department Manager
          <input
            className="input"
            value={header.departmentManager}
            onChange={(event) =>
              updateHeader("departmentManager", event.target.value)
            }
          />
        </label>
        <label className="field-label">
          Requisitioned By
          <input
            className="input"
            value={header.requisitionedBy}
            onChange={(event) =>
              updateHeader("requisitionedBy", event.target.value)
            }
          />
        </label>
        <label className="field-label">
          Authorized By
          <input
            className="input"
            value={header.authorizedBy}
            onChange={(event) =>
              updateHeader("authorizedBy", event.target.value)
            }
          />
        </label>
      </div>

      <div className="requisition-actions">
        {isWebsiteMode ? (
          <>
            <button
              className="btn-primary reorder-create-button"
              type="button"
              onClick={handleBrowserPrintPdf}
            >
              Print / Save as PDF
            </button>
            <span className="requisition-action-helper">
              Website mode uses browser print/save as PDF. Official desktop PDF
              export is available in the desktop app. If Chrome prints the page
              URL or title, turn off Headers and footers in the print dialog.
            </span>
          </>
        ) : (
          <button
            className="btn-primary reorder-create-button"
            type="button"
            disabled={isGeneratingOfficialPdf}
            onClick={() => void handleGenerateOfficialPdf()}
          >
            {isGeneratingOfficialPdf
              ? "Generating PDF..."
              : "Generate Official PDF"}
          </button>
        )}
        <button
          className="btn-muted"
          type="button"
          onClick={() => void copyFormText()}
        >
          Copy Form Text
        </button>
        {copyStatus && (
          <span
            className={`requisition-status-message requisition-status-${copyStatusType}`}
          >
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
  const toneClass =
    delta === 0
      ? "stock-movement-neutral"
      : delta > 0
        ? "stock-movement-in"
        : "stock-movement-out";

  return (
    <span className={`stock-movement-badge ${toneClass}`}>
      {getStockMovement(change)}
    </span>
  );
}

function StockBeforeAfter({
  after,
  before,
}: {
  after: number;
  before: number;
}) {
  const toneClass =
    after === before
      ? "stock-before-after-neutral"
      : after > before
        ? "stock-before-after-in"
        : "stock-before-after-out";

  return (
    <span className={`stock-before-after ${toneClass}`}>
      <span>{formatNumber(before)}</span>
      <span className="stock-before-after-arrow">/</span>
      <span>{formatNumber(after)}</span>
    </span>
  );
}

async function printStockHistoryReport(
  data: AppData,
  stockRows: StockChange[],
) {
  const rows = stockRows
    .map((change) => {
      const item = data.items.find(
        (candidate) => candidate.id === change.itemId,
      );
      const vendorName =
        change.vendorNameSnapshot ||
        (item ? getVendorName(data, item.vendorId) : "-");
      const reason =
        [change.reason, change.notes].filter(Boolean).join(" - ") || "-";

      return `<tr>
        <td>${escapeReportHtml(formatDateTime(change.occurredAt))}</td>
        <td>${escapeReportHtml(change.itemNameSnapshot)}</td>
        <td>${escapeReportHtml(change.partNumberSnapshot || item?.partNumber || "-")}</td>
        <td>${escapeReportHtml(vendorName)}</td>
        <td>${escapeReportHtml(change.actionType)}</td>
        <td class="text-right">${escapeReportHtml(getStockMovement(change))}</td>
        <td>${escapeReportHtml(`${formatNumber(change.previousQuantity)} / ${formatNumber(change.newQuantity)}`)}</td>
        <td>${escapeReportHtml(reason)}</td>
        <td>${escapeReportHtml(change.actor || "-")}</td>
      </tr>`;
    })
    .join("");

  await openPrintableReport(
    "Maintenance Inventory Tracker - Stock Change Ledger",
    `<main class="report">
      <header class="report-header">
        <p class="report-kicker">Maintenance Inventory Tracker</p>
        <h1>Stock Change Ledger</h1>
      </header>
      <section class="report-meta">
        <div><span>Generated</span><strong>${escapeReportHtml(formatDateTime(nowIso()))}</strong></div>
        <div><span>Filters</span><strong>Current result set</strong></div>
        <div><span>Records</span><strong>${escapeReportHtml(formatNumber(stockRows.length))}</strong></div>
      </section>
      <table>
        <thead>
          <tr>
            <th>Date / Time</th>
            <th>Item</th>
            <th>Part Number</th>
            <th>Vendor</th>
            <th>Action</th>
            <th>Change</th>
            <th>Before / After</th>
            <th>Reason / Notes</th>
            <th>By</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </main>`,
  );
}

function HistoryPage({ data }: { data: AppData }) {
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(
    DEFAULT_HISTORY_LOG_PAGE_SIZE,
  );
  const [printStatus, setPrintStatus] = useState("");
  const [printStatusType, setPrintStatusType] = useState<"success" | "error">(
    "success",
  );
  const stockRows = data.stockChanges
    .slice()
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const totalHistoryPages = Math.max(
    1,
    Math.ceil(stockRows.length / historyPageSize),
  );
  const safeHistoryPage = Math.min(historyPage, totalHistoryPages);
  const historyPageStartIndex = (safeHistoryPage - 1) * historyPageSize;
  const paginatedStockRows = stockRows.slice(
    historyPageStartIndex,
    historyPageStartIndex + historyPageSize,
  );
  const pageStartNumber =
    stockRows.length === 0 ? 0 : historyPageStartIndex + 1;
  const pageEndNumber =
    stockRows.length === 0
      ? 0
      : historyPageStartIndex + paginatedStockRows.length;

  useEffect(() => {
    setHistoryPage(1);
  }, [historyPageSize]);

  useEffect(() => {
    setHistoryPage((current) => Math.min(current, totalHistoryPages));
  }, [totalHistoryPages]);

  function handleHistoryPageSizeChange(
    event: React.ChangeEvent<HTMLSelectElement>,
  ) {
    const nextPageSize = Number(event.target.value);

    setHistoryPageSize(
      HISTORY_LOG_PAGE_SIZE_OPTIONS.some((option) => option === nextPageSize)
        ? nextPageSize
        : DEFAULT_HISTORY_LOG_PAGE_SIZE,
    );
  }

  async function handlePrintHistory() {
    try {
      await printStockHistoryReport(data, stockRows);
      setPrintStatus("Print view started.");
      setPrintStatusType("success");
    } catch {
      setPrintStatus("Could not generate print file.");
      setPrintStatusType("error");
    }
  }

  return (
    <section className="space-y-5">
      <section className="panel">
        <SectionHeader
          kicker="History logs"
          title="Stock Change Ledger"
          action={
            <div className="report-action-stack">
              <button
                className="btn-small"
                type="button"
                onClick={handlePrintHistory}
              >
                Print History Logs
              </button>
              {printStatus && (
                <span
                  className={`requisition-status-message requisition-status-${printStatusType}`}
                >
                  {printStatus}
                </span>
              )}
            </div>
          }
        />
        <InventoryPagination
          currentPage={safeHistoryPage}
          onNextPage={() =>
            setHistoryPage((current) =>
              Math.min(totalHistoryPages, current + 1),
            )
          }
          onPageSizeChange={handleHistoryPageSizeChange}
          onPreviousPage={() =>
            setHistoryPage((current) => Math.max(1, current - 1))
          }
          pageEnd={pageEndNumber}
          pageSize={historyPageSize}
          pageStart={pageStartNumber}
          pageSizeOptions={HISTORY_LOG_PAGE_SIZE_OPTIONS}
          totalItems={stockRows.length}
          totalPages={totalHistoryPages}
        />
        <div className="history-table">
          <SimpleTable
            emptyText="No stock changes saved."
            headers={[
              "Date / Time",
              "Item",
              "Vendor",
              "Action",
              "Change",
              "Before / After",
              "Reason",
              "By",
            ]}
            rows={paginatedStockRows.map((change) => {
              const item = data.items.find(
                (candidate) => candidate.id === change.itemId,
              );
              const vendorName =
                change.vendorNameSnapshot ||
                (item ? getVendorName(data, item.vendorId) : "-");

              return [
                formatDateTime(change.occurredAt),
                change.itemNameSnapshot,
                vendorName,
                <StatusTag key={change.id} status={change.actionType} />,
                <StockMovementBadge
                  key={`${change.id}-movement`}
                  change={change}
                />,
                <StockBeforeAfter
                  key={`${change.id}-before-after`}
                  after={change.newQuantity}
                  before={change.previousQuantity}
                />,
                change.reason || "-",
                change.actor || "-",
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
  csvFolderStatus,
  csvFolderSupported,
  data,
  isStartingWebsiteUpdate,
  isRunningWebsiteBackup,
  lastBackupAt,
  lastAutoImportAt,
  newRecoveryCode,
  onChooseBackupFolder,
  onChooseCsvFolder,
  onClose,
  onCreateRecoveryCode,
  onDismissRecoveryCode,
  onDownloadHistoryCsv,
  onDownloadInventoryCsv,
  onDownloadWebsiteBackupHistoryCsv,
  onDownloadWebsiteBackupInventoryCsv,
  onDownloadWebsiteBackupJson,
  onExportCsvFolderNow,
  onImportInventoryCsv,
  onImportCsvFolder,
  onImportJson,
  onCheckWebsiteUpdate,
  onDeleteDeletedRecordForever,
  onPurgeExpiredDeletedRecords,
  onRestoreDeletedRecord,
  onRunBackup,
  onRunWebsiteBackup,
  onStartWebsiteUpdate,
  onStartScreensaver,
  isCheckingWebsiteUpdate,
  saveHealthRows,
  updateSettings,
  websiteBackupStatus,
  websiteUpdateStatus,
}: {
  backupSupported: boolean;
  backupMessage: string;
  csvFolderStatus: string;
  csvFolderSupported: boolean;
  data: AppData;
  isStartingWebsiteUpdate: boolean;
  isRunningWebsiteBackup: boolean;
  lastBackupAt: string | null;
  lastAutoImportAt: string | null;
  newRecoveryCode: string;
  onChooseBackupFolder: () => void;
  onChooseCsvFolder: () => void;
  onClose: () => void;
  onCreateRecoveryCode: () => void;
  onDismissRecoveryCode: () => void;
  onDownloadHistoryCsv: () => void;
  onDownloadInventoryCsv: () => void;
  onDownloadWebsiteBackupHistoryCsv: () => void;
  onDownloadWebsiteBackupInventoryCsv: () => void;
  onDownloadWebsiteBackupJson: () => void;
  onExportCsvFolderNow: () => void;
  onImportInventoryCsv: (file: File) => void;
  onImportCsvFolder: () => void;
  onImportJson: (file: File) => void;
  onCheckWebsiteUpdate: () => void;
  onDeleteDeletedRecordForever: (deletedRecordId: string) => void;
  onPurgeExpiredDeletedRecords: () => void;
  onRestoreDeletedRecord: (deletedRecordId: string) => void;
  onRunBackup: () => void;
  onRunWebsiteBackup: () => void;
  onStartWebsiteUpdate: () => void;
  onStartScreensaver: () => void;
  isCheckingWebsiteUpdate: boolean;
  saveHealthRows: SaveHealthRow[];
  updateSettings: (settings: AppSettings, auditSummary?: string) => void;
  websiteBackupStatus: WebsiteBackupStatus | null;
  websiteUpdateStatus: WebsiteUpdateStatus | null;
}) {
  const [pdfEngineStatus, setPdfEngineStatus] =
    useState<PdfEngineStatus | null>(null);
  const [isCheckingPdfEngine, setIsCheckingPdfEngine] = useState(false);
  const [pdfEngineError, setPdfEngineError] = useState("");
  const [appVersion, setAppVersion] = useState(APP_VERSION);
  const [updateFolderPath, setUpdateFolderPath] = useState(() =>
    getManualInstallerFolder(),
  );
  const [updateCheck, setUpdateCheck] =
    useState<ManualInstallerCheckResult | null>(null);
  const [updateStatus, setUpdateStatus] = useState(
    "Manual update mode is active.",
  );
  const [lastUpdateCheckAt, setLastUpdateCheckAt] = useState("");
  const [isCheckingUpdateFolder, setIsCheckingUpdateFolder] = useState(false);
  const [isOpeningInstallerFile, setIsOpeningInstallerFile] = useState(false);
  const [isOpeningUpdateFolder, setIsOpeningUpdateFolder] = useState(false);
  const [isChoosingUpdateFolder, setIsChoosingUpdateFolder] = useState(false);
  const websiteCsvImportInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    onPurgeExpiredDeletedRecords();
  }, []);

  const pdfStatusLabel = isCheckingPdfEngine
    ? "Checking..."
    : pdfEngineStatus
      ? pdfEngineStatus.ready
        ? "Ready"
        : "Needs setup"
      : "Not checked";
  const pdfStatusClass = pdfEngineStatus?.ready
    ? "pdf-engine-ready"
    : "pdf-engine-warning";
  const currentRankLabel = getRoleLabel(readAuthRecord()?.role);

  useEffect(() => {
    if (showWebsiteModePanel) {
      setAppVersion(APP_VERSION);
      return;
    }

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
      setPdfEngineError(
        error instanceof Error
          ? error.message
          : "Could not check PDF export engines.",
      );
    } finally {
      setIsCheckingPdfEngine(false);
    }
  }

  function openLibreOfficeDownload() {
    const openedWindow = window.open(
      "https://www.libreoffice.org/download/download-libreoffice/",
      "_blank",
      "noopener,noreferrer",
    );

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
      setLastUpdateCheckAt(nowIso());
      // debug: log update check and derived tones
      // eslint-disable-next-line no-console
      console.info("[update-check] result:", result);
      // eslint-disable-next-line no-console
      console.info("[update-check] updateStatus:", result.statusMessage);
    } catch (error) {
      setUpdateStatus(
        error instanceof Error
          ? error.message
          : "Could not check installer folder.",
      );
      setLastUpdateCheckAt(nowIso());
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
      setUpdateStatus(
        error instanceof Error
          ? error.message
          : "Could not open installer folder.",
      );
    } finally {
      setIsOpeningUpdateFolder(false);
    }
  }

  async function handleOpenNewestInstaller() {
    const installer = updateCheck?.newerInstaller;

    if (!installer) {
      setUpdateStatus("No newer installer file was found.");
      return;
    }

    setIsOpeningInstallerFile(true);

    try {
      await openInstallerFile(updateCheck.folderPath, installer.fileName);
      setUpdateStatus(`Installer opened: ${installer.fileName}`);
    } catch (error) {
      setUpdateStatus(
        error instanceof Error
          ? error.message
          : "Could not open installer file.",
      );
    } finally {
      setIsOpeningInstallerFile(false);
    }
  }

  async function handleChooseUpdateFolder() {
    setIsChoosingUpdateFolder(true);

    try {
      const folderPath = await chooseManualInstallerFolder();

      setUpdateFolderPath(folderPath);
      setUpdateStatus(
        "Update folder saved. Check the installer folder when ready.",
      );
      setUpdateCheck(null);
    } catch (error) {
      setUpdateStatus(
        error instanceof Error
          ? error.message
          : "Could not choose update folder.",
      );
    } finally {
      setIsChoosingUpdateFolder(false);
    }
  }

  const updateSummary = getUpdateStatusSummary(updateStatus, updateCheck);
  const updateFolderTone: HealthTone = updateCheck
    ? updateCheck.folderExists
      ? "good"
      : "warning"
    : "warning";
  const newestInstallerTone: HealthTone = updateCheck?.newerInstaller
    ? "warning"
    : updateCheck?.newestInstaller
      ? "good"
      : "warning";
  const lastCheckTone = getUpdateLastCheckTone(lastUpdateCheckAt, updateStatus);
  const updateFolderValue = updateFolderPath || DEFAULT_MANUAL_UPDATE_FOLDER;
  const newestInstallerValue = updateCheck?.newestInstaller
    ? `v${updateCheck.newestInstaller.version} - ${updateCheck.newestInstaller.fileName}`
    : updateCheck?.folderExists
      ? "No installer found"
      : "Not checked yet";
  const newestInstallerHelper = updateCheck?.newerInstaller
    ? "Newer local installer is ready"
    : updateCheck?.newestInstaller
      ? "Newest local installer in folder"
      : updateCheck?.folderExists
        ? "Folder has no matching installer"
        : "Run check to inspect folder";
  const updateStatusHelper = updateCheck?.newerInstaller
    ? "Close the app before running the installer."
    : updateCheck
      ? "Latest local check result"
      : "Run a local installer folder check.";
  const csvStatusTone = toneFromStatusMessage(
    csvFolderStatus,
    data.settings.csvExportFolderPath ? "good" : "warning",
  );
  const backupStatusTone = toneFromStatusMessage(
    data.settings.backupStatus || backupMessage,
  );
  const websiteBackupTone: HealthTone =
    websiteBackupStatus?.status === "healthy"
      ? "good"
      : websiteBackupStatus?.status === "failed"
        ? "danger"
        : "warning";
  const websiteBackupLabel = websiteBackupStatus
    ? websiteBackupStatus.status === "healthy"
      ? "Healthy"
      : websiteBackupStatus.status === "failed"
        ? "Failed"
        : "Warning"
    : "Not checked";
  const websiteUpdateTone: HealthTone =
    websiteUpdateStatus?.ok && websiteUpdateStatus.updateAvailable
      ? "warning"
      : websiteUpdateStatus?.ok
        ? "good"
        : websiteUpdateStatus
          ? "danger"
          : "warning";
  const websiteUpdateLabel =
    websiteUpdateStatus?.ok && websiteUpdateStatus.updateAvailable
      ? "Update available"
      : websiteUpdateStatus?.ok
        ? "Up to date"
        : websiteUpdateStatus
          ? "Could not check"
          : "Not checked";

  return (
    <section className="settings-popout">
      <section className="panel">
        <SectionHeader
          action={
            <button
              className="settings-close"
              type="button"
              aria-label="Close settings"
              onClick={onClose}
            >
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
                updateSettings(
                  { ...data.settings, companyShopName: event.target.value },
                  "Company/shop name was updated.",
                )
              }
            />
          </label>
          <label className="field-label">
            Default location
            <select
              className="input"
              value={data.settings.defaultLocationId}
              onChange={(event) =>
                updateSettings(
                  { ...data.settings, defaultLocationId: event.target.value },
                  "Default location was updated.",
                )
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
                  {
                    ...data.settings,
                    lowStockWarningsEnabled: event.target.value === "on",
                  },
                  "Low stock warning setting was updated.",
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
              value={
                data.settings.lowStockIncludeEqual ? "at-or-below" : "below"
              }
              onChange={(event) =>
                updateSettings(
                  {
                    ...data.settings,
                    lowStockIncludeEqual: event.target.value === "at-or-below",
                  },
                  "Low stock threshold rule was updated.",
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
                  {
                    ...data.settings,
                    allowNegativeStockOverride: event.target.value === "on",
                  },
                  "Negative stock override was updated.",
                )
              }
            >
              <option value="off">Off</option>
              <option value="on">On</option>
            </select>
          </label>
        </div>
        <div className="settings-status-card">
          <div className="pdf-engine-row">
            <span>Current rank</span>
            <strong>{currentRankLabel}</strong>
          </div>
        </div>
        <div className="settings-menu-row" aria-label="Settings sections">
          <button
            className="btn-primary settings-screensaver-action"
            type="button"
            onClick={onStartScreensaver}
          >
            <ScreensaverModeIcon />
            Start Screensaver Mode
          </button>
          {!showWebsiteModePanel && (
            <a className="btn-muted" href="#app-update">
              App Update
            </a>
          )}
        </div>
      </section>

      {showWebsiteModePanel && (
        <section className="panel website-mode-card">
          <SectionHeader
            action={
              <span className="settings-status-pill website-mode-pill">
                Backend SQLite Active
              </span>
            }
            kicker="Website Version"
            title="Website Mode"
          />
          <div className="settings-status-panel website-mode-grid">
            <div className="pdf-engine-row">
              <span>Runtime</span>
              <strong>Website Browser</strong>
            </div>
            <div className="pdf-engine-row">
              <span>Backend URL</span>
              <strong>{websiteBackendUrl}</strong>
            </div>
            <div className="pdf-engine-row">
              <span>Data mode</span>
              <strong>API + SQLite</strong>
            </div>
            <div className="pdf-engine-row">
              <span>JSON backup</span>
              <strong>Available / keep enabled</strong>
            </div>
            <div className="pdf-engine-row">
              <span>CSV</span>
              <strong>Browser download/upload</strong>
            </div>
          </div>
          <p className="settings-status-helper mt-4">
            This website version saves through the backend API and SQLite
            database. Desktop-only update folders, local PDF engine checks, and
            CSV folder sync are hidden in website mode.
          </p>
          <div className="settings-status-panel mt-4">
            <div className="settings-health-grid update-health-grid">
              <SettingsHealthCard
                helper="Checks GitHub for newer commits on the current branch"
                label="GitHub Update"
                tone={websiteUpdateTone}
                value={
                  isCheckingWebsiteUpdate ? "Checking..." : websiteUpdateLabel
                }
              />
              <SettingsHealthCard
                helper={
                  websiteUpdateStatus?.ok
                    ? `Local ${websiteUpdateStatus.localSha.slice(0, 7)} / Remote ${websiteUpdateStatus.remoteSha.slice(0, 7)}`
                    : "Run a manual check from this browser"
                }
                label="Update Status"
                tone={websiteUpdateTone}
                value={websiteUpdateStatusMessage(websiteUpdateStatus)}
              />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className="btn-primary"
              type="button"
              onClick={onCheckWebsiteUpdate}
              disabled={isCheckingWebsiteUpdate}
            >
              {isCheckingWebsiteUpdate
                ? "Checking for Updates..."
                : "Check for Updates"}
            </button>
            {websiteUpdateStatus?.ok && websiteUpdateStatus.updateAvailable && (
              <button
                className="btn-primary"
                type="button"
                onClick={onStartWebsiteUpdate}
                disabled={isStartingWebsiteUpdate}
              >
                {isStartingWebsiteUpdate ? "Starting Update..." : "Update Now"}
              </button>
            )}
          </div>
        </section>
      )}

      {!showWebsiteModePanel && (
        <>
          <section className="panel">
            <SectionHeader kicker="Fresh PC setup" title="PDF Export Setup" />
            <div className={`settings-status-card ${pdfStatusClass}`}>
              <div className="pdf-engine-row">
                <span>Status</span>
                <strong>{pdfStatusLabel}</strong>
              </div>
              <div className="pdf-engine-row">
                <span>Microsoft Excel</span>
                <strong>
                  {pdfEngineStatus
                    ? pdfEngineStatus.excelAvailable
                      ? "Found"
                      : "Not found"
                    : "Not checked"}
                </strong>
              </div>
              <div className="pdf-engine-row">
                <span>LibreOffice</span>
                <strong>
                  {pdfEngineStatus
                    ? pdfEngineStatus.libreOfficeAvailable
                      ? "Found"
                      : "Not found"
                    : "Not checked"}
                </strong>
              </div>
              <div className="pdf-engine-row">
                <span>Preferred engine</span>
                <strong>
                  {pdfEngineStatus?.preferredEngine ?? "Not checked"}
                </strong>
              </div>
              {pdfEngineStatus?.libreOfficePath && (
                <div className="pdf-engine-row">
                  <span>LibreOffice path</span>
                  <strong>{pdfEngineStatus.libreOfficePath}</strong>
                </div>
              )}
              <p>
                {pdfEngineStatus?.message ??
                  "Run the check to verify official requisition PDF export on this PC."}
              </p>
            </div>
            {pdfEngineError && (
              <p className="warning-bar mt-3">{pdfEngineError}</p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                className="btn-primary"
                type="button"
                onClick={() => void refreshPdfEngineStatus()}
                disabled={isCheckingPdfEngine}
              >
                {isCheckingPdfEngine
                  ? "Checking PDF Engine..."
                  : "Check PDF Engine"}
              </button>
              <button
                className="btn-muted"
                type="button"
                onClick={openLibreOfficeDownload}
              >
                Install LibreOffice
              </button>
            </div>
          </section>

          <section className="panel update-check-card" id="app-update">
            <SectionHeader
              action={
                <SettingsStatusPill
                  label={updateSummary.label}
                  tone={updateSummary.tone}
                />
              }
              kicker="Release foundation"
              title="App Update"
            />
            <div className="settings-status-panel">
              <div className="settings-health-grid update-health-grid">
                <SettingsHealthCard
                  helper="Installed desktop build"
                  label="Current Version"
                  tone="good"
                  value={`Maintenance Inventory Tracker v${appVersion}`}
                />
                <SettingsHealthCard
                  helper="Local installer folder updates"
                  label="Manual Update Mode"
                  tone="good"
                  value="Active"
                />
                <SettingsHealthCard
                  helper={
                    updateCheck
                      ? updateCheck.folderExists
                        ? "Folder found"
                        : "Folder missing"
                      : "Saved folder path"
                  }
                  label="Update Folder"
                  tone={updateFolderTone}
                  value={updateFolderValue}
                />
                <SettingsHealthCard
                  helper={newestInstallerHelper}
                  label="Newest Installer"
                  tone={newestInstallerTone}
                  value={newestInstallerValue}
                />
                <SettingsHealthCard
                  helper={
                    lastUpdateCheckAt
                      ? "Most recent local check"
                      : "No check this session"
                  }
                  label="Last Check"
                  tone={lastCheckTone}
                  value={
                    lastUpdateCheckAt
                      ? formatDateTime(lastUpdateCheckAt)
                      : "Not checked yet"
                  }
                />
                <SettingsHealthCard
                  helper={updateStatusHelper}
                  label="Update Status"
                  tone={updateSummary.tone}
                  value={updateStatus}
                />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                className="btn-primary"
                type="button"
                onClick={() => void handleCheckInstallerFolder()}
                disabled={isCheckingUpdateFolder}
              >
                {isCheckingUpdateFolder
                  ? "Checking for Updates..."
                  : "Check for Updates"}
              </button>
              {updateCheck?.newerInstaller && (
                <button
                  className="btn-primary"
                  type="button"
                  onClick={() => void handleOpenNewestInstaller()}
                  disabled={isOpeningInstallerFile}
                >
                  {isOpeningInstallerFile
                    ? "Opening Installer..."
                    : "Yes, Update"}
                </button>
              )}
              <button
                className="btn-muted"
                type="button"
                onClick={() => void handleOpenInstallerFolder()}
                disabled={isOpeningUpdateFolder}
              >
                {isOpeningUpdateFolder
                  ? "Opening Folder..."
                  : "Open Update Folder"}
              </button>
              <button
                className="btn-muted"
                type="button"
                onClick={() => void handleChooseUpdateFolder()}
                disabled={isChoosingUpdateFolder}
              >
                {isChoosingUpdateFolder
                  ? "Choosing Folder..."
                  : "Choose Update Folder"}
              </button>
            </div>
          </section>
        </>
      )}

      {!showWebsiteModePanel && (
        <section className="panel">
          <SectionHeader kicker="Security" title="Recovery Access" />
          <div className="security-panel-content">
            <div>
              <p className="text-sm font-semibold text-slate-300">
                Create a fresh recovery code for this local inventory lock
                without changing the current password.
              </p>
              <p className="mt-1 text-xs font-bold text-amber-100">
                The previous recovery code stops working as soon as a new one is
                created.
              </p>
            </div>
            <button
              className="btn-primary"
              type="button"
              onClick={onCreateRecoveryCode}
            >
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
              <div
                className="recovery-code-card"
                aria-label="New one-time recovery code"
              >
                {newRecoveryCode}
              </div>
              <button
                className="btn-muted"
                type="button"
                onClick={onDismissRecoveryCode}
              >
                I Saved This Code
              </button>
            </div>
          )}
        </section>
      )}

      <section className="panel">
        <SectionHeader kicker="Backup" title="Backup Settings" />
        {showWebsiteModePanel ? (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div className="field-label">
                Backup Mode
                <div className={`${statusLineToneClass("good")} min-h-10`}>
                  Backend Auto Backup
                </div>
              </div>
              <div className="field-label">
                Backup Folder
                <div
                  className={`${statusLineToneClass(websiteBackupStatus?.backupRoot ? "good" : "warning")} min-h-10`}
                >
                  {websiteBackupStatus?.backupRoot ??
                    "Checking backend backup folder..."}
                </div>
              </div>
              <div className="field-label">
                Last JSON backup time
                <div
                  className={`${statusLineToneClass(websiteBackupStatus?.lastJsonBackupAt ? "good" : "warning")} min-h-10`}
                >
                  {websiteBackupStatus?.lastJsonBackupAt
                    ? formatDateTime(websiteBackupStatus.lastJsonBackupAt)
                    : "No JSON backup has run yet"}
                </div>
              </div>
              <div className="field-label">
                Last CSV export time
                <div
                  className={`${statusLineToneClass(websiteBackupStatus?.lastCsvExportAt ? "good" : "warning")} min-h-10`}
                >
                  {websiteBackupStatus?.lastCsvExportAt
                    ? formatDateTime(websiteBackupStatus.lastCsvExportAt)
                    : "No CSV export has run yet"}
                </div>
              </div>
              <div className="field-label">
                Backup status
                <div
                  className={`${statusLineToneClass(websiteBackupTone)} min-h-10`}
                >
                  {websiteBackupLabel}
                  {websiteBackupStatus?.message &&
                  websiteBackupStatus.message !== websiteBackupLabel
                    ? ` - ${websiteBackupStatus.message}`
                    : ""}
                </div>
              </div>
              <div className="field-label">
                Auto Backup
                <div className={`${statusLineToneClass("good")} min-h-10`}>
                  On
                </div>
              </div>
              <div className="field-label">
                Backup Interval
                <div className={`${statusLineToneClass("good")} min-h-10`}>
                  After every saved change
                </div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                className="btn-primary"
                type="button"
                onClick={onRunWebsiteBackup}
                disabled={isRunningWebsiteBackup}
              >
                {isRunningWebsiteBackup ? "Backing Up..." : "Backup Now"}
              </button>
              <button
                className="btn-muted"
                type="button"
                onClick={onDownloadWebsiteBackupJson}
              >
                Download Latest JSON
              </button>
              <button
                className="btn-muted"
                type="button"
                onClick={onDownloadWebsiteBackupInventoryCsv}
              >
                Download Inventory CSV
              </button>
              <button
                className="btn-muted"
                type="button"
                onClick={onDownloadWebsiteBackupHistoryCsv}
              >
                Download History CSV
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
            </div>
          </>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <label className="field-label">
                Auto Backup
                <select
                  className="input"
                  value={data.settings.backupEnabled ? "on" : "off"}
                  onChange={(event) =>
                    updateSettings(
                      {
                        ...data.settings,
                        backupEnabled: event.target.value === "on",
                      },
                      "Auto JSON backup setting was updated.",
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
                      {
                        ...data.settings,
                        autoImportEnabled: event.target.value === "on",
                      },
                      "Auto import setting was updated.",
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
                      {
                        ...data.settings,
                        backupInterval: event.target.value as BackupInterval,
                      },
                      "Backup interval was updated.",
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
                <div
                  className={`${statusLineToneClass(data.settings.backupDirectoryName ? "good" : "warning")} min-h-10`}
                >
                  {data.settings.backupDirectoryName || "No folder selected"}
                </div>
              </div>
              <div className="field-label">
                Last backup time
                <div
                  className={`${statusLineToneClass(lastBackupAt || data.settings.lastBackupTimestamp ? "good" : "warning")} min-h-10`}
                >
                  {lastBackupAt || data.settings.lastBackupTimestamp
                    ? formatDateTime(
                        lastBackupAt || data.settings.lastBackupTimestamp,
                      )
                    : "No backup has run yet"}
                </div>
              </div>
              <div className="field-label">
                Last auto import time
                <div
                  className={`${statusLineToneClass(lastAutoImportAt || data.settings.lastAutoImportTimestamp ? "good" : "warning")} min-h-10`}
                >
                  {lastAutoImportAt || data.settings.lastAutoImportTimestamp
                    ? formatDateTime(
                        lastAutoImportAt ||
                          data.settings.lastAutoImportTimestamp,
                      )
                    : "Auto import has not run yet"}
                </div>
              </div>
              <div className="field-label xl:col-span-3">
                Backup status
                <div
                  className={`${statusLineToneClass(backupStatusTone)} min-h-10`}
                >
                  {data.settings.backupStatus || backupMessage}
                </div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                className="btn-primary"
                type="button"
                onClick={onChooseBackupFolder}
                disabled={!backupSupported}
              >
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
          </>
        )}
      </section>

      <section className="panel">
        <SectionHeader kicker="CSV" title="CSV Export / Import" />
        {showWebsiteModePanel ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className="btn-primary"
              type="button"
              onClick={onDownloadInventoryCsv}
            >
              Download Inventory CSV
            </button>
            <button
              className="btn-muted"
              type="button"
              onClick={() => websiteCsvImportInputRef.current?.click()}
            >
              Import Inventory CSV
            </button>
            <button
              className="btn-muted"
              type="button"
              onClick={onDownloadHistoryCsv}
            >
              Download History CSV
            </button>
            <input
              ref={websiteCsvImportInputRef}
              hidden
              accept=".csv,text/csv"
              type="file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  onImportInventoryCsv(file);
                }
                event.currentTarget.value = "";
              }}
            />
            <p className="w-full text-sm font-semibold text-slate-300">
              Website mode uses browser download/upload. Folder sync is only
              available in the desktop app.
            </p>
            <p className="w-full text-sm font-semibold text-slate-300">
              Website mode auto-saves backend CSV files after each successful
              change. Browser downloads are manual copies.
            </p>
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div className="field-label xl:col-span-2">
                Selected CSV folder
                <div
                  className={`${statusLineToneClass(data.settings.csvExportFolderPath ? "good" : "warning")} min-h-10`}
                >
                  {data.settings.csvExportFolderPath ||
                    "No CSV folder selected"}
                </div>
              </div>
              <label className="field-label">
                Auto-export History Logs monthly
                <div
                  className={`${statusLineToneClass(data.settings.csvAutoExportHistoryEnabled ? "good" : "warning")} min-h-10 flex items-center gap-2`}
                >
                  <input
                    checked={data.settings.csvAutoExportHistoryEnabled}
                    type="checkbox"
                    onChange={(event) =>
                      updateSettings(
                        {
                          ...data.settings,
                          csvAutoExportHistoryEnabled: event.target.checked,
                        },
                        "CSV monthly history auto-export setting was updated.",
                      )
                    }
                  />
                  <span>
                    {data.settings.csvAutoExportHistoryEnabled ? "On" : "Off"}
                  </span>
                </div>
              </label>
              <div className="field-label">
                Last CSV export time
                <div
                  className={`${statusLineToneClass(data.settings.csvLastExportAt ? "good" : "warning")} min-h-10`}
                >
                  {data.settings.csvLastExportAt
                    ? formatDateTime(data.settings.csvLastExportAt)
                    : "No CSV export has run yet"}
                </div>
              </div>
              <div className="field-label">
                Last history CSV update
                <div
                  className={`${statusLineToneClass(data.settings.csvLastHistoryExportAt ? "good" : "warning")} min-h-10`}
                >
                  {data.settings.csvLastHistoryExportAt
                    ? formatDateTime(data.settings.csvLastHistoryExportAt)
                    : "History CSV has not updated yet"}
                </div>
              </div>
              <div className="field-label xl:col-span-3">
                CSV status
                <div
                  className={`${statusLineToneClass(csvStatusTone)} min-h-10`}
                >
                  {csvFolderStatus}
                </div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                className="btn-primary"
                type="button"
                onClick={onChooseCsvFolder}
                disabled={!csvFolderSupported}
              >
                Choose CSV Folder
              </button>
              <button
                className="btn-muted"
                type="button"
                onClick={onExportCsvFolderNow}
                disabled={!csvFolderSupported}
              >
                Export CSV Now
              </button>
              <button
                className="btn-muted"
                type="button"
                onClick={onImportCsvFolder}
                disabled={!csvFolderSupported}
              >
                Import CSV Folder
              </button>
              <p className="w-full text-xs font-semibold text-slate-500">
                Suggested folder: {CSV_RECOMMENDED_FOLDER}
              </p>
              <p className="w-full text-xs font-semibold text-slate-500">
                Files: Inventory\\inventory.csv, Vendors\\vendors.csv,
                Locations\\locations.csv, History Logs\\YYYY\\YYYY-MM.
              </p>
            </div>
          </>
        )}
      </section>

      <RecentlyDeletedPanel
        deletedRecords={data.deletedRecords ?? []}
        onDeleteForever={onDeleteDeletedRecordForever}
        onPurgeExpired={onPurgeExpiredDeletedRecords}
        onRestore={onRestoreDeletedRecord}
      />
      <SaveHealthPanel rows={saveHealthRows} />
    </section>
  );
}

function StatCard({
  label,
  tone,
  value,
}: {
  label: string;
  tone: "cyan" | "green" | "amber" | "rose";
  value: string;
}) {
  return (
    <div className={`metric-card metric-${tone}`}>
      <p className="text-xs font-bold uppercase text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-black text-white">{value}</p>
    </div>
  );
}

function StatusStatCard({
  item,
  onWatchListVisibilityClick,
  settings,
  status,
}: {
  item?: InventoryItem;
  onWatchListVisibilityClick?: (itemId: string) => void;
  settings?: AppSettings;
  status: InventoryStatus;
}) {
  return (
    <div
      className={`metric-card status-metric-card ${statusMetricClassName(status)}`}
    >
      <p className="text-xs font-bold uppercase text-slate-400">Status</p>
      <div className="mt-3">
        {item && settings && onWatchListVisibilityClick ? (
          <StatusWithWatchVisibility
            item={item}
            settings={settings}
            onWatchListVisibilityClick={onWatchListVisibilityClick}
          />
        ) : (
          <StatusTag status={status} />
        )}
      </div>
    </div>
  );
}

function PartNumberCell({
  item,
  onOpenError,
}: {
  item: InventoryItem;
  onOpenError?: (message: string) => void;
}) {
  const partNumber = item.partNumber || "-";
  const savedItemUrl = item.itemUrl.trim();
  const href = getItemUrlHref(savedItemUrl);

  if (!savedItemUrl) {
    return <span className="part-number-plain">{partNumber}</span>;
  }

  if (!href) {
    return (
      <span
        className="part-number-plain part-number-invalid"
        title="Invalid item link saved"
      >
        {partNumber}
      </span>
    );
  }

  async function openItemLink(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();

    if (!href) {
      onOpenError?.("Invalid item link.");
      return;
    }

    if (isWebsiteBrowserMode()) {
      const opened = window.open(href, "_blank", "noopener,noreferrer");

      if (!opened) {
        onOpenError?.(
          "Browser blocked the item link popup. Allow popups or open the link manually.",
        );
      }

      return;
    }

    try {
      await openUrl(href);
    } catch {
      onOpenError?.("Could not open item link.");
    }
  }

  return (
    <button
      className="part-link part-link-jbt"
      type="button"
      title="Open item link"
      aria-label={`Open item link for ${partNumber}`}
      onClick={(event) => void openItemLink(event)}
    >
      <span>{partNumber}</span>
      <span aria-hidden="true" className="part-link-icon">
        ↗
      </span>
    </button>
  );
}

function StockQuantity({
  ariaLabel,
  compact = false,
  item,
  onClick,
  settings,
  title,
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
      <button
        className={className}
        type="button"
        aria-label={ariaLabel}
        title={title}
        onClick={onClick}
      >
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
  const qrValue = value.trim();

  return (
    <div
      className={`qr-preview ${qrValue ? "qr-preview-filled" : "qr-preview-empty"}`}
      aria-label="QR code preview"
    >
      {qrValue ? (
        <QRCodeSVG
          value={qrValue}
          size={120}
          level="M"
          bgColor="#f8fafc"
          fgColor="#020617"
          marginSize={4}
          title="Item QR code"
        />
      ) : (
        <span className="qr-preview-empty-mark">No QR value yet.</span>
      )}
    </div>
  );
}

function formatDeletedRecordTimeRemaining(record: DeletedRecord) {
  const expiresAt = new Date(record.expiresAt).getTime();

  if (!Number.isFinite(expiresAt)) {
    return "Unknown";
  }

  const remainingMs = Math.max(0, expiresAt - Date.now());
  const minutes = Math.ceil(remainingMs / 60000);

  return minutes <= 0 ? "Expired" : `${formatNumber(minutes)} min`;
}

function RecentlyDeletedPanel({
  deletedRecords,
  onDeleteForever,
  onPurgeExpired,
  onRestore,
}: {
  deletedRecords: DeletedRecord[];
  onDeleteForever: (deletedRecordId: string) => void;
  onPurgeExpired: () => void;
  onRestore: (deletedRecordId: string) => void;
}) {
  const activeDeletedRecords = purgeExpiredDeletedRecords(deletedRecords).sort(
    (a, b) => b.deletedAt.localeCompare(a.deletedAt),
  );

  return (
    <section className="panel recently-deleted-panel">
      <SectionHeader
        kicker="Undo deletes"
        title="Recently Deleted"
        action={
          <button className="btn-small" type="button" onClick={onPurgeExpired}>
            Refresh
          </button>
        }
      />
      <SimpleTable
        emptyText="No recently deleted records."
        headers={[
          "Deleted",
          "Type",
          "Record",
          "Details",
          "Time Left",
          "Actions",
        ]}
        rowKeys={activeDeletedRecords.map((record) => record.id)}
        rows={activeDeletedRecords.map((record) => [
          formatDateTime(record.deletedAt),
          record.type,
          record.title,
          record.details || "-",
          formatDeletedRecordTimeRemaining(record),
          <span key="actions" className="trash-actions">
            <button
              className="btn-small"
              type="button"
              onClick={() => onRestore(record.id)}
            >
              Restore
            </button>
            <button
              className="btn-danger"
              type="button"
              onClick={() => onDeleteForever(record.id)}
            >
              Delete Forever
            </button>
          </span>,
        ])}
      />
    </section>
  );
}

function SaveHealthPanel({ rows }: { rows: SaveHealthRow[] }) {
  const summary = getSaveHealthSummary(rows);

  return (
    <section className="panel save-health-panel">
      <SectionHeader
        action={
          <SettingsStatusPill label={summary.label} tone={summary.tone} />
        }
        kicker="Backup"
        title="Local Save Health"
      />
      <div className="settings-status-panel">
        <p className="settings-status-helper">{summary.helper}</p>
        <div className="settings-health-grid">
          {rows.map((row) => (
            <SettingsHealthCard
              key={row.label}
              helper={getSaveHealthHelper(row.label)}
              label={row.label}
              tone={row.tone}
              value={row.value}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function SettingsStatusPill({
  label,
  tone,
}: {
  label: string;
  tone: HealthTone;
}) {
  return (
    <span
      className={statusPillClass(tone)}
      style={
        tone === "good"
          ? {
              borderColor: "rgba(74, 222, 128, 0.48)",
              background: "rgba(34,197,94,0.13)",
              color: "#bbf7d0",
              boxShadow: "0 0 18px rgba(34,197,94,0.12)",
            }
          : tone === "warning"
            ? {
                borderColor: "rgba(251,191,36,0.5)",
                background: "rgba(245,158,11,0.13)",
                color: "#fde68a",
                boxShadow: "0 0 18px rgba(245,158,11,0.1)",
              }
            : tone === "danger"
              ? {
                  borderColor: "rgba(251,113,133,0.5)",
                  background: "rgba(244,63,94,0.13)",
                  color: "#fecdd3",
                  boxShadow: "0 0 18px rgba(244,63,94,0.12)",
                }
              : undefined
      }
    >
      <span
        className={`settings-health-dot settings-health-dot-${tone}`}
        aria-hidden="true"
        style={
          tone === "good"
            ? {
                background: "#4ade80",
                color: "#4ade80",
                boxShadow: "0 0 12px #4ade80",
              }
            : tone === "warning"
              ? {
                  background: "#facc15",
                  color: "#facc15",
                  boxShadow: "0 0 12px #facc15",
                }
              : tone === "danger"
                ? {
                    background: "#fb7185",
                    color: "#fb7185",
                    boxShadow: "0 0 12px #fb7185",
                  }
                : undefined
        }
      />
      {label}
    </span>
  );
}

function SettingsHealthCard({
  helper,
  label,
  tone,
  value,
}: {
  helper: string;
  label: string;
  tone: HealthTone;
  value: string;
}) {
  return (
    <div
      className={statusCardClass(tone)}
      style={
        tone === "good"
          ? {
              borderColor: "rgba(74, 222, 128, 0.34)",
              background:
                "linear-gradient(135deg, rgba(34,197,94,0.11), rgba(15,23,42,0.24))",
            }
          : tone === "warning"
            ? {
                borderColor: "rgba(251,191,36,0.38)",
                background:
                  "linear-gradient(135deg, rgba(245,158,11,0.12), rgba(15,23,42,0.24))",
              }
            : tone === "danger"
              ? {
                  borderColor: "rgba(251,113,133,0.4)",
                  background:
                    "linear-gradient(135deg, rgba(244,63,94,0.12), rgba(15,23,42,0.24))",
                }
              : undefined
      }
    >
      <div className="settings-health-card-top">
        <span
          className={`settings-health-dot settings-health-dot-${tone}`}
          aria-hidden="true"
          style={
            tone === "good"
              ? {
                  background: "#4ade80",
                  color: "#4ade80",
                  boxShadow: "0 0 12px #4ade80",
                }
              : tone === "warning"
                ? {
                    background: "#facc15",
                    color: "#facc15",
                    boxShadow: "0 0 12px #facc15",
                  }
                : tone === "danger"
                  ? {
                      background: "#fb7185",
                      color: "#fb7185",
                      boxShadow: "0 0 12px #fb7185",
                    }
                  : undefined
          }
        />
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      <div style={{ marginTop: "6px", fontSize: "12px", color: "#9ca3af" }}>
        tone: {tone}
      </div>
      <p>{helper}</p>
    </div>
  );
}

function SectionHeader({
  action,
  kicker,
  title,
}: {
  action?: React.ReactNode;
  kicker?: string;
  title: string;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        {kicker && <p className="eyebrow">{kicker}</p>}
        <h2 className="text-lg font-black tracking-tight text-white">
          {title}
        </h2>
      </div>
      {action}
    </div>
  );
}

function NewEntityBadge({ count }: { count?: number }) {
  return (
    <span className="new-entity-badge" aria-label="New records">
      NEW{count && count > 1 ? ` ${count}` : ""}
    </span>
  );
}

function NewEntityChip() {
  return (
    <span className="new-entity-chip" aria-label="Newly created">
      NEW
    </span>
  );
}

function StatusDot({ state }: { state: BackupIndicatorState }) {
  return (
    <span
      className={`status-dot status-dot-${state}`}
      aria-label={`Backup ${state}`}
    />
  );
}

function StatusTag({
  ariaLabel,
  onClick,
  status,
  title,
}: {
  ariaLabel?: string;
  onClick?: () => void;
  status: string;
  title?: string;
}) {
  const className = `tag ${statusTagClassName(status)} ${onClick ? "tag-action" : ""}`;

  if (onClick) {
    return (
      <button
        className={className}
        type="button"
        aria-label={ariaLabel}
        title={title}
        onClick={onClick}
      >
        {status}
      </button>
    );
  }

  return <span className={className}>{status}</span>;
}

function StatusWithWatchVisibility({
  ariaLabel,
  item,
  onClick,
  onWatchListVisibilityClick,
  settings,
  title,
}: {
  ariaLabel?: string;
  item: InventoryItem;
  onClick?: () => void;
  onWatchListVisibilityClick: (itemId: string) => void;
  settings: AppSettings;
  title?: string;
}) {
  const status = getInventoryStatus(item, settings);
  const shouldShowWatchToggle = isReorderNeeded(item, settings);
  const isHidden = isHiddenFromDashboardWatchList(item, settings);

  return (
    <span className="status-with-watch-visibility">
      <StatusTag
        ariaLabel={ariaLabel}
        onClick={onClick}
        status={status}
        title={title}
      />
      {shouldShowWatchToggle && (
        <button
          className={`hidden-watch-indicator ${isHidden ? "hidden-watch-indicator-unhide" : ""}`}
          type="button"
          aria-label={`${isHidden ? "Unhide" : "Hide"} ${item.name} ${isHidden ? "on" : "from"} Dashboard Watch List`}
          title={isHidden ? "Unhide from Watch List" : "Hide from Watch List"}
          onClick={(event) => {
            event.stopPropagation();
            onWatchListVisibilityClick(item.id);
          }}
        >
          {isHidden ? <EyeIcon /> : <EyeOffIcon />}
        </button>
      )}
    </span>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-hidden="true">
      <path d="M3 3l18 18" />
      <path d="M10.6 10.6a3 3 0 0 0 3.8 3.8" />
      <path d="M9.8 5.2A10.7 10.7 0 0 1 12 5c5 0 8.5 4.2 10 7-.5 1-1.4 2.2-2.5 3.3" />
      <path d="M6.1 6.8C4.3 8 3 10 2 12c1.5 2.8 5 7 10 7 1.4 0 2.7-.3 3.8-.9" />
    </svg>
  );
}

function NewItemWatchListSettingDialog({
  onCancel,
  onChoose,
}: {
  onCancel: () => void;
  onChoose: (choice: WatchListVisibilityChoice) => void;
}) {
  const [selectedChoice, setSelectedChoice] =
    useState<WatchListVisibilityChoice>("hidden");
  const choices: Array<{
    description: string;
    label: string;
    value: WatchListVisibilityChoice;
  }> = [
    {
      description: "Default for new items.",
      label: "Hide from Dashboard Watch List",
      value: "hidden",
    },
    {
      description: "Use normal low-stock and out-of-stock alerts.",
      label: "Show on Dashboard when Low/Out of Stock",
      value: "visible",
    },
    {
      description: "Keep it in the held reorder group.",
      label: "Hold for Reorder List",
      value: "held",
    },
  ];

  return (
    <div className="review-modal-backdrop">
      <section
        className="review-modal watch-list-setting-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="watch-list-setting-title"
      >
        <h3 id="watch-list-setting-title">Dashboard Watch List Setting</h3>
        <p>
          Choose how this item should appear when it reaches low stock or out of
          stock.
        </p>
        <div className="watch-list-choice-grid">
          {choices.map((choice) => (
            <button
              key={choice.value}
              className={`watch-list-choice-button ${selectedChoice === choice.value ? "watch-list-choice-button-selected" : ""}`}
              type="button"
              aria-pressed={selectedChoice === choice.value}
              onClick={() => setSelectedChoice(choice.value)}
            >
              <strong>{choice.label}</strong>
              <span>{choice.description}</span>
            </button>
          ))}
        </div>
        <div className="review-modal-actions">
          <button
            className="btn-primary"
            type="button"
            onClick={() => onChoose(selectedChoice)}
          >
            Save Watch List Setting
          </button>
          <button className="btn-muted" type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}

function ShowWatchListDialog({
  item,
  onClose,
  onMoveToHeld,
  onShow,
}: {
  item: InventoryItem;
  onClose: () => void;
  onMoveToHeld: () => void;
  onShow: () => void;
}) {
  return (
    <div className="review-modal-backdrop">
      <section
        className="review-modal show-watch-list-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="show-watch-list-title"
      >
        <h3 id="show-watch-list-title">Show on Watch List?</h3>
        <p>
          This item is currently hidden from the Dashboard Watch List. Do you
          want it to show when Low Stock or Out of Stock?
        </p>
        <div className="review-modal-summary">
          <span>{item.name}</span>
          <strong>{item.partNumber || "No part number"}</strong>
        </div>
        <div className="review-modal-actions">
          <button className="btn-primary" type="button" onClick={onShow}>
            Show on Watch List
          </button>
          <button className="btn-muted" type="button" onClick={onMoveToHeld}>
            Move to Held
          </button>
          <button className="btn-muted" type="button" onClick={onClose}>
            Keep Hidden
          </button>
        </div>
      </section>
    </div>
  );
}

function Toast({
  actionLabel,
  onAction,
  text,
  tone,
}: Exclude<ToastState, null>) {
  return (
    <div className={`toast toast-${tone}`}>
      <span>{text}</span>
      {actionLabel && onAction && (
        <button className="toast-action" type="button" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function SimpleTable({
  emptyText,
  footer,
  headers,
  leading,
  onScroll,
  rowClassNames,
  rowKeys,
  rows,
  scrollRef,
}: {
  emptyText: string;
  footer?: React.ReactNode;
  headers: React.ReactNode[];
  leading?: React.ReactNode;
  onScroll?: () => void;
  rowClassNames?: string[];
  rowKeys?: string[];
  rows: React.ReactNode[][];
  scrollRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div className="table-wrap" ref={scrollRef} onScroll={onScroll}>
      {leading}
      <table className="data-table">
        <thead>
          <tr>
            {headers.map((header, index) => (
              <th key={index}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={rowKeys?.[index] ?? index}
              className={rowClassNames?.[index] || undefined}
            >
              {row.map((cell, cellIndex) => (
                <td key={`${rowKeys?.[index] ?? index}-${cellIndex}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={headers.length}
                className="py-8 text-center text-sm font-semibold text-slate-500"
              >
                {emptyText}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {footer}
    </div>
  );
}

export default App;
