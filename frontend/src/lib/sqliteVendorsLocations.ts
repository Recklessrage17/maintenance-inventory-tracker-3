import type { LocationRecord, VendorRecord } from "../types";
import { openMaintenanceSqliteDatabase } from "./sqliteRuntime";

type CountRow = {
  count: number;
};

export type SqliteVendorLocationStatus = {
  jsonLocationCount: number;
  jsonVendorCount: number;
  locationCountsMatch: boolean;
  sqliteLocationCount: number;
  sqliteVendorCount: number;
  skipped: boolean;
  vendorCountsMatch: boolean;
};

function hasTauriRuntime() {
  return typeof window !== "undefined" && Boolean((window as Window & { __TAURI__?: unknown }).__TAURI__);
}

async function countTable(tableName: "locations" | "vendors") {
  const db = await openMaintenanceSqliteDatabase();
  const rows = await db.select<CountRow[]>(`SELECT COUNT(*) AS count FROM ${tableName}`);

  return rows[0]?.count ?? 0;
}

async function deleteRowsNotIn(tableName: "locations" | "vendors", ids: string[]) {
  const db = await openMaintenanceSqliteDatabase();

  if (ids.length === 0) {
    await db.execute(`DELETE FROM ${tableName}`);
    return;
  }

  const placeholders = ids.map(() => "?").join(", ");
  await db.execute(`DELETE FROM ${tableName} WHERE id NOT IN (${placeholders})`, ids);
}

export async function syncVendorsToSqlite(vendors: VendorRecord[]) {
  const db = await openMaintenanceSqliteDatabase();

  await deleteRowsNotIn(
    "vendors",
    vendors.map((vendor) => vendor.id)
  );

  for (const vendor of vendors) {
    await db.execute(
      `INSERT INTO vendors (
        id,
        name,
        contact_name,
        phone,
        email,
        website,
        notes,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        contact_name = excluded.contact_name,
        phone = excluded.phone,
        email = excluded.email,
        website = excluded.website,
        notes = excluded.notes,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at`,
      [
        vendor.id,
        vendor.name,
        vendor.contactName,
        vendor.phone,
        vendor.email,
        vendor.website,
        vendor.notes,
        vendor.createdAt,
        vendor.updatedAt
      ]
    );
  }

  return countSqliteVendors();
}

export async function syncLocationsToSqlite(locations: LocationRecord[]) {
  const db = await openMaintenanceSqliteDatabase();

  await deleteRowsNotIn(
    "locations",
    locations.map((location) => location.id)
  );

  for (const location of locations) {
    await db.execute(
      `INSERT INTO locations (
        id,
        name,
        description,
        notes,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        notes = excluded.notes,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at`,
      [
        location.id,
        location.name,
        location.description,
        location.notes,
        location.createdAt,
        location.updatedAt
      ]
    );
  }

  return countSqliteLocations();
}

export async function countSqliteVendors() {
  return countTable("vendors");
}

export async function countSqliteLocations() {
  return countTable("locations");
}

export async function getSqliteVendorLocationStatus(
  vendors: VendorRecord[],
  locations: LocationRecord[]
): Promise<SqliteVendorLocationStatus> {
  if (!hasTauriRuntime()) {
    return {
      jsonLocationCount: locations.length,
      jsonVendorCount: vendors.length,
      locationCountsMatch: false,
      sqliteLocationCount: 0,
      sqliteVendorCount: 0,
      skipped: true,
      vendorCountsMatch: false
    };
  }

  const sqliteVendorCount = await syncVendorsToSqlite(vendors);
  const sqliteLocationCount = await syncLocationsToSqlite(locations);

  return {
    jsonLocationCount: locations.length,
    jsonVendorCount: vendors.length,
    locationCountsMatch: sqliteLocationCount === locations.length,
    sqliteLocationCount,
    sqliteVendorCount,
    skipped: false,
    vendorCountsMatch: sqliteVendorCount === vendors.length
  };
}
