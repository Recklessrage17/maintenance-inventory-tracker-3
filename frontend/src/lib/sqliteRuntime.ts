import Database from "@tauri-apps/plugin-sql";

export const maintenanceSqliteConnection = "sqlite:maintenance_inventory_3.db";

type SqliteTableRow = {
  name: string;
};

type MetadataRow = {
  key: string;
  value: string;
  value_json: string | null;
};

export type SqliteRuntimeCheckResult = {
  connection: string;
  metadataTableExists: boolean;
  tableNames: string[];
  metadata: MetadataRow[];
};

function hasTauriRuntime() {
  return typeof window !== "undefined" && Boolean((window as Window & { __TAURI__?: unknown }).__TAURI__);
}

export async function openMaintenanceSqliteDatabase() {
  return Database.load(maintenanceSqliteConnection);
}

export async function checkMaintenanceSqliteRuntime(): Promise<SqliteRuntimeCheckResult> {
  const db = await openMaintenanceSqliteDatabase();
  const tables = await db.select<SqliteTableRow[]>(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
  );
  const tableNames = tables.map((table) => table.name);
  const metadataTableExists = tableNames.includes("metadata");
  const metadata = metadataTableExists
    ? await db.select<MetadataRow[]>("SELECT key, value, value_json FROM metadata ORDER BY key")
    : [];

  return {
    connection: maintenanceSqliteConnection,
    metadata,
    metadataTableExists,
    tableNames,
  };
}

export async function runDevSqliteRuntimeCheck() {
  if (!import.meta.env.DEV || !hasTauriRuntime()) {
    return null;
  }

  try {
    const result = await checkMaintenanceSqliteRuntime();
    console.info("[sqlite-runtime]", result);
    return result;
  } catch (error) {
    console.warn("[sqlite-runtime] SQLite runtime check failed.", error);
    return null;
  }
}
