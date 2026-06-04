import type { DeletedRecord } from "../types";
import { openMaintenanceSqliteDatabase } from "./sqliteRuntime";

type SqliteDatabase = Awaited<ReturnType<typeof openMaintenanceSqliteDatabase>>;

type CountRow = {
  count: number;
};

type TrashMirrorSampleRow = {
  deleted_at: string;
  deleted_by: string | null;
  expires_at: string | null;
  id: string;
  record_id: string;
  record_type: string;
  title: string | null;
};

export type TrashMirrorSample = {
  deletedAt: string;
  deletedBy: string;
  expiresAt: string;
  id: string;
  recordId: string;
  recordType: string;
  title: string;
};

export type SqliteTrashMirrorStatus = {
  deletedRecordsMatch: boolean;
  error?: string;
  jsonDeletedRecordCount: number;
  sampleRecordIds: string[];
  sampleRecordTypes: string[];
  sqliteAvailable: boolean;
  sqliteDeletedRecordCount: number;
};

function hasTauriRuntime() {
  return typeof window !== "undefined" && Boolean((window as Window & { __TAURI__?: unknown }).__TAURI__);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function textValue(value: unknown) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function payloadLabel(record: DeletedRecord) {
  const payload = record.payload as unknown as Record<string, unknown>;

  return (
    textValue(record.title) ||
    textValue(payload.title) ||
    textValue(payload.name) ||
    textValue(payload.label) ||
    record.originalId
  );
}

function deletedBy(record: DeletedRecord) {
  const raw = record as unknown as { deletedBy?: unknown };

  return textValue(raw.deletedBy) || textValue(record.actor);
}

async function deleteTrashRowsNotIn(db: SqliteDatabase, ids: string[]) {
  if (ids.length === 0) {
    await db.execute("DELETE FROM deleted_records");
    return;
  }

  const placeholders = ids.map(() => "?").join(", ");
  await db.execute(`DELETE FROM deleted_records WHERE id NOT IN (${placeholders})`, ids);
}

async function saveDeletedRecordWithDb(db: SqliteDatabase, record: DeletedRecord) {
  await db.execute(
    `INSERT INTO deleted_records (
      id,
      record_type,
      record_id,
      deleted_at,
      expires_at,
      payload_json,
      title,
      details,
      deleted_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      record_type = excluded.record_type,
      record_id = excluded.record_id,
      deleted_at = excluded.deleted_at,
      expires_at = excluded.expires_at,
      payload_json = excluded.payload_json,
      title = excluded.title,
      details = excluded.details,
      deleted_by = excluded.deleted_by`,
    [
      record.id,
      record.type,
      record.originalId,
      record.deletedAt,
      record.expiresAt || null,
      JSON.stringify(record.payload),
      payloadLabel(record),
      record.details || null,
      deletedBy(record) || null
    ]
  );
}

export async function syncDeletedRecordsToSqlite(records: DeletedRecord[]) {
  if (!hasTauriRuntime()) {
    return 0;
  }

  const db = await openMaintenanceSqliteDatabase();
  await deleteTrashRowsNotIn(
    db,
    records.map((record) => record.id)
  );

  for (const record of records) {
    await saveDeletedRecordWithDb(db, record);
  }

  return countSqliteDeletedRecords();
}

export async function countSqliteDeletedRecords() {
  if (!hasTauriRuntime()) {
    return 0;
  }

  const db = await openMaintenanceSqliteDatabase();
  const rows = await db.select<CountRow[]>("SELECT COUNT(*) AS count FROM deleted_records");

  return rows[0]?.count ?? 0;
}

export async function loadTrashMirrorSample(limit = 5): Promise<TrashMirrorSample[]> {
  if (!hasTauriRuntime()) {
    return [];
  }

  const db = await openMaintenanceSqliteDatabase();
  const safeLimit = Math.max(1, Math.min(25, Math.trunc(limit)));
  const rows = await db.select<TrashMirrorSampleRow[]>(
    `SELECT
      id,
      record_type,
      record_id,
      deleted_at,
      expires_at,
      title,
      deleted_by
    FROM deleted_records
    ORDER BY deleted_at DESC, id ASC
    LIMIT ?`,
    [safeLimit]
  );

  return rows.map((row) => ({
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by ?? "",
    expiresAt: row.expires_at ?? "",
    id: row.id,
    recordId: row.record_id,
    recordType: row.record_type,
    title: row.title ?? ""
  }));
}

export async function getSqliteTrashMirrorStatus(records: DeletedRecord[]): Promise<SqliteTrashMirrorStatus> {
  if (!hasTauriRuntime()) {
    return {
      deletedRecordsMatch: false,
      jsonDeletedRecordCount: records.length,
      sampleRecordIds: [],
      sampleRecordTypes: [],
      sqliteAvailable: false,
      sqliteDeletedRecordCount: 0
    };
  }

  try {
    const sqliteDeletedRecordCount = await syncDeletedRecordsToSqlite(records);
    const sample = await loadTrashMirrorSample();

    return {
      deletedRecordsMatch: sqliteDeletedRecordCount === records.length,
      jsonDeletedRecordCount: records.length,
      sampleRecordIds: sample.map((record) => record.recordId).filter(Boolean),
      sampleRecordTypes: sample.map((record) => record.recordType).filter(Boolean),
      sqliteAvailable: true,
      sqliteDeletedRecordCount
    };
  } catch (error) {
    return {
      deletedRecordsMatch: false,
      error: errorMessage(error),
      jsonDeletedRecordCount: records.length,
      sampleRecordIds: [],
      sampleRecordTypes: [],
      sqliteAvailable: false,
      sqliteDeletedRecordCount: 0
    };
  }
}
