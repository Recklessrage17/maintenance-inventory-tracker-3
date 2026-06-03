import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { InventoryItem, RequisitionHeaderDraft, RequisitionLineDraft, RequisitionVendorGroup } from "../types";
import { generateOfficialRequisitionWorkbook } from "./requisitionTemplate";

type RequisitionType = "under100" | "over100";

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type TauriPdfExportResult = {
  fileName: string;
  pdfBase64: string;
};

const pdfMimeType = "application/pdf";
const officialRequisitionRowsPerPage = 8;

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

export function base64ToUint8Array(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

export function downloadPdf(bytes: Uint8Array, fileName: string) {
  const blob = new Blob([bytes as BlobPart], { type: pdfMimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function getTauriInvoke(): TauriInvoke | undefined {
  const tauriWindow = window as Window & {
    __TAURI__?: {
      core?: {
        invoke?: TauriInvoke;
      };
    };
  };

  return tauriWindow.__TAURI__?.core?.invoke;
}

function getSafeFileNameBase(group: RequisitionVendorGroup, header: RequisitionHeaderDraft, requisitionType: RequisitionType) {
  const vendor =
    (header.vendorName || group.vendorName || "vendor")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "") || "vendor";
  const typeLabel = requisitionType === "under100" ? "under-100" : "over-100";

  return `official-requisition-${typeLabel}-${vendor}`;
}

function chunkItems<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks.length ? chunks : [[]];
}

function createPagedGroup(group: RequisitionVendorGroup, items: InventoryItem[]): RequisitionVendorGroup {
  return {
    ...group,
    items
  };
}

function getLineQuantityForPdf(item: InventoryItem, lineDrafts: Record<string, RequisitionLineDraft>) {
  const rawValue = lineDrafts[item.id]?.quantity;

  if (rawValue === undefined || rawValue.trim() === "") {
    return Math.max(1, item.minimumStockLevel - item.quantityOnHand);
  }

  const parsed = Number(rawValue);

  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : Math.max(1, item.minimumStockLevel - item.quantityOnHand);
}

function getVendorGrandTotal(group: RequisitionVendorGroup, lineDrafts: Record<string, RequisitionLineDraft>) {
  return group.items.reduce((sum, item) => {
    const unitPrice = Number.isFinite(item.costEach) ? item.costEach : 0;

    return sum + getLineQuantityForPdf(item, lineDrafts) * unitPrice;
  }, 0);
}

async function mergePdfFiles(pdfFiles: Uint8Array[]) {
  const mergedPdf = await PDFDocument.create();

  for (const pdfBytes of pdfFiles) {
    const sourcePdf = await PDFDocument.load(pdfBytes);
    const copiedPages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());

    copiedPages.forEach((page) => mergedPdf.addPage(page));
  }

  return mergedPdf.save();
}

async function stampPageNumbers(pdfBytes: Uint8Array) {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();
  const totalPages = pages.length;

  pages.forEach((page, index) => {
    const { width } = page.getSize();

    page.drawText(`Page ${index + 1} of ${totalPages}`, {
      x: width - 82,
      y: 16,
      size: 7,
      font,
      color: rgb(0, 0, 0)
    });
  });

  return pdfDoc.save();
}

export async function generateOfficialPdfFromExcelTemplate({
  group,
  header,
  lineDrafts,
  requisitionType
}: {
  group: RequisitionVendorGroup;
  header: RequisitionHeaderDraft;
  lineDrafts: Record<string, RequisitionLineDraft>;
  requisitionType: RequisitionType;
}): Promise<void> {
  const invoke = getTauriInvoke();

  if (!invoke) {
    throw new Error("Official PDF export is available in the desktop app build.");
  }

  try {
    const itemChunks = chunkItems(group.items, officialRequisitionRowsPerPage);
    const totalPages = itemChunks.length;
    const fullVendorTotal = getVendorGrandTotal(group, lineDrafts);
    const convertedPages: Uint8Array[] = [];

    for (let pageIndex = 0; pageIndex < itemChunks.length; pageIndex += 1) {
      const pageItems = itemChunks[pageIndex];
      const pagedGroup = createPagedGroup(group, pageItems);
      const pageHeader =
        totalPages > 1
          ? {
              ...header,
              comments: `${header.comments.trim() || "Maintenance inventory restock."} Page ${pageIndex + 1} of ${totalPages}.`
            }
          : header;

      const workbookBlob = await generateOfficialRequisitionWorkbook({
        group: pagedGroup,
        header: pageHeader,
        lineDrafts,
        requisitionType,
        grandTotalOverride: fullVendorTotal
      });
      const workbookBase64 = arrayBufferToBase64(await workbookBlob.arrayBuffer());
      const pageFileNameBase =
        totalPages > 1
          ? `${getSafeFileNameBase(group, header, requisitionType)}-page-${pageIndex + 1}`
          : getSafeFileNameBase(group, header, requisitionType);

      const result = await invoke<TauriPdfExportResult>("export_requisition_xlsx_to_pdf", {
        workbookBase64,
        fileNameBase: pageFileNameBase,
        taxExempt: pageHeader.taxExempt,
        materialCert: pageHeader.materialCert,
        fob: pageHeader.fob
      });

      const convertedPdfBytes = base64ToUint8Array(result.pdfBase64);
      convertedPages.push(convertedPdfBytes);
    }

    const mergedPdfBytes = convertedPages.length === 1 ? convertedPages[0] : await mergePdfFiles(convertedPages);
    const finalPdfBytes = convertedPages.length > 1 ? await stampPageNumbers(mergedPdfBytes) : mergedPdfBytes;

    downloadPdf(finalPdfBytes, `${getSafeFileNameBase(group, header, requisitionType)}.pdf`);
  } catch (error) {
    if (typeof error === "string") {
      throw new Error(error);
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error("Official PDF export failed in the desktop backend.");
  }
}
