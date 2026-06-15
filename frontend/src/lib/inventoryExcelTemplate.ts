import XlsxPopulate from "xlsx-populate/browser/xlsx-populate-no-encryption";
import type { InventoryItem, LocationRecord, VendorRecord } from "../types";

export const MIT3_INVENTORY_IMPORT_SHEET = "MIT3 Inventory Import";
export const MIT3_INVENTORY_TEMPLATE_FILENAME = "MIT3 Inventory Update Template.xlsx";
export const MIT3_BLANK_INVENTORY_TEMPLATE_FILENAME = "MIT3 Blank Inventory Import Template.xlsx";

const workbookMimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const MIT3_INVENTORY_IMPORT_HEADERS = [
  "MIT3 Item ID",
  "Location",
  "Vendor",
  "Part Number",
  "Description",
  "Category",
  "Qty",
  "Minimum Stock",
  "Low Stock Alert",
  "Cost",
  "Hyperlink / Part Info URL",
  "Notes",
] as const;

type HeaderName = (typeof MIT3_INVENTORY_IMPORT_HEADERS)[number];

type CellValue = string | number | boolean | Date | null | undefined;

type CellLike = {
  value(): CellValue;
  value(value: CellValue): CellLike;
  style(style: Record<string, unknown>): CellLike;
  hyperlink(): string | { target?: unknown; location?: unknown; href?: unknown } | undefined;
  hyperlink(target: string): CellLike;
  rowNumber(): number;
};

type WorksheetLike = {
  name(name: string): WorksheetLike;
  cell(row: number, column?: number): CellLike;
  column(column: number): { width(width: number): void };
  freezePanes(row: number, column: number): void;
  range(startRow: number, startColumn: number, endRow: number, endColumn: number): {
    style(style: Record<string, unknown>): void;
  };
  usedRange(): { endCell(): CellLike } | undefined;
};

type WorkbookLike = {
  sheet(index: number): WorksheetLike;
  sheet(name: string): WorksheetLike | undefined;
  outputAsync(options: { type: "blob"; mimeType: string }): Promise<Blob>;
};

export type InventoryExcelTemplateRecord = {
  id: string;
  locationName: string;
  vendorName: string;
  partNumber: string;
  description: string;
  category: string;
  quantityOnHand: number | null;
  minimumStockLevel: number | null;
  lowStockAlertLevel: number | null;
  costEach: number | null;
  itemUrl: string;
  notes: string;
};

export type InventoryExcelTemplatePreview = {
  fileName: string;
  records: InventoryExcelTemplateRecord[];
  rowsFound: number;
  skippedRows: number;
  createdItems: number;
  updatedItems: number;
  duplicatePartNumberMatches: number;
  hyperlinksImported: number;
  hyperlinksSkipped: number;
  warnings: string[];
};

const textValue = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();

const numberOrNull = (value: unknown) => {
  if (value === undefined || value === null || textValue(value) === "") {
    return null;
  }

  const parsed = Number(String(value).replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

export function normalizeInventoryItemUrl(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  if (/^(file:|file:\/\/|[a-z]:\\|\\\\|mailto:|ftp:|blob:|data:)/i.test(trimmed)) {
    return "";
  }

  if (!/^https?:\/\//i.test(trimmed) && !/^[a-z0-9.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(trimmed)) {
    return "";
  }

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    const pathname = parsed.pathname.toLowerCase();

    if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) {
      return "";
    }

    if (/\.(docx?|xlsx?|pdf|txt)$/i.test(pathname)) {
      return "";
    }

    return parsed.href;
  } catch {
    return "";
  }
}

function linkedCellTarget(cell: CellLike) {
  const hyperlink = typeof cell.hyperlink === "function" ? cell.hyperlink() : undefined;

  if (!hyperlink) {
    return "";
  }

  if (typeof hyperlink === "string") {
    return hyperlink;
  }

  return textValue(hyperlink.target ?? hyperlink.location ?? hyperlink.href);
}

export async function buildInventoryExcelTemplate({
  items,
  locations,
  vendors,
}: {
  items: InventoryItem[];
  locations: LocationRecord[];
  vendors: VendorRecord[];
}) {
  const workbook = (await XlsxPopulate.fromBlankAsync()) as WorkbookLike;
  const sheet: WorksheetLike = workbook.sheet(0).name(MIT3_INVENTORY_IMPORT_SHEET);
  const locationById = new Map(locations.map((location) => [location.id, location.name]));
  const vendorById = new Map(vendors.map((vendor) => [vendor.id, vendor.name]));

  MIT3_INVENTORY_IMPORT_HEADERS.forEach((header, index) => {
    sheet.cell(1, index + 1).value(header).style({
      bold: true,
      fill: "0F766E",
      fontColor: "FFFFFF",
      horizontalAlignment: "center",
    });
  });

  items.forEach((item, itemIndex) => {
    const row = itemIndex + 2;
    const values = [
      item.id,
      locationById.get(item.locationId) ?? "",
      vendorById.get(item.vendorId) ?? "",
      item.partNumber,
      item.description || item.name,
      item.category,
      item.quantityOnHand,
      item.minimumStockLevel,
      item.lowStockAlertLevel,
      item.costEach,
      item.itemUrl,
      item.notes,
    ];

    values.forEach((value, columnIndex) => sheet.cell(row, columnIndex + 1).value(value));

    if (item.itemUrl) {
      const href = normalizeInventoryItemUrl(item.itemUrl);
      if (href) {
        sheet.cell(row, 4).hyperlink(href).style({ fontColor: "0563C1", underline: true });
      }
    }
  });

  sheet.freezePanes(2, 1);
  [22, 24, 24, 24, 40, 20, 12, 16, 18, 12, 36, 45].forEach((width, index) => {
    sheet.column(index + 1).width(width);
  });
  sheet.range(1, 1, Math.max(items.length + 1, 2), MIT3_INVENTORY_IMPORT_HEADERS.length).style({ border: true });

  return workbook.outputAsync({ type: "blob", mimeType: workbookMimeType });
}

export async function buildBlankInventoryExcelTemplate() {
  return buildInventoryExcelTemplate({ items: [], locations: [], vendors: [] });
}

export async function readInventoryExcelTemplate(file: File, existingItems: InventoryItem[]) {
  const workbook = (await XlsxPopulate.fromDataAsync(await file.arrayBuffer())) as WorkbookLike;
  const sheet: WorksheetLike | undefined = workbook.sheet(MIT3_INVENTORY_IMPORT_SHEET);

  if (!sheet) {
    throw new Error(`Workbook must contain a sheet named ${MIT3_INVENTORY_IMPORT_SHEET}.`);
  }

  const usedRange = sheet.usedRange();
  const rowCount = usedRange ? usedRange.endCell().rowNumber() : 0;
  const headerIndex = new Map<HeaderName, number>();

  MIT3_INVENTORY_IMPORT_HEADERS.forEach((header, index) => {
    if (textValue(sheet.cell(1, index + 1).value()) === header) {
      headerIndex.set(header, index + 1);
    }
  });

  const missingHeaders = MIT3_INVENTORY_IMPORT_HEADERS.filter((header) => !headerIndex.has(header));
  if (missingHeaders.length > 0) {
    throw new Error(`Template is missing required columns: ${missingHeaders.join(", ")}.`);
  }

  const existingIds = new Set(existingItems.map((item) => item.id));
  const existingPartNumbers = new Set(existingItems.map((item) => item.partNumber.trim().toLowerCase()).filter(Boolean));
  const warnings: string[] = [];
  const records: InventoryExcelTemplateRecord[] = [];
  let skippedRows = 0;
  let duplicatePartNumberMatches = 0;
  let hyperlinksImported = 0;
  let hyperlinksSkipped = 0;

  for (let row = 2; row <= rowCount; row += 1) {
    const cell = (header: HeaderName) => sheet.cell(row, headerIndex.get(header));
    const id = textValue(cell("MIT3 Item ID").value());
    const partNumber = textValue(cell("Part Number").value());

    if (!id && !partNumber) {
      if (MIT3_INVENTORY_IMPORT_HEADERS.some((header) => textValue(cell(header).value()))) {
        skippedRows += 1;
        warnings.push(`Row ${row} skipped: MIT3 Item ID and Part Number are blank.`);
      }
      continue;
    }

    if (id && !existingIds.has(id)) {
      warnings.push(`Row ${row}: MIT3 Item ID ${id} was not found; Part Number fallback will be used if possible.`);
    }

    if (!partNumber) {
      warnings.push(`Row ${row} skipped: Part Number is blank.`);
      skippedRows += 1;
      continue;
    }

    if (!id && existingPartNumbers.has(partNumber.toLowerCase())) {
      duplicatePartNumberMatches += 1;
    }

    const explicitUrl = textValue(cell("Hyperlink / Part Info URL").value());
    const linkedUrl = linkedCellTarget(cell("Part Number"));
    const rawUrl = explicitUrl || linkedUrl;
    const itemUrl = rawUrl ? normalizeInventoryItemUrl(rawUrl) : "";

    if (itemUrl) {
      hyperlinksImported += 1;
    } else if (rawUrl) {
      hyperlinksSkipped += 1;
      warnings.push(`Row ${row}: Hyperlink / Part Info URL was skipped because it is not a valid web URL.`);
    }

    records.push({
      id,
      locationName: textValue(cell("Location").value()),
      vendorName: textValue(cell("Vendor").value()),
      partNumber,
      description: textValue(cell("Description").value()),
      category: textValue(cell("Category").value()),
      quantityOnHand: numberOrNull(cell("Qty").value()),
      minimumStockLevel: numberOrNull(cell("Minimum Stock").value()),
      lowStockAlertLevel: numberOrNull(cell("Low Stock Alert").value()),
      costEach: numberOrNull(cell("Cost").value()),
      itemUrl,
      notes: textValue(cell("Notes").value()),
    });
  }

  return {
    fileName: file.name,
    records,
    rowsFound: records.length,
    skippedRows,
    createdItems: records.filter((record) => !record.id && !existingPartNumbers.has(record.partNumber.toLowerCase())).length,
    updatedItems: records.filter((record) => record.id || existingPartNumbers.has(record.partNumber.toLowerCase())).length,
    duplicatePartNumberMatches,
    hyperlinksImported,
    hyperlinksSkipped,
    warnings,
  } satisfies InventoryExcelTemplatePreview;
}
