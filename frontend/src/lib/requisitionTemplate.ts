import XlsxPopulate from "xlsx-populate/browser/xlsx-populate-no-encryption";
import type { InventoryItem, RequisitionHeaderDraft, RequisitionLineDraft, RequisitionVendorGroup } from "../types";

type RequisitionType = "under100" | "over100";

type HeaderCellMap = {
  assetNo: string;
  authorizedBy: string;
  codeNo: string;
  comments: string;
  confirmedWith: string;
  departmentManager: string;
  equipmentNo: string;
  initials: string;
  jobNo: string;
  moldNo: string;
  partNo: string;
  poClass: string;
  poInitiator: string;
  poNo: string;
  reqDate: string;
  requisitionedBy: string;
  shipVia: string;
  tsNo: string;
  vendorAddressLine1: string;
  vendorAddressLine2: string;
  vendorName: string;
  workOrderNo: string;
};

type LineCellMap = {
  dueDate: string;
  itemDescription: string;
  itemNumber: string;
  quantity: string;
  totalPrice: string;
  unitOfMeasure: string;
  unitPrice: string;
};

type TemplateCellMap = {
  grandTotal: string;
  header: HeaderCellMap;
  line: LineCellMap;
  lineEndRow: number;
  lineStartRow: number;
  templatePath: string;
};

const workbookMimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const templateMaps: Record<RequisitionType, TemplateCellMap> = {
  over100: {
    templatePath: "/templates/requisition-over-100.xlsx",
    header: {
      poNo: "D7",
      poInitiator: "H7",
      shipVia: "M7",
      poClass: "D9",
      reqDate: "D11",
      vendorName: "D13",
      confirmedWith: "H13",
      vendorAddressLine1: "D14",
      vendorAddressLine2: "D15",
      partNo: "N14",
      jobNo: "N15",
      assetNo: "D16",
      moldNo: "N16",
      initials: "K17",
      tsNo: "N17",
      codeNo: "N18",
      workOrderNo: "D19",
      equipmentNo: "E19",
      comments: "D36",
      departmentManager: "M38",
      requisitionedBy: "G38",
      authorizedBy: "M39"
    },
    lineStartRow: 23,
    lineEndRow: 34,
    line: {
      quantity: "B",
      unitOfMeasure: "C",
      itemNumber: "D",
      itemDescription: "E",
      dueDate: "K",
      unitPrice: "M",
      totalPrice: "N"
    },
    grandTotal: "O21"
  },
  under100: {
    templatePath: "/templates/requisition-under-100.xlsx",
    header: {
      poNo: "C6",
      poInitiator: "G6",
      shipVia: "L6",
      poClass: "C8",
      reqDate: "C10",
      vendorName: "C12",
      confirmedWith: "G12",
      vendorAddressLine1: "C13",
      vendorAddressLine2: "C14",
      partNo: "M13",
      jobNo: "M14",
      assetNo: "C15",
      moldNo: "M15",
      initials: "J16",
      tsNo: "M16",
      codeNo: "M17",
      workOrderNo: "C18",
      equipmentNo: "F18",
      comments: "C34",
      departmentManager: "L34",
      requisitionedBy: "F36",
      authorizedBy: "L36"
    },
    lineStartRow: 22,
    lineEndRow: 31,
    line: {
      quantity: "A",
      unitOfMeasure: "B",
      itemNumber: "C",
      itemDescription: "D",
      dueDate: "J",
      unitPrice: "L",
      totalPrice: "M"
    },
    grandTotal: "N20"
  }
};

type XlsxCell = {
  formula?: (formula?: string) => string | undefined;
  style?: (style?: Record<string, unknown>) => unknown;
  value: (value?: unknown) => unknown;
};

type XlsxRow = {
  height?: (height?: number) => unknown;
};

type XlsxSheet = {
  cell: (address: string) => XlsxCell;
  row?: (rowNumber: number) => XlsxRow;
};

function cleanText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function getRecommendedReorderQuantity(item: InventoryItem) {
  return Math.max(1, item.minimumStockLevel - item.quantityOnHand);
}

function getLineQuantity(item: InventoryItem, lineDrafts: Record<string, RequisitionLineDraft>) {
  const rawValue = lineDrafts[item.id]?.quantity;

  if (rawValue === undefined || rawValue.trim() === "") {
    return getRecommendedReorderQuantity(item);
  }

  const parsed = Number(rawValue);

  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : getRecommendedReorderQuantity(item);
}

export function parseDateInput(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return value;
  }

  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));

  return Number.isNaN(date.getTime()) ? value : date;
}

function getComments(header: RequisitionHeaderDraft) {
  const comments = cleanText(header.comments);

  if (header.priority !== "High") {
    return comments;
  }

  const normalizedComments = comments.replace(/^high priority\s*-?\s*/i, "").trim();

  return normalizedComments ? `HIGH PRIORITY - ${normalizedComments}` : "HIGH PRIORITY -";
}

function getVendorContactLines(group: RequisitionVendorGroup, header: RequisitionHeaderDraft) {
  const headerLines = header.vendorAddress
    .split(/\r?\n/)
    .map((line) => cleanText(line))
    .filter(Boolean);

  const contactLines = headerLines.length
    ? headerLines
    : [
        group.vendor?.phone ? `Phone: ${group.vendor.phone}` : "",
        group.vendor?.email ? `Email: ${group.vendor.email}` : "",
        group.vendor?.website ? `Website: ${group.vendor.website}` : ""
      ].filter(Boolean);

  if (contactLines.length <= 2) {
    return contactLines;
  }

  return [contactLines[0], contactLines.slice(1).join(" | ")];
}

function setCellValue(sheet: XlsxSheet, address: string, value: unknown) {
  sheet.cell(address).value(value ?? "");
}

function clearCellFully(cell: XlsxCell) {
  if (typeof cell.formula === "function") {
    cell.formula(undefined);
  }

  cell.value("");
}

function writeHeader(sheet: XlsxSheet, map: HeaderCellMap, group: RequisitionVendorGroup, header: RequisitionHeaderDraft) {
  const [vendorAddressLine1 = "", vendorAddressLine2 = ""] = getVendorContactLines(group, header);

  setCellValue(sheet, map.poNo, header.poNo);
  setCellValue(sheet, map.poInitiator, header.poInitiator);
  setCellValue(sheet, map.shipVia, header.shipVia);
  setCellValue(sheet, map.poClass, header.poClass);
  setCellValue(sheet, map.reqDate, parseDateInput(header.reqDate));
  setCellValue(sheet, map.vendorName, header.vendorName || group.vendorName);
  setCellValue(sheet, map.vendorAddressLine1, vendorAddressLine1);
  setCellValue(sheet, map.vendorAddressLine2, vendorAddressLine2);
  setCellValue(sheet, map.confirmedWith, header.confirmedWith);
  setCellValue(sheet, map.assetNo, header.assetNo);
  setCellValue(sheet, map.moldNo, header.moldNo);
  setCellValue(sheet, map.equipmentNo, header.equipmentNo);
  setCellValue(sheet, map.partNo, header.partNo);
  setCellValue(sheet, map.jobNo, header.jobNo);
  setCellValue(sheet, map.initials, header.initials);
  setCellValue(sheet, map.tsNo, header.tsNo);
  setCellValue(sheet, map.codeNo, header.codeNo);
  setCellValue(sheet, map.workOrderNo, header.workOrderNo);
  setCellValue(sheet, map.comments, getComments(header));
  setCellValue(sheet, map.departmentManager, header.departmentManager);
  setCellValue(sheet, map.requisitionedBy, header.requisitionedBy);
  setCellValue(sheet, map.authorizedBy, header.authorizedBy);
}

function writeLineRow(
  sheet: XlsxSheet,
  columns: LineCellMap,
  row: number,
  item: InventoryItem | undefined,
  lineDrafts: Record<string, RequisitionLineDraft>
) {
  const quantityCell = `${columns.quantity}${row}`;
  const unitCell = `${columns.unitOfMeasure}${row}`;
  const itemNumberCell = `${columns.itemNumber}${row}`;
  const descriptionCell = `${columns.itemDescription}${row}`;
  const dueDateCell = `${columns.dueDate}${row}`;
  const unitPriceCell = `${columns.unitPrice}${row}`;
  const itemNumberCellRef = sheet.cell(itemNumberCell);
  const descriptionCellRef = sheet.cell(descriptionCell);
  const unitPriceCellRef = sheet.cell(unitPriceCell);
  const totalPriceCell = sheet.cell(`${columns.totalPrice}${row}`);

  if (!item) {
    clearCellFully(sheet.cell(quantityCell));
    clearCellFully(sheet.cell(unitCell));
    clearCellFully(itemNumberCellRef);
    clearCellFully(descriptionCellRef);
    clearCellFully(sheet.cell(dueDateCell));
    clearCellFully(unitPriceCellRef);
    clearCellFully(totalPriceCell);

    return;
  }

  const quantity = getLineQuantity(item, lineDrafts);
  const unitPrice = Number.isFinite(item.costEach) ? item.costEach : 0;

  setCellValue(sheet, quantityCell, quantity);
  setCellValue(sheet, unitCell, item.stockUnit);
  itemNumberCellRef.value(item.partNumber || item.name);
  descriptionCellRef.value(item.description || item.name);
  setCellValue(sheet, dueDateCell, parseDateInput(lineDrafts[item.id]?.dueDate ?? ""));
  unitPriceCellRef.value(unitPrice);

  if (typeof totalPriceCell.formula === "function") {
    totalPriceCell.formula(undefined);
  }

  totalPriceCell.value(quantity * unitPrice);

  try {
    itemNumberCellRef.style?.({
      shrinkToFit: true,
      verticalAlignment: "center",
      wrapText: true
    });
    descriptionCellRef.style?.({
      shrinkToFit: true,
      verticalAlignment: "center",
      wrapText: true
    });
    sheet.row?.(row).height?.(32);
  } catch {
    // Text fitting is best-effort; keep export moving if a template rejects a style.
  }

  try {
    unitPriceCellRef.style?.({
      fontSize: 8,
      numberFormat: "$#,##0.00",
      shrinkToFit: true
    });
    totalPriceCell.style?.({
      fontSize: 8,
      numberFormat: "$#,##0.00",
      shrinkToFit: true
    });
  } catch {
    // Keep template formulas and conversion resilient.
  }
}

function writeLineItems(
  sheet: XlsxSheet,
  map: Pick<TemplateCellMap, "line" | "lineEndRow" | "lineStartRow">,
  group: RequisitionVendorGroup,
  lineDrafts: Record<string, RequisitionLineDraft>
) {
  const maxRows = map.lineEndRow - map.lineStartRow + 1;

  if (group.items.length > maxRows) {
    throw new Error(`One requisition page supports ${maxRows} line items. Split the items before generating the workbook.`);
  }

  for (let row = map.lineStartRow; row <= map.lineEndRow; row += 1) {
    writeLineRow(sheet, map.line, row, group.items[row - map.lineStartRow], lineDrafts);
  }
}

function writeGrandTotal(
  sheet: XlsxSheet,
  grandTotalCell: string,
  group: RequisitionVendorGroup,
  lineDrafts: Record<string, RequisitionLineDraft>,
  grandTotalOverride?: number
) {
  const cell = sheet.cell(grandTotalCell);
  const total =
    grandTotalOverride ??
    group.items.reduce((sum, item) => {
      const unitPrice = Number.isFinite(item.costEach) ? item.costEach : 0;

      return sum + getLineQuantity(item, lineDrafts) * unitPrice;
    }, 0);

  if (typeof cell.formula === "function") {
    cell.formula(undefined);
  }

  cell.value(total);

  try {
    cell.style?.({
      fontSize: 8,
      numberFormat: "$#,##0.00",
      shrinkToFit: true
    });
  } catch {
    // Keep export moving if the template rejects a style.
  }
}

function shiftUnder100TitleRight(sheet: XlsxSheet, requisitionType: RequisitionType) {
  if (requisitionType !== "under100") {
    return;
  }

  const titleCell = sheet.cell("A4");
  const currentValue = titleCell.value();
  const currentText = String(currentValue ?? "").trim();

  if (!currentText) {
    return;
  }

  if (typeof titleCell.formula === "function") {
    titleCell.formula(undefined);
  }

  titleCell.value(`  ${currentText}`);

  try {
    titleCell.style?.({
      bold: true,
      horizontalAlignment: "left",
      underline: true,
      verticalAlignment: "center"
    });
  } catch {
    // Keep template styling if style update is not supported.
  }
}

export async function generateOfficialRequisitionWorkbook({
  group,
  header,
  lineDrafts,
  requisitionType,
  grandTotalOverride
}: {
  group: RequisitionVendorGroup;
  header: RequisitionHeaderDraft;
  lineDrafts: Record<string, RequisitionLineDraft>;
  requisitionType: RequisitionType;
  grandTotalOverride?: number;
}): Promise<Blob> {
  const map = templateMaps[requisitionType];
  const response = await fetch(map.templatePath);

  if (!response.ok) {
    throw new Error(`Official requisition Excel template is missing: ${map.templatePath}`);
  }

  const workbook = await XlsxPopulate.fromDataAsync(await response.arrayBuffer());
  const sheet = workbook.sheet(0) as XlsxSheet;

  writeHeader(sheet, map.header, group, header);
  writeLineItems(sheet, map, group, lineDrafts);
  writeGrandTotal(sheet, map.grandTotal, group, lineDrafts, grandTotalOverride);
  shiftUnder100TitleRight(sheet, requisitionType);

  const output = await workbook.outputAsync();

  return new Blob([output as BlobPart], { type: workbookMimeType });
}
