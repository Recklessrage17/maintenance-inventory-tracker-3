import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { runMigrations } from "./schema.js";

const DB_PATH = process.env.MIT3_DB_PATH ?? path.resolve(process.cwd(), "data", "maintenance_inventory_3_web.db");
const SNAPSHOT_KEY = "app";

let dbInstance: Database.Database | null = null;

export type AppData = {
  app: "maintenance-inventory-tracker";
  version: string;
  lastSavedAt: string;
  items: unknown[];
  locations: unknown[];
  vendors: unknown[];
  stockChanges: unknown[];
  requisitionMadeRecords: unknown[];
  deletedRecords?: unknown[];
  auditLog: unknown[];
  settings: Record<string, unknown>;
};

function ensureParentFolder(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function getDatabase() {
  if (!dbInstance) {
    ensureParentFolder(DB_PATH);
    dbInstance = new Database(DB_PATH);
    dbInstance.pragma("journal_mode = WAL");
    dbInstance.pragma("foreign_keys = ON");
    runMigrations(dbInstance);
  }

  return dbInstance;
}

export function getDatabasePath() {
  return DB_PATH;
}

export function loadAppDataFromSqlite(): AppData | null {
  const db = getDatabase();
  const row = db
    .prepare("SELECT value_json FROM app_snapshots WHERE key = ? LIMIT 1")
    .get(SNAPSHOT_KEY) as { value_json: string } | undefined;

  return row ? (JSON.parse(row.value_json) as AppData) : null;
}

export function saveAppDataSnapshot(data: AppData) {
  const db = getDatabase();
  const savedAt = new Date().toISOString();
  const snapshot = {
    ...data,
    lastSavedAt: data.lastSavedAt || savedAt,
    deletedRecords: data.deletedRecords ?? []
  };

  db.prepare(
    `INSERT INTO app_snapshots (key, value_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
  ).run(SNAPSHOT_KEY, JSON.stringify(snapshot), savedAt);

  db.prepare(
    `INSERT INTO app_settings (key, value_json, description, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
  ).run("app", JSON.stringify(snapshot.settings), "Current app settings", savedAt);

  return { savedAt };
}

export function getHealthCounts() {
  const db = getDatabase();
  const tables = [
    "vendors",
    "locations",
    "inventory_items",
    "stock_ledger",
    "requisitions",
    "requisition_lines",
    "deleted_records",
    "audit_log",
    "app_snapshots"
  ];

  return Object.fromEntries(
    tables.map((table) => {
      const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
      return [table, row.count];
    })
  );
}
