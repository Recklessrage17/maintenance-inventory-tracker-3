import type { AppData, BackupDirectoryHandle } from "../types";

export const BACKUP_LATEST_FILENAME = "maintenance-inventory-tracker-latest.json";
export const BACKUP_RECOMMENDED_FOLDER =
  "OneDrive\\Company - Files - 2.0\\JBT USA - Files\\Dash Board - Info\\Inventoy System app\\maintenance-inventory-tracker\\Backups";

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type TauriWindow = Window & {
  __TAURI__?: {
    core?: {
      invoke?: TauriInvoke;
    };
  };
};

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<BackupDirectoryHandle>;
};

type TauriBackupWriteResult = {
  lastModifiedMs: number | null;
};

type TauriBackupReadResult = {
  contents: string;
  lastModifiedMs: number | null;
};

export type BackupDirectorySelection = {
  directoryHandle: BackupDirectoryHandle | null;
  directoryName: string;
  directoryPath: string;
};

export type BackupFileReadResult = {
  contents: string;
  lastModifiedAt: string | null;
};

export type InventoryBackupPayload = {
  app: "maintenance-inventory-tracker";
  appVersion?: string;
  backupTimestamp?: string;
  backupVersion?: number;
  exportedAt?: string;
  lastBackupTimestamp?: string;
  lastSavedAt?: string;
  lastUpdated?: string;
  version?: string;
  items: unknown[];
  locations: unknown[];
  vendors: unknown[];
  stockChanges: unknown[];
  requisitionMadeRecords?: unknown[];
  deletedRecords?: unknown[];
  auditLog: unknown[];
  settings: Record<string, unknown>;
};

const getTauriInvoke = (): TauriInvoke | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }

  return (window as TauriWindow).__TAURI__?.core?.invoke;
};

export const isFileSystemBackupSupported = () =>
  Boolean(getTauriInvoke()) ||
  (typeof window !== "undefined" &&
    typeof (window as DirectoryPickerWindow).showDirectoryPicker === "function");

export const chooseBackupDirectory = async (): Promise<BackupDirectorySelection> => {
  const invoke = getTauriInvoke();

  if (invoke) {
    const directoryPath = await invoke<string | null>("choose_backup_directory");

    if (!directoryPath) {
      throw new Error("No backup folder selected.");
    }

    return {
      directoryHandle: null,
      directoryName: directoryPath,
      directoryPath
    };
  }

  const directoryPicker = (window as DirectoryPickerWindow).showDirectoryPicker;

  if (!directoryPicker) {
    throw new Error("Auto folder backup is unavailable here. Use Export JSON manually.");
  }

  const directoryHandle = await directoryPicker({ mode: "readwrite" });

  return {
    directoryHandle,
    directoryName: directoryHandle.name ?? "Selected folder",
    directoryPath: ""
  };
};

export const ensureBackupPermission = async (
  directoryHandle: BackupDirectoryHandle,
  requestAccess: boolean
) => {
  const descriptor = { mode: "readwrite" as const };
  const currentPermission = directoryHandle.queryPermission
    ? await directoryHandle.queryPermission(descriptor)
    : "granted";

  if (currentPermission === "granted") {
    return true;
  }

  if (!requestAccess || !directoryHandle.requestPermission) {
    return false;
  }

  return (await directoryHandle.requestPermission(descriptor)) === "granted";
};

export const createBackupPayload = (data: AppData, backupAt = new Date().toISOString()) => {
  const { backupDirectoryHandle: _backupDirectoryHandle, ...portableSettings } = data.settings;

  return {
    app: data.app,
    appVersion: data.version,
    version: data.version,
    backupVersion: 1,
    backupTimestamp: backupAt,
    exportedAt: backupAt,
    lastBackupTimestamp: backupAt,
    lastUpdated: backupAt,
    items: data.items,
    locations: data.locations,
    vendors: data.vendors,
    stockChanges: data.stockChanges,
    requisitionMadeRecords: data.requisitionMadeRecords,
    deletedRecords: data.deletedRecords ?? [],
    auditLog: data.auditLog,
    settings: {
      ...portableSettings,
      backupStatus: `Backed up ${backupAt}`,
      lastBackupTimestamp: backupAt,
      updatedAt: backupAt
    }
  };
};

export const writeBackupFile = async (
  backupTarget: Pick<AppData["settings"], "backupDirectoryHandle" | "backupDirectoryPath">,
  payload: unknown
) => {
  const contents = JSON.stringify(payload, null, 2);
  const invoke = getTauriInvoke();

  if (backupTarget.backupDirectoryPath && invoke) {
    const result = await invoke<TauriBackupWriteResult>("write_backup_file", {
      contents,
      directoryPath: backupTarget.backupDirectoryPath,
      fileName: BACKUP_LATEST_FILENAME
    });

    return {
      lastModifiedAt: result.lastModifiedMs ? new Date(result.lastModifiedMs).toISOString() : null
    };
  }

  if (!backupTarget.backupDirectoryHandle) {
    throw new Error("Choose a backup folder first.");
  }

  const hasPermission = await ensureBackupPermission(backupTarget.backupDirectoryHandle, true);

  if (!hasPermission) {
    throw new Error("Backup folder permission was denied.");
  }

  const fileHandle = await backupTarget.backupDirectoryHandle.getFileHandle(BACKUP_LATEST_FILENAME, {
    create: true
  });
  const writable = await fileHandle.createWritable();

  await writable.write(contents);
  await writable.close();

  const file = fileHandle.getFile ? await fileHandle.getFile() : null;

  return {
    lastModifiedAt: file ? new Date(file.lastModified).toISOString() : null
  };
};

export const readBackupFile = async (
  backupTarget: Pick<AppData["settings"], "backupDirectoryHandle" | "backupDirectoryPath">,
  requestAccess = true
): Promise<BackupFileReadResult> => {
  const invoke = getTauriInvoke();

  if (backupTarget.backupDirectoryPath && invoke) {
    const result = await invoke<TauriBackupReadResult>("read_backup_file", {
      directoryPath: backupTarget.backupDirectoryPath,
      fileName: BACKUP_LATEST_FILENAME
    });

    return {
      contents: result.contents,
      lastModifiedAt: result.lastModifiedMs ? new Date(result.lastModifiedMs).toISOString() : null
    };
  }

  if (!backupTarget.backupDirectoryHandle) {
    throw new Error("Choose a backup folder first.");
  }

  const hasPermission = await ensureBackupPermission(backupTarget.backupDirectoryHandle, requestAccess);

  if (!hasPermission) {
    throw new Error("Backup folder permission is missing. Please choose the folder again.");
  }

  try {
    const fileHandle = await backupTarget.backupDirectoryHandle.getFileHandle(BACKUP_LATEST_FILENAME);
    const file = fileHandle.getFile ? await fileHandle.getFile() : null;

    if (!file) {
      throw new Error("Could not read backup file from this folder.");
    }

    return {
      contents: await file.text(),
      lastModifiedAt: new Date(file.lastModified).toISOString()
    };
  } catch (error) {
    if (isMissingBackupFileError(error)) {
      throw new Error("No backup file found.");
    }

    throw error;
  }
};

export const isMissingBackupFileError = (error: unknown) => {
  if (!(error instanceof Error)) {
    return false;
  }

  return /no backup file|not found|notfound|not exist|could not find/i.test(error.message);
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export const validateBackupPayload = (value: unknown): InventoryBackupPayload => {
  const raw = asRecord(value);
  const settings = asRecord(raw.settings);

  if (
    raw.app !== "maintenance-inventory-tracker" ||
    !Array.isArray(raw.items) ||
    !Array.isArray(raw.locations) ||
    !Array.isArray(raw.vendors) ||
    !Array.isArray(raw.stockChanges) ||
    !Array.isArray(raw.auditLog) ||
    !Object.keys(settings).length
  ) {
    throw new Error("This is not a valid Maintenance Inventory Tracker backup file.");
  }

  return raw as InventoryBackupPayload;
};

const timestampMs = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const parsed = new Date(value).getTime();

  return Number.isFinite(parsed) ? parsed : null;
};

const newestTimestamp = (values: unknown[]) => {
  const newest = values.reduce<number | null>((latest, value) => {
    const parsed = timestampMs(value);

    if (parsed === null) {
      return latest;
    }

    return latest === null || parsed > latest ? parsed : latest;
  }, null);

  return newest === null ? null : new Date(newest).toISOString();
};

export const getBackupUpdatedAt = (payload: unknown, fileLastModifiedAt?: string | null) => {
  const raw = asRecord(payload);

  return newestTimestamp([
    raw.backupTimestamp,
    raw.lastBackupTimestamp,
    raw.lastUpdated,
    raw.exportedAt,
    raw.lastSavedAt,
    fileLastModifiedAt
  ]);
};

export const getLocalDataUpdatedAt = (data: AppData) => {
  const values: unknown[] = [
    data.lastSavedAt,
    data.settings.createdAt,
    data.settings.updatedAt,
    ...data.items.flatMap((item) => [item.createdAt, item.updatedAt]),
    ...data.locations.flatMap((location) => [location.createdAt, location.updatedAt]),
    ...data.vendors.flatMap((vendor) => [vendor.createdAt, vendor.updatedAt]),
    ...data.stockChanges.flatMap((change) => {
      const raw = change as unknown as Record<string, unknown>;

      return [raw.createdAt, raw.updatedAt];
    }),
    ...(data.deletedRecords ?? []).flatMap((record) => [record.deletedAt, record.expiresAt]),
    ...data.auditLog.flatMap((entry) => {
      const raw = entry as unknown as Record<string, unknown>;

      return [raw.createdAt, raw.updatedAt, entry.occurredAt];
    })
  ];

  return newestTimestamp(values);
};

export const isBackupNewerThanLocal = (backupUpdatedAt: string | null, localUpdatedAt: string | null) => {
  const backupTime = timestampMs(backupUpdatedAt);
  const localTime = timestampMs(localUpdatedAt);

  if (backupTime === null) {
    return false;
  }

  return localTime === null || backupTime > localTime;
};
