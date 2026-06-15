import XlsxPopulate from "xlsx-populate/browser/xlsx-populate-no-encryption";
import type { InventoryItem, LocationRecord, VendorRecord } from "../types";

export const MIT3_INVENTORY_IMPORT_SHEET = "MIT3 Inventory Import";
export const MIT3_INVENTORY_TEMPLATE_FILENAME = "MIT3 Inventory Update Template.xlsx";

const workbookMimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const headers = [
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

type HeaderName = (typeof headers)[number];

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
  updatedItems: number;
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

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);

    if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) {
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

  headers.forEach((header, index) => {
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
  sheet.range(1, 1, Math.max(items.length + 1, 2), headers.length).style({ border: true });

  return workbook.outputAsync({ type: "blob", mimeType: workbookMimeType });
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

  headers.forEach((header, index) => {
    if (textValue(sheet.cell(1, index + 1).value()) === header) {
      headerIndex.set(header, index + 1);
    }
  });

  const missingHeaders = headers.filter((header) => !headerIndex.has(header));
  if (missingHeaders.length > 0) {
    throw new Error(`Template is missing required columns: ${missingHeaders.join(", ")}.`);
  }

  const existingIds = new Set(existingItems.map((item) => item.id));
  const existingPartNumbers = new Set(existingItems.map((item) => item.partNumber.trim().toLowerCase()).filter(Boolean));
  const warnings: string[] = [];
  const records: InventoryExcelTemplateRecord[] = [];
  let skippedRows = 0;

  for (let row = 2; row <= rowCount; row += 1) {
    const cell = (header: HeaderName) => sheet.cell(row, headerIndex.get(header));
    const id = textValue(cell("MIT3 Item ID").value());
    const partNumber = textValue(cell("Part Number").value());

    if (!id && !partNumber) {
      if (headers.some((header) => textValue(cell(header).value()))) {
        skippedRows += 1;
        warnings.push(`Row ${row} skipped: MIT3 Item ID and Part Number are blank.`);
      }
      continue;
    }

    if (id && !existingIds.has(id)) {
      warnings.push(`Row ${row}: MIT3 Item ID ${id} was not found; Part Number fallback will be used if possible.`);
    }

    if (!id && partNumber && !existingPartNumbers.has(partNumber.toLowerCase())) {
      warnings.push(`Row ${row} skipped: Part Number ${partNumber} was not found.`);
      skippedRows += 1;
      continue;
    }

    const explicitUrl = textValue(cell("Hyperlink / Part Info URL").value());
    const linkedUrl = linkedCellTarget(cell("Part Number"));
    const itemUrl = explicitUrl ? normalizeInventoryItemUrl(explicitUrl) : normalizeInventoryItemUrl(linkedUrl);

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
    updatedItems: records.length,
    warnings,
  } satisfies InventoryExcelTemplatePreview;
}
