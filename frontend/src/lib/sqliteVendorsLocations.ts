import type { LocationRecord, VendorRecord } from "../types";
import { openMaintenanceSqliteDatabase } from "./sqliteRuntime";

type CountRow = {
  count: number;
};

type SqliteVendorRow = {
  contact_email: string | null;
  contact_name: string | null;
  created_at: string;
  email: string | null;
  id: string;
  name: string;
  notes: string | null;
  phone: string | null;
  updated_at: string;
  website: string | null;
};

type SqliteLocationRow = {
  created_at: string;
  description: string | null;
  id: string;
  name: string;
  notes: string | null;
  updated_at: string;
};

export type SqliteVendorLocationStatus = {
  activeLocationSource: "json" | "sqlite";
  activeVendorSource: "json" | "sqlite";
  jsonLocationCount: number;
  jsonVendorCount: number;
  locationsMatch: boolean;
  skipped: boolean;
  sqliteLocationCount: number;
  sqliteVendorCount: number;
  vendorsMatch: boolean;
};

export type SqliteVendorLocationActivationResult = SqliteVendorLocationStatus & {
  locations: LocationRecord[];
  vendors: VendorRecord[];
};

function hasTauriRuntime() {
  return typeof window !== "undefined" && Boolean((window as Window & { __TAURI__?: unknown }).__TAURI__);
}

function skippedResult(vendors: VendorRecord[], locations: LocationRecord[]): SqliteVendorLocationActivationResult {
  return {
    activeLocationSource: "json",
    activeVendorSource: "json",
    jsonLocationCount: locations.length,
    jsonVendorCount: vendors.length,
    locations,
    locationsMatch: false,
    skipped: true,
    sqliteLocationCount: 0,
    sqliteVendorCount: 0,
    vendors,
    vendorsMatch: false
  };
}

function vendorFromSqlite(row: SqliteVendorRow): VendorRecord {
  return {
    id: row.id,
    name: row.name,
    contactName: row.contact_name ?? "",
    contactEmail: row.contact_email ?? "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    website: row.website ?? "",
    notes: row.notes ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function locationFromSqlite(row: SqliteLocationRow): LocationRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    notes: row.notes ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function orderBySource<T extends { id: string }>(source: T[], loaded: T[]) {
  const sourceOrder = new Map(source.map((record, index) => [record.id, index]));

  return [...loaded].sort((left, right) => {
    const leftIndex = sourceOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = sourceOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER;

    return leftIndex - rightIndex || left.id.localeCompare(right.id);
  });
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

export async function loadVendorsFromSqlite(): Promise<VendorRecord[]> {
  const db = await openMaintenanceSqliteDatabase();
  const rows = await db.select<SqliteVendorRow[]>(
    `SELECT
      id,
      name,
      contact_name,
      contact_email,
      phone,
      email,
      website,
      notes,
      created_at,
      updated_at
    FROM vendors`
  );

  return rows.map(vendorFromSqlite);
}

export async function saveVendorToSqlite(vendor: VendorRecord) {
  const db = await openMaintenanceSqliteDatabase();

  await db.execute(
    `INSERT INTO vendors (
      id,
      name,
      contact_name,
      contact_email,
      phone,
      email,
      website,
      notes,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      contact_name = excluded.contact_name,
      contact_email = excluded.contact_email,
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
      vendor.contactEmail,
      vendor.phone,
      vendor.email,
      vendor.website,
      vendor.notes,
      vendor.createdAt,
      vendor.updatedAt
    ]
  );
}

export async function deleteVendorFromSqlite(vendorId: string) {
  const db = await openMaintenanceSqliteDatabase();

  await db.execute("DELETE FROM vendors WHERE id = ?", [vendorId]);
}

export async function loadLocationsFromSqlite(): Promise<LocationRecord[]> {
  const db = await openMaintenanceSqliteDatabase();
  const rows = await db.select<SqliteLocationRow[]>(
    `SELECT
      id,
      name,
      description,
      notes,
      created_at,
      updated_at
    FROM locations`
  );

  return rows.map(locationFromSqlite);
}

export async function saveLocationToSqlite(location: LocationRecord) {
  const db = await openMaintenanceSqliteDatabase();

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

export async function deleteLocationFromSqlite(locationId: string) {
  const db = await openMaintenanceSqliteDatabase();

  await db.execute("DELETE FROM locations WHERE id = ?", [locationId]);
}

export async function syncVendorsToSqlite(vendors: VendorRecord[]) {
  await deleteRowsNotIn(
    "vendors",
    vendors.map((vendor) => vendor.id)
  );

  for (const vendor of vendors) {
    await saveVendorToSqlite(vendor);
  }

  return countSqliteVendors();
}

export async function syncLocationsToSqlite(locations: LocationRecord[]) {
  await deleteRowsNotIn(
    "locations",
    locations.map((location) => location.id)
  );

  for (const location of locations) {
    await saveLocationToSqlite(location);
  }

  return countSqliteLocations();
}

export async function countSqliteVendors() {
  return countTable("vendors");
}

export async function countSqliteLocations() {
  return countTable("locations");
}

export async function syncVendorLocationStateToSqlite(
  vendors: VendorRecord[],
  locations: LocationRecord[]
): Promise<SqliteVendorLocationStatus> {
  if (!hasTauriRuntime()) {
    return skippedResult(vendors, locations);
  }

  const sqliteVendorCount = await syncVendorsToSqlite(vendors);
  const sqliteLocationCount = await syncLocationsToSqlite(locations);

  return {
    activeLocationSource: "sqlite",
    activeVendorSource: "sqlite",
    jsonLocationCount: locations.length,
    jsonVendorCount: vendors.length,
    locationsMatch: sqliteLocationCount === locations.length,
    skipped: false,
    sqliteLocationCount,
    sqliteVendorCount,
    vendorsMatch: sqliteVendorCount === vendors.length
  };
}

export async function activateVendorLocationSqliteState(
  vendors: VendorRecord[],
  locations: LocationRecord[]
): Promise<SqliteVendorLocationActivationResult> {
  if (!hasTauriRuntime()) {
    return skippedResult(vendors, locations);
  }

  const existingSqliteVendorCount = await countSqliteVendors();
  const existingSqliteLocationCount = await countSqliteLocations();

  if (existingSqliteVendorCount === 0 && vendors.length > 0) {
    await syncVendorsToSqlite(vendors);
  }

  if (existingSqliteLocationCount === 0 && locations.length > 0) {
    await syncLocationsToSqlite(locations);
  }

  const sqliteVendors = orderBySource(vendors, await loadVendorsFromSqlite());
  const sqliteLocations = orderBySource(locations, await loadLocationsFromSqlite());
  const sqliteVendorCount = sqliteVendors.length;
  const sqliteLocationCount = sqliteLocations.length;

  return {
    activeLocationSource: "sqlite",
    activeVendorSource: "sqlite",
    jsonLocationCount: locations.length,
    jsonVendorCount: vendors.length,
    locations: sqliteLocations,
    locationsMatch: sqliteLocationCount === locations.length,
    skipped: false,
    sqliteLocationCount,
    sqliteVendorCount,
    vendors: sqliteVendors,
    vendorsMatch: sqliteVendorCount === vendors.length
  };
}

export async function getSqliteVendorLocationStatus(
  vendors: VendorRecord[],
  locations: LocationRecord[]
): Promise<SqliteVendorLocationStatus> {
  return syncVendorLocationStateToSqlite(vendors, locations);
}
