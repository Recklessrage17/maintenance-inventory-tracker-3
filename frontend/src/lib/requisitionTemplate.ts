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

function wrapTextByLength(value: unknown, maxLineLength: number) {
  const words = cleanText(value).split(" ").filter(Boolean);
  const lines: string[] = [];
  let currentLine = "";

  words.forEach((word) => {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;

    if (nextLine.length <= maxLineLength) {
      currentLine = nextLine;
      return;
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    if (word.length > maxLineLength) {
      for (let index = 0; index < word.length; index += maxLineLength) {
        lines.push(word.slice(index, index + maxLineLength));
      }
      currentLine = "";
      return;
    }

    currentLine = word;
  });

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length ? lines.join("\n") : "";
}

function countWrappedLines(value: string) {
  return Math.max(1, value.split(/\n/).length);
}

function setWrappedCellValue(cell: XlsxCell, value: unknown, maxLineLength: number) {
  const wrappedValue = wrapTextByLength(value, maxLineLength);

  cell.value(wrappedValue);

  try {
    cell.style?.({
      shrinkToFit: true,
      verticalAlignment: "center",
      wrapText: true
    });
  } catch {
    // Some generated workbook cells may reject style changes; keep export moving.
  }

  return countWrappedLines(wrappedValue);
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

function getLineDescription(item: InventoryItem) {
  const description = item.description || item.name;
  const notes = cleanText(item.notes);

  return notes ? `${description} - Notes: ${notes}` : description;
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

function getVendorContactLines(header: RequisitionHeaderDraft) {
  const contactLines = header.vendorAddress
    .split(/\r?\n/)
    .map((line) => cleanText(line))
    .filter(Boolean);

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
  const [vendorAddressLine1 = "", vendorAddressLine2 = ""] = getVendorContactLines(header);

  setWrappedCellValue(sheet.cell(map.poNo), header.poNo, 18);
  setWrappedCellValue(sheet.cell(map.poInitiator), header.poInitiator, 20);
  setWrappedCellValue(sheet.cell(map.shipVia), header.shipVia, 18);
  setWrappedCellValue(sheet.cell(map.poClass), header.poClass, 18);
  setCellValue(sheet, map.reqDate, parseDateInput(header.reqDate));
  setWrappedCellValue(sheet.cell(map.vendorName), header.vendorName || group.vendorName, 26);
  setWrappedCellValue(sheet.cell(map.vendorAddressLine1), vendorAddressLine1, 34);
  setWrappedCellValue(sheet.cell(map.vendorAddressLine2), vendorAddressLine2, 44);
  setWrappedCellValue(sheet.cell(map.confirmedWith), header.confirmedWith, 22);
  setWrappedCellValue(sheet.cell(map.assetNo), header.assetNo, 18);
  setWrappedCellValue(sheet.cell(map.moldNo), header.moldNo, 18);
  setWrappedCellValue(sheet.cell(map.equipmentNo), header.equipmentNo, 18);
  setWrappedCellValue(sheet.cell(map.partNo), header.partNo, 18);
  setWrappedCellValue(sheet.cell(map.jobNo), header.jobNo, 18);
  setWrappedCellValue(sheet.cell(map.initials), header.initials, 8);
  setWrappedCellValue(sheet.cell(map.tsNo), header.tsNo, 16);
  setWrappedCellValue(sheet.cell(map.codeNo), header.codeNo, 16);
  setWrappedCellValue(sheet.cell(map.workOrderNo), header.workOrderNo, 18);
  setWrappedCellValue(sheet.cell(map.comments), getComments(header), 72);
  setWrappedCellValue(sheet.cell(map.departmentManager), header.departmentManager, 22);
  setWrappedCellValue(sheet.cell(map.requisitionedBy), header.requisitionedBy, 22);
  setWrappedCellValue(sheet.cell(map.authorizedBy), header.authorizedBy, 22);
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
  const itemNumberLines = setWrappedCellValue(itemNumberCellRef, item.partNumber || item.name, 22);
  const descriptionLines = setWrappedCellValue(descriptionCellRef, getLineDescription(item), 54);
  setCellValue(sheet, dueDateCell, parseDateInput(lineDrafts[item.id]?.dueDate ?? ""));
  unitPriceCellRef.value(unitPrice);

  if (typeof totalPriceCell.formula === "function") {
    totalPriceCell.formula(undefined);
  }

  totalPriceCell.value(quantity * unitPrice);

  try {
    const lineCount = Math.max(itemNumberLines, descriptionLines);
    sheet.row?.(row).height?.(Math.min(58, 20 + (lineCount - 1) * 12));
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

function adjustUnder100HeaderSpacing(sheet: XlsxSheet, requisitionType: RequisitionType) {
  if (requisitionType !== "under100") {
    return;
  }

  try {
    sheet.row?.(12).height?.(17);
    sheet.row?.(13).height?.(17);
    sheet.row?.(14).height?.(17);
    sheet.row?.(18).height?.(17);
    sheet.row?.(19).height?.(19);
  } catch {
    // Keep the original template layout if row height changes are rejected.
  }

  try {
    sheet.cell("B13").style?.({
      fontSize: 7,
      shrinkToFit: true,
      verticalAlignment: "center"
    });
    sheet.cell("B14").style?.({
      fontSize: 7,
      shrinkToFit: true,
      verticalAlignment: "center"
    });
  } catch {
    // The helper note is decorative; keep export moving if style changes fail.
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
  adjustUnder100HeaderSpacing(sheet, requisitionType);
  writeLineItems(sheet, map, group, lineDrafts);
  writeGrandTotal(sheet, map.grandTotal, group, lineDrafts, grandTotalOverride);
  shiftUnder100TitleRight(sheet, requisitionType);

  const output = await workbook.outputAsync();

  return new Blob([output as BlobPart], { type: workbookMimeType });
}
