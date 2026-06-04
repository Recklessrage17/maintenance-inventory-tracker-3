import type { AppSettings } from "../types";
import { openMaintenanceSqliteDatabase } from "./sqliteRuntime";

type CountRow = {
  count: number;
};

type SettingKeyRow = {
  key: string;
};

export type SqliteSettingsMirrorStatus = {
  error?: string;
  jsonSettingsKeyCount: number;
  sampleSettingKeys: string[];
  settingsMatch: boolean;
  sqliteAvailable: boolean;
  sqliteSettingsKeyCount: number;
};

function hasTauriRuntime() {
  return typeof window !== "undefined" && Boolean((window as Window & { __TAURI__?: unknown }).__TAURI__);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function settingKeys(settings: AppSettings) {
  return Object.keys(settings).sort();
}

function safeJson(value: unknown) {
  try {
    const serialized = JSON.stringify(value ?? null);

    return serialized === undefined ? "null" : serialized;
  } catch {
    return JSON.stringify({
      mirrorStatus: "non_json_serializable",
      type: typeof value
    });
  }
}

async function deleteSettingsRowsNotIn(keys: string[]) {
  const db = await openMaintenanceSqliteDatabase();

  if (keys.length === 0) {
    await db.execute("DELETE FROM app_settings");
    return;
  }

  const placeholders = keys.map(() => "?").join(", ");
  await db.execute(`DELETE FROM app_settings WHERE key NOT IN (${placeholders})`, keys);
}

export async function syncAppSettingsToSqlite(settings: AppSettings) {
  if (!hasTauriRuntime()) {
    return 0;
  }

  const keys = settingKeys(settings);
  await deleteSettingsRowsNotIn(keys);

  const db = await openMaintenanceSqliteDatabase();
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
      [key, safeJson(settings[key as keyof AppSettings]), `AppData.settings.${key}`, updatedAt]
    );
  }

  return countSqliteAppSettings();
}

export async function loadAppSettingsMirrorSample() {
  if (!hasTauriRuntime()) {
    return [];
  }

  const db = await openMaintenanceSqliteDatabase();
  const rows = await db.select<SettingKeyRow[]>(
    `SELECT key
    FROM app_settings
    ORDER BY key ASC
    LIMIT 10`
  );

  return rows.map((row) => row.key);
}

export async function countSqliteAppSettings() {
  if (!hasTauriRuntime()) {
    return 0;
  }

  const db = await openMaintenanceSqliteDatabase();
  const rows = await db.select<CountRow[]>("SELECT COUNT(*) AS count FROM app_settings");

  return rows[0]?.count ?? 0;
}

export async function getSqliteSettingsMirrorStatus(settings: AppSettings): Promise<SqliteSettingsMirrorStatus> {
  const jsonSettingsKeyCount = settingKeys(settings).length;

  if (!hasTauriRuntime()) {
    return {
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

    return {
      jsonSettingsKeyCount,
      sampleSettingKeys,
      settingsMatch: sqliteSettingsKeyCount === jsonSettingsKeyCount,
      sqliteAvailable: true,
      sqliteSettingsKeyCount
    };
  } catch (error) {
    return {
      error: errorMessage(error),
      jsonSettingsKeyCount,
      sampleSettingKeys: [],
      settingsMatch: false,
      sqliteAvailable: false,
      sqliteSettingsKeyCount: 0
    };
  }
}
