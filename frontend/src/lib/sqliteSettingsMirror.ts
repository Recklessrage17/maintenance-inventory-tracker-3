import type { AppSettings, BackupInterval } from "../types";
import { openMaintenanceSqliteDatabase } from "./sqliteRuntime";

type SqliteDatabase = Awaited<ReturnType<typeof openMaintenanceSqliteDatabase>>;

type CountRow = {
  count: number;
};

type SettingKeyRow = {
  key: string;
};

type SettingValueRow = SettingKeyRow & {
  value_json: string | null;
};

const SETTINGS_DESCRIPTION_PREFIX = "AppData.settings.";

const SQLITE_APP_SETTING_KEYS = [
  "id",
  "companyShopName",
  "headerBadgeText",
  "defaultLocationId",
  "lowStockWarningsEnabled",
  "lowStockIncludeEqual",
  "allowNegativeStockOverride",
  "backupEnabled",
  "backupInterval",
  "autoImportEnabled",
  "backupDirectoryName",
  "backupDirectoryPath",
  "lastBackupTimestamp",
  "lastAutoImportTimestamp",
  "backupStatus",
  "watchListDefaultsMigratedAt",
  "createdAt",
  "updatedAt"
] as const;

type SqliteAppSettingKey = (typeof SQLITE_APP_SETTING_KEYS)[number];

export type SqliteSettingsMirrorStatus = {
  activeSettingsSource: "json" | "sqlite";
  error?: string;
  jsonSettingsKeyCount: number;
  sampleSettingKeys: string[];
  settingsMatch: boolean;
  sqliteAvailable: boolean;
  sqliteSettingsKeyCount: number;
};

export type SqliteSettingsActivationResult = SqliteSettingsMirrorStatus & {
  settings: AppSettings;
};

function hasTauriRuntime() {
  return typeof window !== "undefined" && Boolean((window as Window & { __TAURI__?: unknown }).__TAURI__);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function settingKeys() {
  return [...SQLITE_APP_SETTING_KEYS];
}

function keyPlaceholders(keys: readonly string[]) {
  return keys.map(() => "?").join(", ");
}

function isSqliteAppSettingKey(key: string): key is SqliteAppSettingKey {
  return (SQLITE_APP_SETTING_KEYS as readonly string[]).includes(key);
}

function textSetting(value: unknown, fallback = "") {
  return value === undefined || value === null ? fallback : String(value);
}

function booleanSetting(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function backupIntervalSetting(value: unknown, fallback: BackupInterval): BackupInterval {
  return value === "manual" || value === "5min" || value === "15min" || value === "change" ? value : fallback;
}

function parseJson(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function safeJson(value: unknown) {
  try {
    const serialized = JSON.stringify(value ?? null);

    return serialized === undefined ? "null" : serialized;
  } catch {
    return "null";
  }
}

function normalizeSettingValue(key: SqliteAppSettingKey, value: unknown, fallbackSettings: AppSettings) {
  switch (key) {
    case "id":
      return "appSettings";
    case "lowStockWarningsEnabled":
    case "lowStockIncludeEqual":
    case "allowNegativeStockOverride":
    case "backupEnabled":
    case "autoImportEnabled":
      return booleanSetting(value, fallbackSettings[key]);
    case "backupInterval":
      return backupIntervalSetting(value, fallbackSettings.backupInterval);
    case "companyShopName":
    case "headerBadgeText":
    case "defaultLocationId":
    case "backupDirectoryName":
    case "backupDirectoryPath":
    case "lastBackupTimestamp":
    case "lastAutoImportTimestamp":
    case "backupStatus":
    case "watchListDefaultsMigratedAt":
    case "createdAt":
    case "updatedAt":
      return textSetting(value, fallbackSettings[key]);
  }
}

async function deleteStaleSettingsRows(db: SqliteDatabase, keys: readonly string[]) {
  if (keys.length === 0) {
    return;
  }

  await db.execute(
    `DELETE FROM app_settings
    WHERE description LIKE ?
      AND key NOT IN (${keyPlaceholders(keys)})`,
    [`${SETTINGS_DESCRIPTION_PREFIX}%`, ...keys]
  );
}

async function loadSettingRows(keys = settingKeys()) {
  if (!hasTauriRuntime() || keys.length === 0) {
    return [];
  }

  const db = await openMaintenanceSqliteDatabase();

  return db.select<SettingValueRow[]>(
    `SELECT key, value_json
    FROM app_settings
    WHERE key IN (${keyPlaceholders(keys)})
    ORDER BY key ASC`,
    keys
  );
}

async function saveSettingKeysToSqlite(db: SqliteDatabase, settings: AppSettings, keys: readonly SqliteAppSettingKey[]) {
  const updatedAt = settings.updatedAt || new Date().toISOString();

  for (const key of keys) {
    await db.execute(
      `INSERT INTO app_settings (
        key,
        value_json,
        description,
        updated_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        description = excluded.description,
        updated_at = excluded.updated_at`,
      [key, safeJson(settings[key]), `${SETTINGS_DESCRIPTION_PREFIX}${key}`, updatedAt]
    );
  }
}

function settingsMatchSqliteRows(settings: AppSettings, rows: SettingValueRow[]) {
  if (rows.length !== SQLITE_APP_SETTING_KEYS.length) {
    return false;
  }

  const rowsByKey = new Map(rows.map((row) => [row.key, row]));

  return SQLITE_APP_SETTING_KEYS.every((key) => {
    const row = rowsByKey.get(key);

    if (!row) {
      return false;
    }

    const sqliteValue = normalizeSettingValue(key, parseJson(row.value_json), settings);

    return safeJson(sqliteValue) === safeJson(settings[key]);
  });
}

export async function loadAppSettingsFromSqlite(fallbackSettings: AppSettings): Promise<AppSettings> {
  if (!hasTauriRuntime()) {
    return fallbackSettings;
  }

  const rows = await loadSettingRows();
  const nextSettings: AppSettings = {
    ...fallbackSettings,
    backupDirectoryHandle: fallbackSettings.backupDirectoryHandle
  };

  for (const row of rows) {
    if (!isSqliteAppSettingKey(row.key)) {
      continue;
    }

    nextSettings[row.key] = normalizeSettingValue(row.key, parseJson(row.value_json), fallbackSettings) as never;
  }

  return nextSettings;
}

export async function saveAppSettingsToSqlite(settings: AppSettings) {
  if (!hasTauriRuntime()) {
    return 0;
  }

  const db = await openMaintenanceSqliteDatabase();
  await saveSettingKeysToSqlite(db, settings, SQLITE_APP_SETTING_KEYS);

  return countSqliteAppSettings();
}

export async function syncAppSettingsToSqlite(settings: AppSettings) {
  if (!hasTauriRuntime()) {
    return 0;
  }

  const db = await openMaintenanceSqliteDatabase();
  await deleteStaleSettingsRows(db, SQLITE_APP_SETTING_KEYS);
  await saveSettingKeysToSqlite(db, settings, SQLITE_APP_SETTING_KEYS);

  return countSqliteAppSettings();
}

export async function activateAppSettingsSqliteState(settings: AppSettings): Promise<SqliteSettingsActivationResult> {
  const jsonSettingsKeyCount = settingKeys().length;

  if (!hasTauriRuntime()) {
    return {
      activeSettingsSource: "json",
      jsonSettingsKeyCount,
      sampleSettingKeys: [],
      settings,
      settingsMatch: false,
      sqliteAvailable: false,
      sqliteSettingsKeyCount: 0
    };
  }

  try {
    const rows = await loadSettingRows();
    const existingKeys = new Set(rows.map((row) => row.key).filter(isSqliteAppSettingKey));
    const missingKeys = SQLITE_APP_SETTING_KEYS.filter((key) => !existingKeys.has(key));
    const db = await openMaintenanceSqliteDatabase();

    await deleteStaleSettingsRows(db, SQLITE_APP_SETTING_KEYS);

    if (existingKeys.size === 0) {
      await saveSettingKeysToSqlite(db, settings, SQLITE_APP_SETTING_KEYS);
    } else if (missingKeys.length > 0) {
      await saveSettingKeysToSqlite(db, settings, missingKeys);
    }

    const sqliteSettings = await loadAppSettingsFromSqlite(settings);
    const sqliteRows = await loadSettingRows();
    const sqliteSettingsKeyCount = await countSqliteAppSettings();
    const sampleSettingKeys = await loadAppSettingsMirrorSample();

    return {
      activeSettingsSource: "sqlite",
      jsonSettingsKeyCount,
      sampleSettingKeys,
      settings: sqliteSettings,
      settingsMatch: settingsMatchSqliteRows(sqliteSettings, sqliteRows) && sqliteSettingsKeyCount === jsonSettingsKeyCount,
      sqliteAvailable: true,
      sqliteSettingsKeyCount
    };
  } catch (error) {
    return {
      activeSettingsSource: "json",
      error: errorMessage(error),
      jsonSettingsKeyCount,
      sampleSettingKeys: [],
      settings,
      settingsMatch: false,
      sqliteAvailable: false,
      sqliteSettingsKeyCount: 0
    };
  }
}

export async function loadAppSettingsMirrorSample() {
  if (!hasTauriRuntime()) {
    return [];
  }

  const keys = settingKeys();
  const db = await openMaintenanceSqliteDatabase();
  const rows = await db.select<SettingKeyRow[]>(
    `SELECT key
    FROM app_settings
    WHERE key IN (${keyPlaceholders(keys)})
    ORDER BY key ASC
    LIMIT 10`,
    keys
  );

  return rows.map((row) => row.key);
}

export async function countSqliteAppSettings() {
  if (!hasTauriRuntime()) {
    return 0;
  }

  const keys = settingKeys();
  const db = await openMaintenanceSqliteDatabase();
  const rows = await db.select<CountRow[]>(
    `SELECT COUNT(*) AS count
    FROM app_settings
    WHERE key IN (${keyPlaceholders(keys)})`,
    keys
  );

  return rows[0]?.count ?? 0;
}

export async function getSqliteSettingsMirrorStatus(settings: AppSettings): Promise<SqliteSettingsMirrorStatus> {
  const jsonSettingsKeyCount = settingKeys().length;

  if (!hasTauriRuntime()) {
    return {
      activeSettingsSource: "json",
      jsonSettingsKeyCount,
      sampleSettingKeys: [],
      settingsMatch: false,
      sqliteAvailable: false,
      sqliteSettingsKeyCount: 0
    };
  }

  try {
    const sqliteSettingsKeyCount = await syncAppSettingsToSqlite(settings);
    const sampleSettingKeys = await loadAppSettingsMirrorSample();
    const sqliteRows = await loadSettingRows();

    return {
      activeSettingsSource: "sqlite",
      jsonSettingsKeyCount,
      sampleSettingKeys,
      settingsMatch: settingsMatchSqliteRows(settings, sqliteRows) && sqliteSettingsKeyCount === jsonSettingsKeyCount,
      sqliteAvailable: true,
      sqliteSettingsKeyCount
    };
  } catch (error) {
    return {
      activeSettingsSource: "json",
      error: errorMessage(error),
      jsonSettingsKeyCount,
      sampleSettingKeys: [],
      settingsMatch: false,
      sqliteAvailable: false,
      sqliteSettingsKeyCount: 0
    };
  }
}
