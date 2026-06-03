import type { AppData, RequisitionMadeRecord } from "../types";
import { openMaintenanceSqliteDatabase } from "./sqliteRuntime";

type SqliteDatabase = Awaited<ReturnType<typeof openMaintenanceSqliteDatabase>>;

type CountRow = {
  count: number;
};

type RequisitionMirrorSampleRow = {
  requisition_number: string | null;
};

type RequisitionMirrorPartSampleRow = {
  part_number: string | null;
};

type SqliteRequisitionRow = {
  created_at: string;
  fulfilled_at: string | null;
  id: string;
  passed_at: string | null;
  pdf_generated_at: string | null;
  po_no: string | null;
  requested_by: string | null;
  requisition_type: string | null;
  status: string | null;
  submitted_at: string | null;
  total_cost: number | string | null;
  updated_at: string;
  vendor_key: string | null;
  vendor_name: string | null;
};

type SqliteRequisitionLineRow = {
  description: string | null;
  id: string;
  item_id: string | null;
  item_name: string | null;
  line_total_cost: number | string | null;
  part_number: string | null;
  quantity_requested: number | string | null;
  requisition_id: string;
  source_item_id: string | null;
  unit_cost: number | string | null;
};

export type RequisitionMirrorLine = {
  id: string;
  record: RequisitionMadeRecord;
  snapshot: RequisitionMadeRecord["itemSnapshots"][number];
};

export type RequisitionMirrorSample = {
  partNumbers: string[];
  requisitionNumbers: string[];
};

export type SqliteRequisitionMirrorStatus = {
  activeRequisitionSource: "json" | "sqlite";
  error?: string;
  jsonReorderHistoryCount: number;
  jsonRequisitionCount: number;
  jsonRequisitionLineCount: number;
  reorderHistoryMatch: boolean;
  requisitionLinesMatch: boolean;
  requisitionsMatch: boolean;
  samplePartNumbers: string[];
  sampleRequisitionNumbers: string[];
  sqliteAvailable: boolean;
  sqliteReorderHistoryCount: number;
  sqliteRequisitionCount: number;
  sqliteRequisitionLineCount: number;
};

export type SqliteRequisitionActivationResult = SqliteRequisitionMirrorStatus & {
  records: RequisitionMadeRecord[];
};

const FALLBACK_DATE = "1970-01-01T00:00:00.000Z";
const MANUAL_REQUISITION_ITEM_PREFIX = "manual-requisition-item-";
const REQUISITION_MADE_SOURCE = "requisition_made";

function hasTauriRuntime() {
  return typeof window !== "undefined" && Boolean((window as Window & { __TAURI__?: unknown }).__TAURI__);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function numberValue(value: number | string | null | undefined, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function recordCreatedAt(record: RequisitionMadeRecord) {
  return record.createdAt || record.passedAt || record.pdfGeneratedAt || FALLBACK_DATE;
}

function recordUpdatedAt(record: RequisitionMadeRecord) {
  return record.passedAt || record.pdfGeneratedAt || record.createdAt || FALLBACK_DATE;
}

function lineId(record: RequisitionMadeRecord, snapshot: RequisitionMirrorLine["snapshot"], index: number) {
  return `requisition-line:${record.id}:${index}:${snapshot.itemId || "item"}`;
}

function reorderHistoryId(line: RequisitionMirrorLine) {
  return `reorder:${line.id}`;
}

function boolToSqlite(value: boolean) {
  return value ? 1 : 0;
}

function mirrorLinesFromRecords(records: RequisitionMadeRecord[]): RequisitionMirrorLine[] {
  return records.flatMap((record) =>
    record.itemSnapshots.map((snapshot, index) => ({
      id: lineId(record, snapshot, index),
      record,
      snapshot
    }))
  );
}

function activeRecordIds(records: RequisitionMadeRecord[]) {
  return records.map((record) => record.id);
}

function activeLineIds(lines: RequisitionMirrorLine[]) {
  return lines.map((line) => line.id);
}

function normalizeRequisitionType(value: string | null | undefined): RequisitionMadeRecord["requisitionType"] {
  return value === "over100" ? "over100" : "under100";
}

function recordFromSqlite(row: SqliteRequisitionRow, lines: SqliteRequisitionLineRow[]): RequisitionMadeRecord {
  const createdAt = row.created_at || row.passed_at || row.pdf_generated_at || FALLBACK_DATE;
  const itemSnapshots = lines.map((line) => {
    const quantityRequested = numberValue(line.quantity_requested);
    const unitCost = numberValue(line.unit_cost);

    return {
      itemId: line.source_item_id ?? line.item_id ?? "",
      itemName: line.item_name ?? line.description ?? line.part_number ?? "Unknown Item",
      partNumber: line.part_number ?? "",
      quantityRequested,
      unitCost,
      totalCost: numberValue(line.line_total_cost, quantityRequested * unitCost)
    };
  });
  const totalCost = numberValue(
    row.total_cost,
    itemSnapshots.reduce((sum, snapshot) => sum + snapshot.totalCost, 0)
  );

  return {
    id: row.id,
    vendorKey: row.vendor_key ?? "",
    vendorName: row.vendor_name ?? "Unassigned Vendor",
    createdAt,
    createdBy: row.requested_by ?? "",
    itemIds: itemSnapshots.map((snapshot) => snapshot.itemId),
    itemSnapshots,
    poNo: row.po_no ?? "",
    totalCost,
    requisitionType: normalizeRequisitionType(row.requisition_type),
    pdfGeneratedAt: row.pdf_generated_at ?? row.submitted_at ?? createdAt,
    passedAt: row.passed_at ?? row.fulfilled_at ?? createdAt,
    requisitionedBy: row.requested_by ?? "",
    status: "Made"
  };
}

function recordsMatch(jsonRecord: RequisitionMadeRecord, sqliteRecord: RequisitionMadeRecord) {
  if (
    jsonRecord.id !== sqliteRecord.id ||
    jsonRecord.vendorKey !== sqliteRecord.vendorKey ||
    jsonRecord.vendorName !== sqliteRecord.vendorName ||
    (jsonRecord.createdAt ?? "") !== (sqliteRecord.createdAt ?? "") ||
    (jsonRecord.createdBy ?? "") !== (sqliteRecord.createdBy ?? "") ||
    (jsonRecord.poNo ?? "") !== (sqliteRecord.poNo ?? "") ||
    jsonRecord.totalCost !== sqliteRecord.totalCost ||
    jsonRecord.requisitionType !== sqliteRecord.requisitionType ||
    jsonRecord.pdfGeneratedAt !== sqliteRecord.pdfGeneratedAt ||
    jsonRecord.passedAt !== sqliteRecord.passedAt ||
    (jsonRecord.requisitionedBy ?? "") !== (sqliteRecord.requisitionedBy ?? "") ||
    jsonRecord.itemSnapshots.length !== sqliteRecord.itemSnapshots.length
  ) {
    return false;
  }

  return jsonRecord.itemSnapshots.every((jsonSnapshot, index) => {
    const sqliteSnapshot = sqliteRecord.itemSnapshots[index];

    return (
      sqliteSnapshot !== undefined &&
      jsonSnapshot.itemId === sqliteSnapshot.itemId &&
      jsonSnapshot.itemName === sqliteSnapshot.itemName &&
      jsonSnapshot.partNumber === sqliteSnapshot.partNumber &&
      jsonSnapshot.quantityRequested === sqliteSnapshot.quantityRequested &&
      jsonSnapshot.unitCost === sqliteSnapshot.unitCost &&
      jsonSnapshot.totalCost === sqliteSnapshot.totalCost
    );
  });
}

function shouldBackfillJsonRequisitions(jsonRecords: RequisitionMadeRecord[], sqliteRecords: RequisitionMadeRecord[]) {
  if (jsonRecords.length === 0) {
    return false;
  }

  if (sqliteRecords.length !== jsonRecords.length) {
    return true;
  }

  const sqliteRecordsById = new Map(sqliteRecords.map((record) => [record.id, record]));

  return jsonRecords.some((record) => {
    const sqliteRecord = sqliteRecordsById.get(record.id);

    return !sqliteRecord || !recordsMatch(record, sqliteRecord);
  });
}

async function deleteMirrorRowsNotIn(
  db: SqliteDatabase,
  tableName: "requisitions" | "requisition_lines" | "reorder_history",
  sourceColumn: "source_record_type" | "source_line_id" | "source_requisition_id",
  sourceValue: string | null,
  ids: string[],
  idColumn = "id"
) {
  const sourceClause = sourceValue === null ? `${sourceColumn} IS NOT NULL` : `${sourceColumn} = ?`;
  const sourceParams = sourceValue === null ? [] : [sourceValue];

  if (ids.length === 0) {
    await db.execute(`DELETE FROM ${tableName} WHERE ${sourceClause}`, sourceParams);
    return;
  }

  const placeholders = ids.map(() => "?").join(", ");
  await db.execute(
    `DELETE FROM ${tableName} WHERE ${sourceClause} AND ${idColumn} NOT IN (${placeholders})`,
    [...sourceParams, ...ids]
  );
}

async function saveRequisitionWithDb(db: SqliteDatabase, record: RequisitionMadeRecord) {
  const createdAt = recordCreatedAt(record);
  const updatedAt = recordUpdatedAt(record);

  await db.execute(
    `INSERT INTO requisitions (
      id,
      requested_by,
      status,
      needed_by,
      notes,
      created_at,
      updated_at,
      submitted_at,
      fulfilled_at,
      vendor_key,
      vendor_name,
      po_no,
      total_cost,
      requisition_type,
      pdf_generated_at,
      passed_at,
      source_record_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      requested_by = excluded.requested_by,
      status = excluded.status,
      needed_by = excluded.needed_by,
      notes = excluded.notes,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      submitted_at = excluded.submitted_at,
      fulfilled_at = excluded.fulfilled_at,
      vendor_key = excluded.vendor_key,
      vendor_name = excluded.vendor_name,
      po_no = excluded.po_no,
      total_cost = excluded.total_cost,
      requisition_type = excluded.requisition_type,
      pdf_generated_at = excluded.pdf_generated_at,
      passed_at = excluded.passed_at,
      source_record_type = excluded.source_record_type`,
    [
      record.id,
      record.requisitionedBy || record.createdBy || "",
      record.status || "Made",
      null,
      "",
      createdAt,
      updatedAt,
      record.pdfGeneratedAt || null,
      record.passedAt || null,
      record.vendorKey,
      record.vendorName,
      record.poNo || null,
      numberValue(record.totalCost),
      record.requisitionType,
      record.pdfGeneratedAt || null,
      record.passedAt || null,
      REQUISITION_MADE_SOURCE
    ]
  );
}

async function saveRequisitionLineWithDb(db: SqliteDatabase, line: RequisitionMirrorLine) {
  const { record, snapshot } = line;
  const createdAt = recordCreatedAt(record);
  const updatedAt = recordUpdatedAt(record);
  const quantityRequested = numberValue(snapshot.quantityRequested);
  const unitCost = numberValue(snapshot.unitCost);

  await db.execute(
    `INSERT INTO requisition_lines (
      id,
      requisition_id,
      item_id,
      part_number,
      description,
      quantity_requested,
      quantity_fulfilled,
      unit,
      notes,
      created_at,
      updated_at,
      source_line_id,
      source_item_id,
      item_name,
      vendor_name,
      unit_cost,
      line_total_cost,
      manual_line
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      requisition_id = excluded.requisition_id,
      item_id = excluded.item_id,
      part_number = excluded.part_number,
      description = excluded.description,
      quantity_requested = excluded.quantity_requested,
      quantity_fulfilled = excluded.quantity_fulfilled,
      unit = excluded.unit,
      notes = excluded.notes,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      source_line_id = excluded.source_line_id,
      source_item_id = excluded.source_item_id,
      item_name = excluded.item_name,
      vendor_name = excluded.vendor_name,
      unit_cost = excluded.unit_cost,
      line_total_cost = excluded.line_total_cost,
      manual_line = excluded.manual_line`,
    [
      line.id,
      record.id,
      null,
      snapshot.partNumber,
      snapshot.itemName,
      quantityRequested,
      0,
      "",
      "",
      createdAt,
      updatedAt,
      line.id,
      snapshot.itemId,
      snapshot.itemName,
      record.vendorName,
      unitCost,
      numberValue(snapshot.totalCost, quantityRequested * unitCost),
      boolToSqlite(snapshot.itemId.startsWith(MANUAL_REQUISITION_ITEM_PREFIX))
    ]
  );
}

async function saveReorderHistoryLineWithDb(db: SqliteDatabase, line: RequisitionMirrorLine) {
  const { record, snapshot } = line;
  const createdAt = recordCreatedAt(record);
  const updatedAt = recordUpdatedAt(record);
  const quantityRequested = numberValue(snapshot.quantityRequested);
  const unitCost = numberValue(snapshot.unitCost);

  await db.execute(
    `INSERT INTO reorder_history (
      id,
      item_id,
      vendor_id,
      part_number,
      quantity_ordered,
      unit_cost,
      total_cost,
      status,
      ordered_at,
      received_at,
      notes,
      created_at,
      updated_at,
      source_requisition_id,
      source_line_id,
      source_item_id,
      source_vendor_id,
      item_name,
      vendor_name,
      po_no,
      description
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      item_id = excluded.item_id,
      vendor_id = excluded.vendor_id,
      part_number = excluded.part_number,
      quantity_ordered = excluded.quantity_ordered,
      unit_cost = excluded.unit_cost,
      total_cost = excluded.total_cost,
      status = excluded.status,
      ordered_at = excluded.ordered_at,
      received_at = excluded.received_at,
      notes = excluded.notes,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      source_requisition_id = excluded.source_requisition_id,
      source_line_id = excluded.source_line_id,
      source_item_id = excluded.source_item_id,
      source_vendor_id = excluded.source_vendor_id,
      item_name = excluded.item_name,
      vendor_name = excluded.vendor_name,
      po_no = excluded.po_no,
      description = excluded.description`,
    [
      reorderHistoryId(line),
      null,
      null,
      snapshot.partNumber,
      quantityRequested,
      unitCost,
      numberValue(snapshot.totalCost, quantityRequested * unitCost),
      record.status || "Made",
      record.pdfGeneratedAt || createdAt,
      record.passedAt || null,
      "",
      createdAt,
      updatedAt,
      record.id,
      line.id,
      snapshot.itemId,
      record.vendorKey || null,
      snapshot.itemName,
      record.vendorName,
      record.poNo || null,
      snapshot.itemName
    ]
  );
}

export async function loadRequisitionsFromSqlite(): Promise<RequisitionMadeRecord[]> {
  if (!hasTauriRuntime()) {
    return [];
  }

  const db = await openMaintenanceSqliteDatabase();
  const requisitionRows = await db.select<SqliteRequisitionRow[]>(
    `SELECT
      id,
      requested_by,
      status,
      created_at,
      updated_at,
      submitted_at,
      fulfilled_at,
      vendor_key,
      vendor_name,
      po_no,
      total_cost,
      requisition_type,
      pdf_generated_at,
      passed_at
    FROM requisitions
    WHERE source_record_type = ?
    ORDER BY created_at DESC, id ASC`,
    [REQUISITION_MADE_SOURCE]
  );
  const lineRows = await db.select<SqliteRequisitionLineRow[]>(
    `SELECT
      id,
      requisition_id,
      item_id,
      part_number,
      description,
      quantity_requested,
      source_item_id,
      item_name,
      unit_cost,
      line_total_cost
    FROM requisition_lines
    WHERE source_line_id IS NOT NULL
    ORDER BY requisition_id ASC,
      CAST(substr(id, length('requisition-line:' || requisition_id || ':') + 1) AS INTEGER) ASC,
      id ASC`
  );
  const linesByRequisitionId = new Map<string, SqliteRequisitionLineRow[]>();

  for (const line of lineRows) {
    linesByRequisitionId.set(line.requisition_id, [...(linesByRequisitionId.get(line.requisition_id) ?? []), line]);
  }

  return requisitionRows.map((row) => recordFromSqlite(row, linesByRequisitionId.get(row.id) ?? []));
}

export async function saveRequisitionToSqlite(record: RequisitionMadeRecord) {
  if (!hasTauriRuntime()) {
    return;
  }

  const db = await openMaintenanceSqliteDatabase();
  const lines = mirrorLinesFromRecords([record]);

  await saveRequisitionWithDb(db, record);
  await db.execute("DELETE FROM requisition_lines WHERE requisition_id = ? AND source_line_id IS NOT NULL", [record.id]);
  await db.execute("DELETE FROM reorder_history WHERE source_requisition_id = ?", [record.id]);

  for (const line of lines) {
    await saveRequisitionLineWithDb(db, line);
    await saveReorderHistoryLineWithDb(db, line);
  }
}

export async function deleteRequisitionFromSqlite(recordId: string) {
  if (!hasTauriRuntime()) {
    return;
  }

  const db = await openMaintenanceSqliteDatabase();

  await db.execute("DELETE FROM reorder_history WHERE source_requisition_id = ?", [recordId]);
  await db.execute("DELETE FROM requisitions WHERE id = ? AND source_record_type = ?", [
    recordId,
    REQUISITION_MADE_SOURCE
  ]);
}

async function syncRequisitionRecordsToSqlite(records: RequisitionMadeRecord[]) {
  const db = await openMaintenanceSqliteDatabase();
  await deleteMirrorRowsNotIn(db, "requisitions", "source_record_type", REQUISITION_MADE_SOURCE, activeRecordIds(records));

  for (const record of records) {
    await saveRequisitionWithDb(db, record);
  }

  return countSqliteRequisitions();
}

export async function syncRequisitionsToSqlite(records: RequisitionMadeRecord[]) {
  if (!hasTauriRuntime()) {
    return 0;
  }

  await syncRequisitionRecordsToSqlite(records);
  await syncRequisitionLinesToSqlite(mirrorLinesFromRecords(records));
  await syncReorderHistoryToSqlite(mirrorLinesFromRecords(records));

  return countSqliteRequisitions();
}

export async function syncRequisitionLinesToSqlite(lines: RequisitionMirrorLine[]) {
  if (!hasTauriRuntime()) {
    return 0;
  }

  const db = await openMaintenanceSqliteDatabase();
  await deleteMirrorRowsNotIn(db, "requisition_lines", "source_line_id", null, activeLineIds(lines));

  for (const line of lines) {
    await saveRequisitionLineWithDb(db, line);
  }

  return countSqliteRequisitionLines();
}

export async function syncReorderHistoryToSqlite(lines: RequisitionMirrorLine[]) {
  if (!hasTauriRuntime()) {
    return 0;
  }

  const db = await openMaintenanceSqliteDatabase();
  await deleteMirrorRowsNotIn(
    db,
    "reorder_history",
    "source_requisition_id",
    null,
    lines.map(reorderHistoryId)
  );

  for (const line of lines) {
    await saveReorderHistoryLineWithDb(db, line);
  }

  return countSqliteReorderHistory();
}

export async function countSqliteRequisitions() {
  if (!hasTauriRuntime()) {
    return 0;
  }

  const db = await openMaintenanceSqliteDatabase();
  const rows = await db.select<CountRow[]>(
    "SELECT COUNT(*) AS count FROM requisitions WHERE source_record_type = ?",
    [REQUISITION_MADE_SOURCE]
  );

  return rows[0]?.count ?? 0;
}

export async function countSqliteRequisitionLines() {
  if (!hasTauriRuntime()) {
    return 0;
  }

  const db = await openMaintenanceSqliteDatabase();
  const rows = await db.select<CountRow[]>(
    "SELECT COUNT(*) AS count FROM requisition_lines WHERE source_line_id IS NOT NULL"
  );

  return rows[0]?.count ?? 0;
}

export async function countSqliteReorderHistory() {
  if (!hasTauriRuntime()) {
    return 0;
  }

  const db = await openMaintenanceSqliteDatabase();
  const rows = await db.select<CountRow[]>(
    "SELECT COUNT(*) AS count FROM reorder_history WHERE source_requisition_id IS NOT NULL"
  );

  return rows[0]?.count ?? 0;
}

export async function loadRequisitionMirrorSample(limit = 5): Promise<RequisitionMirrorSample> {
  if (!hasTauriRuntime()) {
    return {
      partNumbers: [],
      requisitionNumbers: []
    };
  }

  const db = await openMaintenanceSqliteDatabase();
  const safeLimit = Math.max(1, Math.min(25, Math.trunc(limit)));
  const requisitions = await db.select<RequisitionMirrorSampleRow[]>(
    `SELECT COALESCE(NULLIF(po_no, ''), id) AS requisition_number
    FROM requisitions
    WHERE source_record_type = ?
    ORDER BY created_at DESC, id ASC
    LIMIT ?`,
    [REQUISITION_MADE_SOURCE, safeLimit]
  );
  const parts = await db.select<RequisitionMirrorPartSampleRow[]>(
    `SELECT part_number
    FROM requisition_lines
    WHERE source_line_id IS NOT NULL
    ORDER BY created_at DESC, id ASC
    LIMIT ?`,
    [safeLimit]
  );

  return {
    partNumbers: parts.map((row) => row.part_number ?? "").filter(Boolean),
    requisitionNumbers: requisitions.map((row) => row.requisition_number ?? "").filter(Boolean)
  };
}

export async function getSqliteRequisitionMirrorStatus(data: AppData): Promise<SqliteRequisitionMirrorStatus> {
  const records = data.requisitionMadeRecords;
  const lines = mirrorLinesFromRecords(records);
  const jsonRequisitionCount = records.length;
  const jsonRequisitionLineCount = lines.length;
  const jsonReorderHistoryCount = lines.length;

  if (!hasTauriRuntime()) {
    return {
      activeRequisitionSource: "json",
      jsonReorderHistoryCount,
      jsonRequisitionCount,
      jsonRequisitionLineCount,
      reorderHistoryMatch: false,
      requisitionLinesMatch: false,
      requisitionsMatch: false,
      samplePartNumbers: [],
      sampleRequisitionNumbers: [],
      sqliteAvailable: false,
      sqliteReorderHistoryCount: 0,
      sqliteRequisitionCount: 0,
      sqliteRequisitionLineCount: 0
    };
  }

  try {
    const sqliteRequisitionCount = await syncRequisitionsToSqlite(records);
    const sqliteRequisitionLineCount = await countSqliteRequisitionLines();
    const sqliteReorderHistoryCount = await countSqliteReorderHistory();
    const sample = await loadRequisitionMirrorSample();

    return {
      activeRequisitionSource: "sqlite",
      jsonReorderHistoryCount,
      jsonRequisitionCount,
      jsonRequisitionLineCount,
      reorderHistoryMatch: sqliteReorderHistoryCount === jsonReorderHistoryCount,
      requisitionLinesMatch: sqliteRequisitionLineCount === jsonRequisitionLineCount,
      requisitionsMatch: sqliteRequisitionCount === jsonRequisitionCount,
      samplePartNumbers: sample.partNumbers,
      sampleRequisitionNumbers: sample.requisitionNumbers,
      sqliteAvailable: true,
      sqliteReorderHistoryCount,
      sqliteRequisitionCount,
      sqliteRequisitionLineCount
    };
  } catch (error) {
    return {
      activeRequisitionSource: "json",
      error: errorMessage(error),
      jsonReorderHistoryCount,
      jsonRequisitionCount,
      jsonRequisitionLineCount,
      reorderHistoryMatch: false,
      requisitionLinesMatch: false,
      requisitionsMatch: false,
      samplePartNumbers: [],
      sampleRequisitionNumbers: [],
      sqliteAvailable: false,
      sqliteReorderHistoryCount: 0,
      sqliteRequisitionCount: 0,
      sqliteRequisitionLineCount: 0
    };
  }
}

export async function activateRequisitionSqliteState(
  jsonRecords: RequisitionMadeRecord[]
): Promise<SqliteRequisitionActivationResult> {
  const jsonLines = mirrorLinesFromRecords(jsonRecords);
  const jsonRequisitionCount = jsonRecords.length;
  const jsonRequisitionLineCount = jsonLines.length;
  const jsonReorderHistoryCount = jsonLines.length;

  if (!hasTauriRuntime()) {
    return {
      activeRequisitionSource: "json",
      jsonReorderHistoryCount,
      jsonRequisitionCount,
      jsonRequisitionLineCount,
      records: jsonRecords,
      reorderHistoryMatch: false,
      requisitionLinesMatch: false,
      requisitionsMatch: false,
      samplePartNumbers: [],
      sampleRequisitionNumbers: [],
      sqliteAvailable: false,
      sqliteReorderHistoryCount: 0,
      sqliteRequisitionCount: 0,
      sqliteRequisitionLineCount: 0
    };
  }

  try {
    let sqliteRecords = await loadRequisitionsFromSqlite();

    if (shouldBackfillJsonRequisitions(jsonRecords, sqliteRecords)) {
      await syncRequisitionsToSqlite(jsonRecords);
      sqliteRecords = await loadRequisitionsFromSqlite();
    }

    const sqliteRequisitionCount = await countSqliteRequisitions();
    const sqliteRequisitionLineCount = await countSqliteRequisitionLines();
    const sqliteReorderHistoryCount = await countSqliteReorderHistory();
    const sample = await loadRequisitionMirrorSample();

    return {
      activeRequisitionSource: "sqlite",
      jsonReorderHistoryCount: sqliteRecords.reduce((total, record) => total + record.itemSnapshots.length, 0),
      jsonRequisitionCount: sqliteRecords.length,
      jsonRequisitionLineCount: sqliteRecords.reduce((total, record) => total + record.itemSnapshots.length, 0),
      records: sqliteRecords,
      reorderHistoryMatch: sqliteReorderHistoryCount === sqliteRecords.reduce((total, record) => total + record.itemSnapshots.length, 0),
      requisitionLinesMatch: sqliteRequisitionLineCount === sqliteRecords.reduce((total, record) => total + record.itemSnapshots.length, 0),
      requisitionsMatch: sqliteRequisitionCount === sqliteRecords.length,
      samplePartNumbers: sample.partNumbers,
      sampleRequisitionNumbers: sample.requisitionNumbers,
      sqliteAvailable: true,
      sqliteReorderHistoryCount,
      sqliteRequisitionCount,
      sqliteRequisitionLineCount
    };
  } catch (error) {
    return {
      activeRequisitionSource: "json",
      error: errorMessage(error),
      jsonReorderHistoryCount,
      jsonRequisitionCount,
      jsonRequisitionLineCount,
      records: jsonRecords,
      reorderHistoryMatch: false,
      requisitionLinesMatch: false,
      requisitionsMatch: false,
      samplePartNumbers: [],
      sampleRequisitionNumbers: [],
      sqliteAvailable: false,
      sqliteReorderHistoryCount: 0,
      sqliteRequisitionCount: 0,
      sqliteRequisitionLineCount: 0
    };
  }
}
