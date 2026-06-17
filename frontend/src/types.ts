export type PageId =
  | "dashboard"
  | "inventory"
  | "add-item"
  | "stock"
  | "locations"
  | "vendors"
  | "reorder"
  | "history";

export type InventoryStatus = "In Stock" | "Low Stock" | "Out of Stock" | "Order As Needed";
export type StockActionType = "Stock In" | "Stock Out" | "Set Stock On Hand";
export type BackupIndicatorState = "saved" | "pending" | "running" | "done" | "failed";
export type BackupInterval = "manual" | "change" | "5min" | "15min";

export type BackupPermissionState = "granted" | "denied" | "prompt";

export type BackupWritableFile = {
  write: (contents: string) => Promise<void> | void;
  close: () => Promise<void> | void;
};

export type BackupFileHandle = {
  getFile?: () => Promise<File>;
  createWritable: () => Promise<BackupWritableFile>;
};

export type BackupDirectoryHandle = {
  name?: string;
  queryPermission?: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<BackupPermissionState>;
  requestPermission?: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<BackupPermissionState>;
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<BackupFileHandle>;
};

export type AppSettings = {
  id: "appSettings";
  companyShopName: string;
  headerBadgeText: string;
  defaultLocationId: string;
  lowStockWarningsEnabled: boolean;
  lowStockIncludeEqual: boolean;
  allowNegativeStockOverride: boolean;
  backupEnabled: boolean;
  backupInterval: BackupInterval;
  autoImportEnabled: boolean;
  backupDirectoryName: string;
  backupDirectoryPath: string;
  backupDirectoryHandle: BackupDirectoryHandle | null;
  csvExportFolderPath: string;
  csvAutoExportHistoryEnabled: boolean;
  csvLastExportAt: string;
  csvLastHistoryExportAt: string;
  customCategories: string[];
  lastBackupTimestamp: string;
  lastAutoImportTimestamp: string;
  backupStatus: string;
  watchListDefaultsMigratedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type LocationRecord = {
  id: string;
  name: string;
  description: string;
  notes: string;
  isDemo?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type VendorRecord = {
  id: string;
  name: string;
  contactName: string;
  contactEmail: string;
  phone: string;
  email: string;
  website: string;
  notes: string;
  isDemo?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type InventoryItem = {
  id: string;
  name: string;
  partNumber: string;
  description: string;
  category: string;
  quantityOnHand: number;
  stockUnit: string;
  minimumStockLevel: number;
  lowStockAlertLevel: number;
  locationId: string;
  vendorId: string;
  costEach: number;
  itemUrl: string;
  notes: string;
  imagePlaceholder: string;
  imageDataUrl: string;
  barcodePlaceholder: string;
  reorderHold?: boolean;
  orderPlaced?: boolean;
  orderRequisitionId?: string;
  hiddenFromWatchList?: boolean;
  nonStocked?: boolean;
  isDemo?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type DeletedRecordType = "Inventory" | "Vendor" | "Location";

export type DeletedRecord = {
  id: string;
  originalId: string;
  type: DeletedRecordType;
  title: string;
  details: string;
  deletedAt: string;
  expiresAt: string;
  actor: string;
  payload: InventoryItem | VendorRecord | LocationRecord;
};

export type RequisitionLineDraft = {
  dueDate: string;
  itemId: string;
  quantity: string;
};

export type RequisitionHeaderDraft = {
  assetNo: string;
  authorizedBy: string;
  codeNo: string;
  comments: string;
  confirmedWith: string;
  departmentManager: string;
  equipmentNo: string;
  fob: string;
  initials: string;
  jobNo: string;
  materialCert: "Yes" | "No";
  moldNo: string;
  partNo: string;
  poClass: string;
  poInitiator: string;
  poNo: string;
  priority: "Low" | "High";
  reqDate: string;
  requisitionedBy: string;
  shipVia: string;
  taxExempt: "Yes" | "No";
  tsNo: string;
  vendorAddress: string;
  vendorName: string;
  workOrderNo: string;
};

export type RequisitionVendorGroup = {
  items: InventoryItem[];
  vendor?: VendorRecord;
  vendorKey: string;
  vendorName: string;
};

export type RequisitionMadeRecord = {
  id: string;
  vendorKey: string;
  vendorName: string;
  createdAt?: string;
  createdBy?: string;
  itemIds: string[];
  itemSnapshots: {
    itemId: string;
    itemName: string;
    partNumber: string;
    quantityRequested: number;
    unitCost: number;
    totalCost: number;
  }[];
  poNo?: string;
  totalCost: number;
  requisitionType: "under100" | "over100";
  pdfGeneratedAt: string;
  passedAt: string;
  requisitionedBy?: string;
  status: string;
};

export type StockChange = {
  id: string;
  itemId: string;
  itemNameSnapshot: string;
  partNumberSnapshot: string;
  vendorNameSnapshot?: string;
  actionType: StockActionType;
  quantity: number;
  reason: string;
  actor: string;
  notes: string;
  occurredAt: string;
  previousQuantity: number;
  newQuantity: number;
  isDemo?: boolean;
  createdAt: string;
};

export type AuditEntityType = "Item" | "Stock" | "Location" | "Vendor" | "Settings" | "Import";

export type AuditEntry = {
  id: string;
  entityType: AuditEntityType;
  entityId: string;
  action: string;
  summary: string;
  actor: string;
  occurredAt: string;
  isDemo?: boolean;
};

export type AppData = {
  app: "maintenance-inventory-tracker";
  version: string;
  lastSavedAt: string;
  items: InventoryItem[];
  locations: LocationRecord[];
  vendors: VendorRecord[];
  stockChanges: StockChange[];
  requisitionMadeRecords: RequisitionMadeRecord[];
  deletedRecords?: DeletedRecord[];
  auditLog: AuditEntry[];
  settings: AppSettings;
};
