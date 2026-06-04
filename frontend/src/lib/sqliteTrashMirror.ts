import type { DeletedRecord, DeletedRecordType } from "../types";
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

type SqliteDeletedRecordRow = TrashMirrorSampleRow & {
  details: string | null;
  payload_json: string;
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
  activeTrashSource: "json" | "sqlite";
  deletedRecordsMatch: boolean;
  error?: string;
  jsonDeletedRecordCount: number;
  sampleRecordIds: string[];
  sampleRecordTypes: string[];
  sqliteAvailable: boolean;
  sqliteDeletedRecordCount: number;
};

export type TrashSqliteActivationResult = SqliteTrashMirrorStatus & {
  records: DeletedRecord[];
};

const TRASH_RETENTION_MS = 30 * 60 * 1000;

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

function deletedRecordType(value: string): DeletedRecordType {
  return value === "Vendor" || value === "Location" ? value : "Inventory";
}

function parsePayload(value: string): DeletedRecord["payload"] {
  try {
    const parsed = JSON.parse(value);

    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as DeletedRecord["payload"])
      : ({} as DeletedRecord["payload"]);
  } catch {
    return {} as DeletedRecord["payload"];
  }
}

function fallbackExpiresAt(deletedAt: string) {
  const deletedAtMs = new Date(deletedAt).getTime();

  return new Date((Number.isFinite(deletedAtMs) ? deletedAtMs : Date.now()) + TRASH_RETENTION_MS).toISOString();
}

function deletedRecordFromSqlite(row: SqliteDeletedRecordRow): DeletedRecord {
  const payload = parsePayload(row.payload_json);
  const payloadRecord = payload as unknown as Record<string, unknown>;

  return {
    id: row.id,
    originalId: row.record_id,
    type: deletedRecordType(row.record_type),
    title: row.title ?? (textValue(payloadRecord.name) || row.record_id),
    details: row.details ?? "",
    deletedAt: row.deleted_at,
    expiresAt: row.expires_at ?? fallbackExpiresAt(row.deleted_at),
    actor: row.deleted_by ?? "User",
    payload
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

function recordsDiffer(jsonRecords: DeletedRecord[], sqliteRecords: DeletedRecord[]) {
  if (jsonRecords.length !== sqliteRecords.length) {
    return true;
  }

  const sqliteById = new Map(sqliteRecords.map((record) => [record.id, record]));

  return jsonRecords.some((jsonRecord) => {
    const sqliteRecord = sqliteById.get(jsonRecord.id);

    return (
      !sqliteRecord ||
      jsonRecord.type !== sqliteRecord.type ||
      jsonRecord.originalId !== sqliteRecord.originalId ||
      jsonRecord.deletedAt !== sqliteRecord.deletedAt ||
      jsonRecord.expiresAt !== sqliteRecord.expiresAt ||
      jsonRecord.title !== sqliteRecord.title ||
      jsonRecord.details !== sqliteRecord.details ||
      deletedBy(jsonRecord) !== sqliteRecord.actor ||
      JSON.stringify(jsonRecord.payload) !== JSON.stringify(sqliteRecord.payload)
    );
  });
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

export async function loadDeletedRecordsFromSqlite(): Promise<DeletedRecord[]> {
  if (!hasTauriRuntime()) {
    return [];
  }

  const db = await openMaintenanceSqliteDatabase();
  const rows = await db.select<SqliteDeletedRecordRow[]>(
    `SELECT
      id,
      record_type,
      record_id,
      deleted_at,
      expires_at,
      payload_json,
      title,
      details,
      deleted_by
    FROM deleted_records
    ORDER BY deleted_at DESC, id ASC`
  );

  return rows.map(deletedRecordFromSqlite);
}

export async function saveDeletedRecordToSqlite(record: DeletedRecord) {
  if (!hasTauriRuntime()) {
    return;
  }

  const db = await openMaintenanceSqliteDatabase();
  await saveDeletedRecordWithDb(db, record);
}

export async function deleteDeletedRecordFromSqlite(recordId: string) {
  if (!hasTauriRuntime()) {
    return;
  }

  const db = await openMaintenanceSqliteDatabase();
  await db.execute("DELETE FROM deleted_records WHERE id = ?", [recordId]);
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
      activeTrashSource: "json",
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
      activeTrashSource: "sqlite",
      deletedRecordsMatch: sqliteDeletedRecordCount === records.length,
      jsonDeletedRecordCount: records.length,
      sampleRecordIds: sample.map((record) => record.recordId).filter(Boolean),
      sampleRecordTypes: sample.map((record) => record.recordType).filter(Boolean),
      sqliteAvailable: true,
      sqliteDeletedRecordCount
    };
  } catch (error) {
    return {
      activeTrashSource: "json",
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

export async function activateTrashSqliteState(jsonRecords: DeletedRecord[]): Promise<TrashSqliteActivationResult> {
  if (!hasTauriRuntime()) {
    return {
      activeTrashSource: "json",
      deletedRecordsMatch: false,
      jsonDeletedRecordCount: jsonRecords.length,
      records: jsonRecords,
      sampleRecordIds: [],
      sampleRecordTypes: [],
      sqliteAvailable: false,
      sqliteDeletedRecordCount: 0
    };
  }

  try {
    let sqliteRecords = await loadDeletedRecordsFromSqlite();

    if (recordsDiffer(jsonRecords, sqliteRecords)) {
      await syncDeletedRecordsToSqlite(jsonRecords);
      sqliteRecords = await loadDeletedRecordsFromSqlite();
    }

    const orderedSqliteRecords = orderBySource(jsonRecords, sqliteRecords);
    const sample = await loadTrashMirrorSample();

    return {
      activeTrashSource: "sqlite",
      deletedRecordsMatch: orderedSqliteRecords.length === jsonRecords.length,
      jsonDeletedRecordCount: jsonRecords.length,
      records: orderedSqliteRecords,
      sampleRecordIds: sample.map((record) => record.recordId).filter(Boolean),
      sampleRecordTypes: sample.map((record) => record.recordType).filter(Boolean),
      sqliteAvailable: true,
      sqliteDeletedRecordCount: orderedSqliteRecords.length
    };
  } catch (error) {
    return {
      activeTrashSource: "json",
      deletedRecordsMatch: false,
      error: errorMessage(error),
      jsonDeletedRecordCount: jsonRecords.length,
      records: jsonRecords,
      sampleRecordIds: [],
      sampleRecordTypes: [],
      sqliteAvailable: false,
      sqliteDeletedRecordCount: 0
    };
  }
}
