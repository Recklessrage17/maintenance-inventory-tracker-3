import type {
  AppData,
  InventoryItem,
  LocationRecord,
  StockChange,
  VendorRecord
} from "../types";
import type { InventoryBackupPayload } from "./backup";

export type DataAdapterKind = "json-local" | "sqlite-desktop" | "web-api";

export type BackupImportSource = "manual" | "folder" | "auto" | "api";

export type BackupImportRequest = {
  fileName?: string;
  payload: InventoryBackupPayload;
  source: BackupImportSource;
};

export type StockChangeSaveRequest = {
  nextData: AppData;
  stockChange: StockChange;
};

export interface AppDataRepository {
  readonly kind: DataAdapterKind;

  loadAppData(): Promise<AppData | undefined>;
  saveAppData(data: AppData): Promise<void>;

  exportBackup(data: AppData): Promise<InventoryBackupPayload>;
  importBackup(request: BackupImportRequest): Promise<AppData>;

  listInventoryItems(): Promise<InventoryItem[]>;
  listVendors(): Promise<VendorRecord[]>;
  listLocations(): Promise<LocationRecord[]>;
  saveStockChange(request: StockChangeSaveRequest): Promise<void>;
}
