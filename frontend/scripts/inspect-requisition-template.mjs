import XlsxPopulate from "xlsx-populate";
import { execFileSync } from "node:child_process";
import path from "node:path";

const templates = [
  ["over100", "public/templates/requisition-over-100.xlsx"],
  ["under100", "public/templates/requisition-under-100.xlsx"]
];

const keywords = [
  "tax",
  "exempt",
  "yes",
  "no",
  "material",
  "cert",
  "f.o.b",
  "origin",
  "destination",
  "requisition",
  "p.o",
  "req",
  "vendor",
  "confirmed"
];

function cellAddress(columnNumber, rowNumber) {
  let columnName = "";
  let value = columnNumber;

  while (value > 0) {
    const remainder = (value - 1) % 26;
    columnName = String.fromCharCode(65 + remainder) + columnName;
    value = Math.floor((value - 1) / 26);
  }

  return `${columnName}${rowNumber}`;
}

function isNonEmpty(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function includesKeyword(value) {
  const text = String(value);

  return keywords.some((keyword) => text.toLowerCase().includes(keyword));
}

function readZipEntry(filePath, entryPath) {
  try {
    return execFileSync("tar", ["-xOf", filePath, entryPath], { encoding: "utf8" });
  } catch {
    return "";
  }
}

function decodeXmlText(value) {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function columnNumber(address) {
  const columnName = /^[A-Z]+/i.exec(address)?.[0].toUpperCase() ?? "";

  return columnName.split("").reduce((sum, character) => sum * 26 + character.charCodeAt(0) - 64, 0);
}

function rowNumber(address) {
  return Number(/\d+/.exec(address)?.[0] ?? 0);
}

function rangeIntersectsA1O25(range) {
  const [start, end = start] = range.split(":");
  const startColumn = columnNumber(start);
  const endColumn = columnNumber(end);
  const startRow = rowNumber(start);
  const endRow = rowNumber(end);

  return startColumn <= 15 && endColumn >= 1 && startRow <= 25 && endRow >= 1;
}

function getMergedRanges(filePath) {
  const sheetXml = readZipEntry(filePath, "xl/worksheets/sheet1.xml");
  const ranges = [];

  for (const [, range] of sheetXml.matchAll(/<mergeCell[^>]*\bref="([^"]+)"/g)) {
    if (rangeIntersectsA1O25(range)) {
      ranges.push(range);
    }
  }

  return ranges;
}

function getRowHeights(filePath) {
  const sheetXml = readZipEntry(filePath, "xl/worksheets/sheet1.xml");
  const heights = new Map();

  for (const [, row, height] of sheetXml.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*\bht="([^"]+)"/g)) {
    const rowNumberValue = Number(row);

    if (rowNumberValue >= 1 && rowNumberValue <= 25) {
      heights.set(rowNumberValue, height);
    }
  }

  return heights;
}

function getColumnWidths(filePath) {
  const sheetXml = readZipEntry(filePath, "xl/worksheets/sheet1.xml");
  const widths = new Map();

  for (const [, min, max, width] of sheetXml.matchAll(/<col\b[^>]*\bmin="(\d+)"[^>]*\bmax="(\d+)"[^>]*\bwidth="([^"]+)"/g)) {
    const minColumn = Number(min);
    const maxColumn = Number(max);

    for (let column = Math.max(1, minColumn); column <= Math.min(15, maxColumn); column += 1) {
      widths.set(column, width);
    }
  }

  return widths;
}

function getPageSetup(filePath) {
  const sheetXml = readZipEntry(filePath, "xl/worksheets/sheet1.xml");
  const pageSetup = /<pageSetup\b([^>]*)\/?>/i.exec(sheetXml)?.[1] ?? "";
  const pageMargins = /<pageMargins\b([^>]*)\/?>/i.exec(sheetXml)?.[1] ?? "";

  return { pageMargins, pageSetup };
}

function getPrintAreas(filePath) {
  const workbookXml = readZipEntry(filePath, "xl/workbook.xml");
  const areas = [];

  for (const match of workbookXml.matchAll(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g)) {
    const [, attributes, value] = match;

    if (attributes.includes("_xlnm.Print_Area")) {
      areas.push(decodeXmlText(value.trim()));
    }
  }

  return areas;
}

function getCheckboxControls(filePath) {
  const vml = readZipEntry(filePath, "xl/drawings/vmlDrawing1.vml");

  if (!vml) {
    return [];
  }

  const controls = [];
  const shapeMatches = vml.matchAll(/<v:shape\b[\s\S]*?<\/v:shape>/g);

  for (const [shape] of shapeMatches) {
    if (!shape.includes('ObjectType="Checkbox"')) {
      continue;
    }

    const label = /<font\b[^>]*>([\s\S]*?)<\/font>/i.exec(shape)?.[1];
    const anchor = /<x:Anchor>\s*([\s\S]*?)\s*<\/x:Anchor>/i.exec(shape)?.[1];

    if (!label || !anchor) {
      continue;
    }

    const anchorNumbers = anchor
      .split(",")
      .map((part) => Number(part.trim()))
      .filter(Number.isFinite);

    if (anchorNumbers.length < 8) {
      continue;
    }

    const [startColumn, , startRow, , endColumn, , endRow] = anchorNumbers;
    const markColumn = startColumn + 1;
    const markRow = Math.round((startRow + endRow) / 2) + 1;

    controls.push({
      label: decodeXmlText(label.trim()),
      anchor: anchorNumbers.join(", "),
      markCell: cellAddress(markColumn, markRow),
      range: `${cellAddress(startColumn + 1, startRow + 1)}:${cellAddress(endColumn + 1, endRow + 1)}`
    });
  }

  return controls;
}

for (const [name, filePath] of templates) {
  const workbook = await XlsxPopulate.fromFileAsync(path.resolve(filePath));
  const sheet = workbook.sheet(0);
  const resolvedFilePath = path.resolve(filePath);

  console.log(`\n================ ${name} ================`);
  console.log("\n--- Non-empty cells A1:O25 ---");

  for (let row = 1; row <= 25; row += 1) {
    for (let column = 1; column <= 15; column += 1) {
      const address = cellAddress(column, row);
      const value = sheet.cell(address).value();

      if (isNonEmpty(value)) {
        console.log(`${address}: ${JSON.stringify(value)}`);
      }
    }
  }

  console.log("\n--- Keyword cells A1:O25 ---");

  for (let row = 1; row <= 25; row += 1) {
    for (let column = 1; column <= 15; column += 1) {
      const address = cellAddress(column, row);
      const value = sheet.cell(address).value();

      if (isNonEmpty(value) && includesKeyword(value)) {
        console.log(`${address}: ${JSON.stringify(value)}`);
      }
    }
  }

  console.log("\n--- Merged ranges intersecting A1:O25 ---");
  const mergedRanges = getMergedRanges(resolvedFilePath);
  console.log(mergedRanges.length ? mergedRanges.join("\n") : "(none)");

  console.log("\n--- Row heights 1:25 ---");
  const rowHeights = getRowHeights(resolvedFilePath);
  for (let row = 1; row <= 25; row += 1) {
    console.log(`${row}: ${rowHeights.get(row) ?? "(default)"}`);
  }

  console.log("\n--- Column widths A:O ---");
  const columnWidths = getColumnWidths(resolvedFilePath);
  for (let column = 1; column <= 15; column += 1) {
    console.log(`${cellAddress(column, 1).replace("1", "")}: ${columnWidths.get(column) ?? "(default)"}`);
  }

  console.log("\n--- Page setup / print area ---");
  const { pageMargins, pageSetup } = getPageSetup(resolvedFilePath);
  const printAreas = getPrintAreas(resolvedFilePath);
  console.log(`pageMargins: ${pageMargins || "(not set)"}`);
  console.log(`pageSetup: ${pageSetup || "(not set)"}`);
  console.log(`printArea: ${printAreas.length ? printAreas.join("; ") : "(not set)"}`);

  console.log("\n--- Checkbox controls from workbook VML ---");

  getCheckboxControls(resolvedFilePath).forEach((control, index) => {
    console.log(
      `${index + 1}. ${control.label}: range ${control.range}, anchor ${control.anchor}, suggested mark cell ${control.markCell}`
    );
  });
}
