import { openMaintenanceSqliteDatabase } from "./sqliteRuntime";

type CountRow = {
  count: number;
};

type SqliteTableRow = {
  name: string;
};

type MetadataValueRow = {
  value: string;
};

const SQLITE_HEALTH_TABLES = [
  "vendors",
  "locations",
  "inventory_items",
  "stock_ledger",
  "requisitions",
  "requisition_lines",
  "reorder_history",
  "deleted_records",
  "app_settings"
] as const;

type SqliteHealthTableName = (typeof SQLITE_HEALTH_TABLES)[number];

export type SqliteHealthCheckResult = {
  checkedAt: string;
  counts: Record<SqliteHealthTableName, number | null>;
  errors: string[];
  metadataTableExists: boolean;
  schemaVersion: string | null;
  sqliteAvailable: boolean;
  tableNames: string[];
};

function hasTauriRuntime() {
  return typeof window !== "undefined" && Boolean((window as Window & { __TAURI__?: unknown }).__TAURI__);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function blankCounts(): Record<SqliteHealthTableName, number | null> {
  return SQLITE_HEALTH_TABLES.reduce(
    (counts, tableName) => ({
      ...counts,
      [tableName]: null
    }),
    {} as Record<SqliteHealthTableName, number | null>
  );
}

export async function runSqliteHealthCheck(): Promise<SqliteHealthCheckResult> {
  const checkedAt = new Date().toISOString();
  const counts = blankCounts();
  const errors: string[] = [];

  if (!hasTauriRuntime()) {
    return {
      checkedAt,
      counts,
      errors: ["Tauri runtime is not available."],
      metadataTableExists: false,
      schemaVersion: null,
      sqliteAvailable: false,
      tableNames: []
    };
  }

  try {
    const db = await openMaintenanceSqliteDatabase();
    const tables = await db.select<SqliteTableRow[]>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    );
    const tableNames = tables.map((table) => table.name);
    const metadataTableExists = tableNames.includes("metadata");
    let schemaVersion: string | null = null;

    if (metadataTableExists) {
      try {
        const rows = await db.select<MetadataValueRow[]>(
          "SELECT value FROM metadata WHERE key = ? LIMIT 1",
          ["schema_version"]
        );

        schemaVersion = rows[0]?.value ?? null;
      } catch (error) {
        errors.push(`metadata.schema_version: ${errorMessage(error)}`);
      }
    } else {
      errors.push("metadata: missing table");
    }

    for (const tableName of SQLITE_HEALTH_TABLES) {
      if (!tableNames.includes(tableName)) {
        errors.push(`${tableName}: missing table`);
        continue;
      }

      try {
        const rows = await db.select<CountRow[]>(`SELECT COUNT(*) AS count FROM ${tableName}`);

        counts[tableName] = rows[0]?.count ?? 0;
      } catch (error) {
        errors.push(`${tableName}: ${errorMessage(error)}`);
      }
    }

    return {
      checkedAt,
      counts,
      errors,
      metadataTableExists,
      schemaVersion,
      sqliteAvailable: true,
      tableNames
    };
  } catch (error) {
    return {
      checkedAt,
      counts,
      errors: [errorMessage(error)],
      metadataTableExists: false,
      schemaVersion: null,
      sqliteAvailable: false,
      tableNames: []
    };
  }
}
