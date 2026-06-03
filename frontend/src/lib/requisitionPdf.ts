import { PDFDocument, type PDFFont, type PDFPage, StandardFonts, rgb } from "pdf-lib";
import type { InventoryItem, RequisitionHeaderDraft, RequisitionLineDraft, RequisitionVendorGroup } from "../types";

type RequisitionType = "under100" | "over100";

type Point = {
  topY: number;
  x: number;
};

type StampPositions = {
  assetNo: Point;
  authorizedBy: Point;
  codeNo: Point;
  comments: Point;
  confirmedWith: Point;
  departmentManager: Point;
  equipmentNo: Point;
  fobDestination: Point;
  fobOrigin: Point;
  initials: Point;
  jobNo: Point;
  lineDescriptionX: number;
  lineDueDateX: number;
  lineItemNumberX: number;
  lineQuantityX: number;
  lineRowHeight: number;
  lineStartTopY: number;
  lineTotalPriceX: number;
  lineUnitPriceX: number;
  lineUnitX: number;
  materialCertNo: Point;
  materialCertYes: Point;
  maxLineRows: number;
  moldNo: Point;
  partNo: Point;
  poClass: Point;
  poInitiator: Point;
  poNo: Point;
  reqDate: Point;
  requisitionedBy: Point;
  shipVia: Point;
  taxExemptNo: Point;
  taxExemptYes: Point;
  tsNo: Point;
  vendorAddressLine1: Point;
  vendorAddressLine2: Point;
  vendorName: Point;
  workOrderNo: Point;
};

const black = rgb(0, 0, 0);

const over100Positions: StampPositions = {
  poNo: { x: 220, topY: 96 },
  poInitiator: { x: 394, topY: 96 },
  shipVia: { x: 525, topY: 96 },
  poClass: { x: 220, topY: 113 },
  taxExemptYes: { x: 401, topY: 113 },
  taxExemptNo: { x: 441, topY: 113 },
  fobOrigin: { x: 535, topY: 113 },
  fobDestination: { x: 535, topY: 126 },
  reqDate: { x: 220, topY: 130 },
  materialCertYes: { x: 401, topY: 129 },
  materialCertNo: { x: 441, topY: 129 },
  vendorName: { x: 220, topY: 148 },
  confirmedWith: { x: 394, topY: 148 },
  vendorAddressLine1: { x: 220, topY: 158 },
  vendorAddressLine2: { x: 220, topY: 168 },
  partNo: { x: 565, topY: 157 },
  jobNo: { x: 565, topY: 167 },
  assetNo: { x: 394, topY: 177 },
  moldNo: { x: 565, topY: 177 },
  initials: { x: 493, topY: 187 },
  tsNo: { x: 565, topY: 187 },
  codeNo: { x: 565, topY: 197 },
  workOrderNo: { x: 220, topY: 207 },
  equipmentNo: { x: 355, topY: 207 },
  lineStartTopY: 248,
  lineRowHeight: 18,
  maxLineRows: 12,
  lineQuantityX: 152,
  lineUnitX: 186,
  lineItemNumberX: 220,
  lineDescriptionX: 308,
  lineDueDateX: 486,
  lineUnitPriceX: 535,
  lineTotalPriceX: 570,
  comments: { x: 220, topY: 507 },
  departmentManager: { x: 525, topY: 507 },
  requisitionedBy: { x: 356, topY: 557 },
  authorizedBy: { x: 525, topY: 557 }
};

const under100Positions: StampPositions = {
  ...over100Positions,
  lineStartTopY: 248,
  lineRowHeight: 20,
  maxLineRows: 10
};

const positionsByType: Record<RequisitionType, StampPositions> = {
  over100: over100Positions,
  under100: under100Positions
};

const templatePaths: Record<RequisitionType, string> = {
  over100: "/templates/blank-requisition-over-100.pdf",
  under100: "/templates/blank-requisition-under-100.pdf"
};

function yFromTop(pageHeight: number, topY: number, fontSize = 8) {
  return pageHeight - topY - fontSize;
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number.isFinite(value) ? value : 0);
}

function formatDate(value: string | undefined) {
  if (!value) {
    return "";
  }

  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) {
    return value;
  }

  return new Date(year, month - 1, day).toLocaleDateString();
}

function cleanText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function truncateText(text: string, maxLength: number) {
  const clean = cleanText(text);

  return clean.length > maxLength ? `${clean.slice(0, Math.max(0, maxLength - 3))}...` : clean;
}

function shrinkToWidth(text: string, font: PDFFont, size: number, maxWidth: number) {
  let value = text;

  while (value.length > 0 && font.widthOfTextAtSize(value, size) > maxWidth) {
    value = value.slice(0, -1);
  }

  return value.length < text.length ? `${value.slice(0, Math.max(0, value.length - 3))}...` : value;
}

function drawTextSafe(
  page: PDFPage,
  text: string | number | undefined | null,
  x: number,
  topY: number,
  options: {
    font: PDFFont;
    maxLength?: number;
    maxWidth?: number;
    pageHeight: number;
    size?: number;
  }
) {
  const value = cleanText(text);

  if (!value) {
    return;
  }

  const size = options.size ?? 8;
  const truncatedText = options.maxLength ? truncateText(value, options.maxLength) : value;
  const finalText = options.maxWidth ? shrinkToWidth(truncatedText, options.font, size, options.maxWidth) : truncatedText;

  page.drawText(finalText, {
    x,
    y: yFromTop(options.pageHeight, topY, size),
    size,
    font: options.font,
    color: black
  });
}

function drawCheckMark(page: PDFPage, selected: boolean, x: number, topY: number, font: PDFFont, pageHeight: number) {
  if (!selected) {
    return;
  }

  page.drawText("X", {
    x,
    y: yFromTop(pageHeight, topY, 8),
    size: 8,
    font,
    color: black
  });
}

function getRecommendedReorderQuantity(item: InventoryItem) {
  return Math.max(1, item.minimumStockLevel - item.quantityOnHand);
}

function getLineQuantity(item: InventoryItem, lineDrafts: Record<string, RequisitionLineDraft>) {
  const parsed = Number(lineDrafts[item.id]?.quantity ?? getRecommendedReorderQuantity(item));

  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : getRecommendedReorderQuantity(item);
}

function getGrandTotal(group: RequisitionVendorGroup, lineDrafts: Record<string, RequisitionLineDraft>) {
  return group.items.reduce((total, item) => total + getLineQuantity(item, lineDrafts) * item.costEach, 0);
}

function getComments(header: RequisitionHeaderDraft) {
  const comments = cleanText(header.comments);

  if (header.priority !== "High") {
    return comments;
  }

  if (!comments) {
    return "HIGH PRIORITY";
  }

  return /^high priority\b/i.test(comments) ? comments : `HIGH PRIORITY - ${comments}`;
}

async function loadTemplate(requisitionType: RequisitionType) {
  const response = await fetch(templatePaths[requisitionType]);

  if (!response.ok) {
    throw new Error(`Official requisition PDF template is missing: ${templatePaths[requisitionType]}`);
  }

  return PDFDocument.load(await response.arrayBuffer());
}

function stampHeader({
  boldFont,
  group,
  header,
  page,
  pageHeight,
  positions,
  regularFont
}: {
  boldFont: PDFFont;
  group: RequisitionVendorGroup;
  header: RequisitionHeaderDraft;
  page: PDFPage;
  pageHeight: number;
  positions: StampPositions;
  regularFont: PDFFont;
}) {
  const draw = (text: string | number | undefined | null, point: Point, options: { maxLength?: number; maxWidth?: number; size?: number } = {}) =>
    drawTextSafe(page, text, point.x, point.topY, { font: regularFont, pageHeight, ...options });
  const vendorAddressLines = header.vendorAddress
    .split(/\r?\n/)
    .map((line) => cleanText(line))
    .filter(Boolean);
  const fob = cleanText(header.fob).toLowerCase();
  const taxExempt = cleanText(header.taxExempt).toLowerCase();
  const materialCert = cleanText(header.materialCert).toLowerCase();

  draw(header.poNo, positions.poNo, { maxLength: 20 });
  draw(header.poInitiator, positions.poInitiator, { maxLength: 28 });
  draw(header.shipVia, positions.shipVia, { maxLength: 24 });
  draw(header.poClass, positions.poClass, { maxLength: 20 });
  draw(formatDate(header.reqDate), positions.reqDate, { maxLength: 16 });
  draw(header.vendorName || group.vendorName, positions.vendorName, { maxLength: 34 });
  draw(header.confirmedWith, positions.confirmedWith, { maxLength: 30 });
  draw(vendorAddressLines[0] ?? "", positions.vendorAddressLine1, { maxLength: 42 });
  draw(vendorAddressLines[1] ?? "", positions.vendorAddressLine2, { maxLength: 42 });
  draw(header.partNo, positions.partNo, { maxLength: 22 });
  draw(header.jobNo, positions.jobNo, { maxLength: 22 });
  draw(header.assetNo, positions.assetNo, { maxLength: 24 });
  draw(header.moldNo, positions.moldNo, { maxLength: 24 });
  draw(header.initials, positions.initials, { maxLength: 10 });
  draw(header.tsNo, positions.tsNo, { maxLength: 18 });
  draw(header.codeNo, positions.codeNo, { maxLength: 18 });
  draw(header.workOrderNo, positions.workOrderNo, { maxLength: 24 });
  draw(header.equipmentNo, positions.equipmentNo, { maxLength: 24 });
  draw(getComments(header), positions.comments, { maxLength: 110, maxWidth: 330 });
  draw(header.departmentManager, positions.departmentManager, { maxLength: 28 });
  draw(header.requisitionedBy, positions.requisitionedBy, { maxLength: 28 });
  draw(header.authorizedBy, positions.authorizedBy, { maxLength: 28 });

  drawCheckMark(page, taxExempt === "yes", positions.taxExemptYes.x, positions.taxExemptYes.topY, regularFont, pageHeight);
  drawCheckMark(page, taxExempt !== "yes", positions.taxExemptNo.x, positions.taxExemptNo.topY, regularFont, pageHeight);
  drawCheckMark(page, materialCert === "yes", positions.materialCertYes.x, positions.materialCertYes.topY, regularFont, pageHeight);
  drawCheckMark(page, materialCert !== "yes", positions.materialCertNo.x, positions.materialCertNo.topY, regularFont, pageHeight);
  drawCheckMark(page, fob.includes("origin"), positions.fobOrigin.x, positions.fobOrigin.topY, boldFont, pageHeight);
  drawCheckMark(page, fob.includes("destination"), positions.fobDestination.x, positions.fobDestination.topY, boldFont, pageHeight);
}

function stampLineItems({
  group,
  lineDrafts,
  page,
  pageHeight,
  positions,
  regularFont
}: {
  group: RequisitionVendorGroup;
  lineDrafts: Record<string, RequisitionLineDraft>;
  page: PDFPage;
  pageHeight: number;
  positions: StampPositions;
  regularFont: PDFFont;
}) {
  group.items.slice(0, positions.maxLineRows).forEach((item, index) => {
    const lineTopY = positions.lineStartTopY + index * positions.lineRowHeight;
    const quantity = getLineQuantity(item, lineDrafts);
    const dueDate = lineDrafts[item.id]?.dueDate ?? "";

    drawTextSafe(page, quantity, positions.lineQuantityX, lineTopY, { font: regularFont, size: 8, pageHeight });
    drawTextSafe(page, cleanText(item.stockUnit), positions.lineUnitX, lineTopY, { font: regularFont, size: 8, pageHeight });
    drawTextSafe(page, item.partNumber || item.name, positions.lineItemNumberX, lineTopY, {
      font: regularFont,
      maxLength: 18,
      pageHeight,
      size: 8
    });
    drawTextSafe(page, item.description || item.name, positions.lineDescriptionX, lineTopY, {
      font: regularFont,
      maxLength: 48,
      pageHeight,
      size: 7
    });
    drawTextSafe(page, formatDate(dueDate), positions.lineDueDateX, lineTopY, { font: regularFont, size: 8, pageHeight });
    drawTextSafe(page, money(item.costEach), positions.lineUnitPriceX, lineTopY, { font: regularFont, size: 8, pageHeight });
    drawTextSafe(page, money(quantity * item.costEach), positions.lineTotalPriceX, lineTopY, { font: regularFont, size: 8, pageHeight });
  });
}

export async function generateOfficialRequisitionPdf({
  group,
  header,
  lineDrafts,
  requisitionType
}: {
  group: RequisitionVendorGroup;
  header: RequisitionHeaderDraft;
  lineDrafts: Record<string, RequisitionLineDraft>;
  requisitionType: RequisitionType;
}): Promise<Uint8Array> {
  const pdfDoc = await loadTemplate(requisitionType);
  const page = pdfDoc.getPage(0);
  const { width, height } = page.getSize();
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const positions = positionsByType[requisitionType];
  void width;

  stampHeader({ page, regularFont, boldFont, positions, group, header, pageHeight: height });
  stampLineItems({ page, regularFont, positions, group, lineDrafts, pageHeight: height });

  return pdfDoc.save();
}

export function downloadPdf(bytes: Uint8Array, fileName: string) {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
