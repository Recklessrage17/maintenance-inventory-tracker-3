#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
    time::Duration,
    time::UNIX_EPOCH,
};

use base64::{engine::general_purpose, Engine as _};
use regex::Regex;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_sql::{Migration, MigrationKind};

const SQLITE_CONNECTION: &str = "sqlite:maintenance_inventory_3.db";

fn sqlite_migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "initial_schema",
            sql: include_str!("../migrations/001_initial_schema.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "vendor_contact_email",
            sql: include_str!("../migrations/002_vendor_contact_email.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "inventory_live_fields",
            sql: include_str!("../migrations/003_inventory_live_fields.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "stock_ledger_mirror_fields",
            sql: include_str!("../migrations/004_stock_ledger_mirror_fields.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "requisition_mirror_fields",
            sql: include_str!("../migrations/005_requisition_mirror_fields.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "deleted_records_mirror_fields",
            sql: include_str!("../migrations/006_deleted_records_mirror_fields.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "inventory_watchlist_visibility",
            sql: include_str!("../migrations/007_inventory_watchlist_visibility.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "inventory_non_stocked",
            sql: include_str!("../migrations/008_inventory_non_stocked.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupFileReadResult {
    contents: String,
    last_modified_ms: Option<u64>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupFileWriteResult {
    last_modified_ms: Option<u64>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CsvFileReadResult {
    contents: String,
    exists: bool,
    last_modified_ms: Option<u64>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CsvFileWriteResult {
    last_modified_ms: Option<u64>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallerFileList {
    folder_exists: bool,
    file_names: Vec<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WebsitePreview {
    final_url: String,
    title: String,
    description: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RequisitionPdfExportResult {
    pdf_base64: String,
    file_name: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PdfEngineStatus {
    excel_available: bool,
    #[serde(rename = "libreOfficeAvailable")]
    libreoffice_available: bool,
    #[serde(rename = "libreOfficePath")]
    libreoffice_path: Option<String>,
    preferred_engine: String,
    ready: bool,
    message: String,
}

fn backup_file_path(directory_path: &str, file_name: &str) -> Result<PathBuf, String> {
    if file_name.contains('/') || file_name.contains('\\') || file_name.contains("..") {
        return Err("Backup file name is invalid.".to_string());
    }

    Ok(PathBuf::from(directory_path).join(file_name))
}

fn is_safe_csv_segment(segment: &str) -> bool {
    !segment.trim().is_empty()
        && !segment.contains('/')
        && !segment.contains('\\')
        && !segment.contains("..")
}

fn csv_file_path(directory_path: &str, relative_path: Vec<String>) -> Result<PathBuf, String> {
    if directory_path.trim().is_empty() {
        return Err("CSV folder path is required.".to_string());
    }

    if !relative_path.iter().all(|segment| is_safe_csv_segment(segment)) {
        return Err("CSV file path is invalid.".to_string());
    }

    let valid_static_file = relative_path.len() == 2
        && matches!(relative_path[0].as_str(), "Inventory" | "Vendors" | "Locations")
        && matches!(
            (relative_path[0].as_str(), relative_path[1].as_str()),
            ("Inventory", "inventory.csv")
                | ("Vendors", "vendors.csv")
                | ("Locations", "locations.csv")
        );

    let history_pattern = Regex::new(r"^\d{4}$").map_err(|error| error.to_string())?;
    let month_pattern = Regex::new(r"^\d{4}-\d{2}$").map_err(|error| error.to_string())?;
    let valid_history_file = relative_path.len() == 4
        && relative_path[0] == "History Logs"
        && history_pattern.is_match(&relative_path[1])
        && month_pattern.is_match(&relative_path[2])
        && relative_path[1] == relative_path[2][0..4]
        && relative_path[3] == format!("stock-history-{}.csv", relative_path[2]);

    if !valid_static_file && !valid_history_file {
        return Err("CSV file path is not owned by this feature.".to_string());
    }

    let mut path = PathBuf::from(directory_path);

    for segment in relative_path {
        path.push(segment);
    }

    Ok(path)
}

fn last_modified_ms(path: &Path) -> Option<u64> {
    fs::metadata(path)
        .ok()?
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
}

fn normalize_website_url(url: &str) -> String {
    let trimmed = url.trim();

    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{}", trimmed)
    }
}

fn decode_basic_html_entities(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

fn clean_html_text(value: &str) -> String {
    let without_tags = Regex::new(r"(?is)<[^>]+>")
        .ok()
        .map(|regex| regex.replace_all(value, " ").to_string())
        .unwrap_or_else(|| value.to_string());
    let collapsed = Regex::new(r"\s+")
        .ok()
        .map(|regex| regex.replace_all(&without_tags, " ").to_string())
        .unwrap_or(without_tags);

    decode_basic_html_entities(collapsed.trim())
}

fn first_capture(html: &str, patterns: &[&str]) -> String {
    for pattern in patterns {
        if let Ok(regex) = Regex::new(pattern) {
            if let Some(capture) = regex.captures(html).and_then(|captures| captures.get(1)) {
                let value = clean_html_text(capture.as_str());

                if !value.is_empty() {
                    return value;
                }
            }
        }
    }

    String::new()
}

fn safe_file_name_base(value: &str) -> String {
    let mut safe = String::new();
    let mut previous_was_separator = false;

    for character in value.chars() {
        let next = if character.is_ascii_alphanumeric() {
            previous_was_separator = false;
            Some(character)
        } else if character == '-' || character == '_' {
            previous_was_separator = false;
            Some(character)
        } else if !previous_was_separator {
            previous_was_separator = true;
            Some('-')
        } else {
            None
        };

        if let Some(character) = next {
            safe.push(character);
        }
    }

    let safe = safe.trim_matches('-').to_string();

    if safe.is_empty() {
        "official-requisition".to_string()
    } else {
        safe
    }
}

fn path_to_string(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(|value| value.to_string())
        .ok_or_else(|| "Temporary export path contains unsupported characters.".to_string())
}

fn output_message(output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

    if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        format!("Process exited with status {}.", output.status)
    }
}

fn run_command_hidden_with_timeout(
    mut command: Command,
    timeout: Duration,
) -> Result<Output, String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|error| error.to_string())?;
    let start = std::time::Instant::now();

    loop {
        if child
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_some()
        {
            return child.wait_with_output().map_err(|error| error.to_string());
        }

        if start.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(
                "Official PDF export timed out. Microsoft Excel or LibreOffice may be stuck in the background."
                    .to_string(),
            );
        }

        std::thread::sleep(Duration::from_millis(100));
    }
}

#[cfg(target_os = "windows")]
fn try_excel_com_export(
    xlsx_path: &Path,
    pdf_path: &Path,
    output_dir: &Path,
    tax_exempt: &str,
    material_cert: &str,
    fob: &str,
) -> Result<(), String> {
    let script = r#"
param(
  [Parameter(Mandatory=$true)][string]$XlsxPath,
  [Parameter(Mandatory=$true)][string]$PdfPath,
  [string]$TaxExempt = "",
  [string]$MaterialCert = "",
  [string]$Fob = ""
)

$excel = $null
$workbook = $null
$worksheet = $null
$workbookClosed = $false

function Normalize-Choice([string]$value) {
  if ($null -eq $value) { return "" }
  return $value.Trim().ToLowerInvariant()
}

function Set-FormCheckbox($checkbox, [bool]$checked) {
  $value = if ($checked) { 1 } else { -4146 }

  try {
    $checkbox.Value = $value
    return $true
  } catch {}

  try {
    $checkbox.ControlFormat.Value = $value
    return $true
  } catch {}

  try {
    $checkbox.OLEFormat.Object.Value = $checked
    return $true
  } catch {}

  return $false
}

function Add-CheckboxControl($items, $seen, [string]$kind, $object, [string]$name, [string]$caption, [double]$left, [double]$top) {
  $key = if ($name.Trim()) { $name.Trim() } else { "$kind-$left-$top-$caption" }

  if ($seen.ContainsKey($key)) {
    return
  }

  $seen[$key] = $true
  $items.Add([PSCustomObject]@{
    Kind = $kind
    Object = $object
    Name = $name
    Caption = $caption
    Left = $left
    Top = $top
  }) | Out-Null
}

function Get-CheckboxControls($worksheet) {
  $items = New-Object System.Collections.ArrayList
  $seen = @{}

  try {
    foreach ($cb in $worksheet.CheckBoxes()) {
      $name = ""
      $caption = ""
      $left = 0
      $top = 0

      try { $name = [string]$cb.Name } catch {}
      try { $caption = [string]$cb.Caption } catch {}
      try { $left = [double]$cb.Left } catch {}
      try { $top = [double]$cb.Top } catch {}

      Add-CheckboxControl $items $seen "CheckBox" $cb $name $caption $left $top
    }
  } catch {}

  try {
    foreach ($shape in $worksheet.Shapes) {
      $name = ""
      $caption = ""
      $left = 0
      $top = 0
      $type = $null

      try { $name = [string]$shape.Name } catch {}
      try { $caption = [string]$shape.TextFrame.Characters().Text } catch {}
      try { $left = [double]$shape.Left } catch {}
      try { $top = [double]$shape.Top } catch {}
      try { $type = $shape.Type } catch {}

      if ($type -eq 8 -or $name -match "Check|Box|Option" -or $caption -match "YES|NO|Origin|Destination") {
        Add-CheckboxControl $items $seen "Shape" $shape $name $caption $left $top
      }
    }
  } catch {}

  return $items.ToArray()
}

function Find-NearestCheckbox($checkboxes, [double]$targetLeft, [double]$targetTop) {
  $best = $null
  $bestDistance = [double]::MaxValue

  foreach ($item in $checkboxes) {
    $dx = [double]$item.Left - $targetLeft
    $dy = [double]$item.Top - $targetTop
    $distance = [Math]::Sqrt(($dx * $dx) + ($dy * $dy))

    if ($distance -lt $bestDistance) {
      $bestDistance = $distance
      $best = $item
    }
  }

  return $best
}

function Group-CheckboxRows($items, [double]$tolerance) {
  $rows = @()

  foreach ($item in ($items | Sort-Object Top, Left)) {
    $matched = $false

    foreach ($row in $rows) {
      if ([Math]::Abs(([double]$row.Top) - ([double]$item.Top)) -le $tolerance) {
        $row.Items = @($row.Items + $item)
        $matched = $true
        break
      }
    }

    if (-not $matched) {
      $rows += [PSCustomObject]@{
        Top = [double]$item.Top
        Items = @($item)
      }
    }
  }

  foreach ($row in $rows) {
    $row.Items = @($row.Items | Sort-Object Left)
  }

  return @($rows | Sort-Object Top)
}

function Get-ExactRowItems($row, [int]$expectedCount, [string]$label) {
  $items = @($row.Items | Sort-Object Left)

  if ($items.Count -eq $expectedCount) {
    return $items
  }

  Write-Host "$label row had $($items.Count) checkbox candidates. Leaving that row blank."
  return @()
}

function Set-RequisitionCheckboxes($worksheet, [string]$taxExempt, [string]$materialCert, [string]$fob) {
  $tax = Normalize-Choice $taxExempt
  $mat = Normalize-Choice $materialCert
  $fobChoice = Normalize-Choice $fob
  $checkboxes = @(Get-CheckboxControls $worksheet | Sort-Object Top, Left)

  Write-Host "Detected checkbox controls:"
  for ($i = 0; $i -lt $checkboxes.Count; $i++) {
    $item = $checkboxes[$i]
    Write-Host ("[{0}] Kind={1} Name={2} Caption={3} Left={4} Top={5}" -f $i, $item.Kind, $item.Name, $item.Caption, $item.Left, $item.Top)
  }

  if ($checkboxes.Count -lt 4) {
    Write-Host "No usable Excel checkbox controls found. Leaving checkbox boxes blank."
    return
  }

  foreach ($item in $checkboxes) {
    Set-FormCheckbox $item.Object $false | Out-Null
  }

  $headerBoxes = @($checkboxes | Where-Object { $_.Top -lt 260 } | Sort-Object Top, Left)
  $taxMaterialBoxes = @(
    $headerBoxes |
      Where-Object {
        ($_.Caption -match "YES|NO" -and $_.Left -gt 250 -and $_.Left -lt 540) -or
        ($_.Left -gt 300 -and $_.Left -lt 520)
      } |
      Sort-Object Top, Left
  )
  $fobBoxes = @(
    $headerBoxes |
      Where-Object {
        ($_.Caption -match "Origin|Destination") -or
        ($_.Left -ge 520)
      } |
      Sort-Object Top, Left
  )

  $taxMaterialRows = @(Group-CheckboxRows $taxMaterialBoxes 8)
  $fobRows = @(Group-CheckboxRows $fobBoxes 8)

  if ($taxMaterialRows.Count -ge 2) {
    $taxRow = @(Get-ExactRowItems $taxMaterialRows[0] 2 "Tax Exempt")
    $matRow = @(Get-ExactRowItems $taxMaterialRows[1] 2 "Material Cert")

    if ($taxRow.Count -eq 2) {
      Set-FormCheckbox $taxRow[0].Object ($tax -eq "yes") | Out-Null
      Set-FormCheckbox $taxRow[1].Object ($tax -ne "yes") | Out-Null
    }

    if ($matRow.Count -eq 2) {
      Set-FormCheckbox $matRow[0].Object ($mat -eq "yes") | Out-Null
      Set-FormCheckbox $matRow[1].Object ($mat -ne "yes") | Out-Null
    }
  } else {
    Write-Host "Tax/Material checkbox rows were not found cleanly. Leaving them blank."
  }

  if ($fobRows.Count -ge 2) {
    $originRow = @(Get-ExactRowItems $fobRows[0] 1 "F.O.B. Origin")
    $destinationRow = @(Get-ExactRowItems $fobRows[1] 1 "F.O.B. Destination")

    if ($originRow.Count -eq 1) {
      Set-FormCheckbox $originRow[0].Object ($fobChoice -eq "origin") | Out-Null
    }

    if ($destinationRow.Count -eq 1) {
      Set-FormCheckbox $destinationRow[0].Object ($fobChoice -eq "destination") | Out-Null
    }
  } else {
    Write-Host "F.O.B checkbox rows were not found cleanly. Leaving them blank."
  }
}

try {
  if (-not (Test-Path -LiteralPath $XlsxPath)) {
    throw "Workbook was not found: $XlsxPath"
  }

  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.AskToUpdateLinks = $false
  $excel.DisplayAlerts = $false
  $excel.EnableEvents = $false

  $workbook = $excel.Workbooks.Open($XlsxPath, 0, $true)
  $worksheet = $workbook.Worksheets.Item(1)
  $worksheet.Activate() | Out-Null

  try {
    Set-RequisitionCheckboxes $worksheet $TaxExempt $MaterialCert $Fob
  } catch {
    Write-Host "Checkbox control update skipped: $($_.Exception.Message)"
  }

  try {
    $worksheet.PageSetup.Zoom = $false
    $worksheet.PageSetup.FitToPagesWide = 1
    $worksheet.PageSetup.FitToPagesTall = 1
    $worksheet.PageSetup.CenterHorizontally = $true
    $worksheet.PageSetup.CenterVertically = $false

    $worksheet.PageSetup.LeftMargin = $excel.InchesToPoints(0.90)
    $worksheet.PageSetup.RightMargin = $excel.InchesToPoints(0.35)
    $worksheet.PageSetup.TopMargin = $excel.InchesToPoints(0.35)
    $worksheet.PageSetup.BottomMargin = $excel.InchesToPoints(0.35)
  } catch {}

  try { $excel.CalculateFullRebuild() } catch {}

  $workbook.ExportAsFixedFormat(0, $PdfPath)

  $workbook.Close($false)
  $workbookClosed = $true

  if (-not (Test-Path -LiteralPath $PdfPath)) {
    throw "Microsoft Excel did not create a PDF at: $PdfPath"
  }
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
} finally {
  if ($workbook -ne $null -and -not $workbookClosed) {
    try { $workbook.Close($false) } catch {}
  }

  if ($excel -ne $null) {
    try { $excel.Quit() } catch {}
  }

  if ($worksheet -ne $null) {
    try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($worksheet) | Out-Null } catch {}
  }
  if ($workbook -ne $null) {
    try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($workbook) | Out-Null } catch {}
  }
  if ($excel -ne $null) {
    try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null } catch {}
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
"#;
    let script_path = output_dir.join("export-requisition-pdf.ps1");
    let mut command = Command::new("powershell.exe");

    fs::write(&script_path, script)
        .map_err(|error| format!("Could not write Excel PDF export script: {}", error))?;

    command
        .arg("-NoProfile")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-File")
        .arg(&script_path)
        .arg("-XlsxPath")
        .arg(xlsx_path)
        .arg("-PdfPath")
        .arg(pdf_path)
        .arg("-TaxExempt")
        .arg(tax_exempt)
        .arg("-MaterialCert")
        .arg(material_cert)
        .arg("-Fob")
        .arg(fob);

    let output = run_command_hidden_with_timeout(command, Duration::from_secs(90))?;

    if !output.status.success() {
        return Err(format!(
            "Microsoft Excel COM export failed: {}",
            output_message(&output)
        ));
    }

    if !pdf_path.exists() {
        return Err(format!(
            "Microsoft Excel did not create a requisition PDF at {}.",
            path_to_string(pdf_path)?
        ));
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn try_excel_com_export(
    _xlsx_path: &Path,
    _pdf_path: &Path,
    _output_dir: &Path,
    _tax_exempt: &str,
    _material_cert: &str,
    _fob: &str,
) -> Result<(), String> {
    Err("Microsoft Excel COM export is only available on Windows.".to_string())
}

fn libreoffice_candidates() -> Vec<PathBuf> {
    vec![
        PathBuf::from("soffice"),
        PathBuf::from("libreoffice"),
        PathBuf::from(r"C:\Program Files\LibreOffice\program\soffice.exe"),
        PathBuf::from(r"C:\Program Files (x86)\LibreOffice\program\soffice.exe"),
    ]
}

#[cfg(target_os = "windows")]
fn is_excel_available() -> bool {
    let mut command = Command::new("powershell.exe");

    command.args([
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        r#"try { $excel = New-Object -ComObject Excel.Application; $excel.Quit(); exit 0 } catch { exit 1 }"#,
    ]);

    run_command_hidden_with_timeout(command, Duration::from_secs(10))
        .map(|output| output.status.success())
        .unwrap_or(false)
}

#[cfg(not(target_os = "windows"))]
fn is_excel_available() -> bool {
    false
}

fn find_libreoffice_path() -> Option<String> {
    for candidate in libreoffice_candidates() {
        let mut command = Command::new(&candidate);

        command.arg("--version");

        if let Ok(output) = run_command_hidden_with_timeout(command, Duration::from_secs(10)) {
            if output.status.success() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
    }

    None
}

#[tauri::command]
fn check_pdf_export_engines() -> PdfEngineStatus {
    let excel_available = is_excel_available();
    let libreoffice_path = find_libreoffice_path();
    let libreoffice_available = libreoffice_path.is_some();

    let (preferred_engine, ready, message) = if excel_available {
        (
            "Microsoft Excel",
            true,
            "Ready. Microsoft Excel will be used first, with LibreOffice as fallback if available.",
        )
    } else if libreoffice_available {
        (
            "LibreOffice",
            true,
            "Ready. LibreOffice will be used for official PDF export.",
        )
    } else {
        (
            "None",
            false,
            "Official PDF export requires Microsoft Excel or LibreOffice. LibreOffice is free and can be installed from libreoffice.org.",
        )
    };

    PdfEngineStatus {
        excel_available,
        libreoffice_available,
        libreoffice_path,
        preferred_engine: preferred_engine.to_string(),
        ready,
        message: message.to_string(),
    }
}

fn try_libreoffice_export(
    xlsx_path: &Path,
    pdf_path: &Path,
    output_dir: &Path,
) -> Result<(), String> {
    let mut last_error = String::new();

    for candidate in libreoffice_candidates() {
        let mut command = Command::new(&candidate);

        command
            .arg("--headless")
            .arg("--convert-to")
            .arg("pdf")
            .arg("--outdir")
            .arg(output_dir)
            .arg(xlsx_path);

        match run_command_hidden_with_timeout(command, Duration::from_secs(90)) {
            Ok(output) if output.status.success() && pdf_path.exists() => return Ok(()),
            Ok(output) => {
                last_error = output_message(&output);
            }
            Err(error) => {
                last_error = error.to_string();
            }
        }
    }

    Err(if last_error.is_empty() {
        "LibreOffice was not found or did not create a requisition PDF.".to_string()
    } else {
        format!("LibreOffice export failed: {}", last_error)
    })
}

fn convert_xlsx_to_pdf(
    xlsx_path: &Path,
    pdf_path: &Path,
    output_dir: &Path,
    tax_exempt: &str,
    material_cert: &str,
    fob: &str,
) -> Result<(), String> {
    let excel_error = match try_excel_com_export(
        xlsx_path,
        pdf_path,
        output_dir,
        tax_exempt,
        material_cert,
        fob,
    ) {
        Ok(()) => return Ok(()),
        Err(error) => error,
    };

    eprintln!("Excel COM requisition PDF export failed: {}", excel_error);

    let libre_error = match try_libreoffice_export(xlsx_path, pdf_path, output_dir) {
        Ok(()) => return Ok(()),
        Err(error) => error,
    };

    eprintln!("LibreOffice requisition PDF export failed: {}", libre_error);

    Err(format!(
        "Official PDF export failed. Excel error: {} | LibreOffice error: {}",
        excel_error, libre_error
    ))
}

#[tauri::command]
async fn export_requisition_xlsx_to_pdf(
    workbook_base64: String,
    file_name_base: String,
    tax_exempt: Option<String>,
    material_cert: Option<String>,
    fob: Option<String>,
) -> Result<RequisitionPdfExportResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        export_requisition_xlsx_to_pdf_blocking(
            workbook_base64,
            file_name_base,
            tax_exempt,
            material_cert,
            fob,
        )
    })
    .await
    .map_err(|error| format!("Official PDF export task failed: {}", error))?
}

fn export_requisition_xlsx_to_pdf_blocking(
    workbook_base64: String,
    file_name_base: String,
    tax_exempt: Option<String>,
    material_cert: Option<String>,
    fob: Option<String>,
) -> Result<RequisitionPdfExportResult, String> {
    let workbook_bytes = general_purpose::STANDARD
        .decode(workbook_base64.as_bytes())
        .map_err(|_| "Could not read generated requisition workbook.".to_string())?;

    if workbook_bytes.is_empty() {
        return Err("Generated requisition workbook was empty.".to_string());
    }

    let temp_dir = tempfile::tempdir()
        .map_err(|_| "Could not create a temporary export folder.".to_string())?;
    let file_name_base = safe_file_name_base(&file_name_base);
    let xlsx_path = temp_dir.path().join(format!("{}.xlsx", file_name_base));
    let pdf_file_name = format!("{}.pdf", file_name_base);
    let pdf_path = temp_dir.path().join(&pdf_file_name);

    fs::write(&xlsx_path, workbook_bytes)
        .map_err(|_| "Could not prepare generated requisition workbook.".to_string())?;

    if !xlsx_path.exists() {
        return Err("Temporary requisition workbook was not created.".to_string());
    }

    let workbook_metadata = fs::metadata(&xlsx_path)
        .map_err(|_| "Temporary requisition workbook was not created.".to_string())?;

    eprintln!(
        "Official requisition export: wrote workbook {} ({} bytes)",
        path_to_string(&xlsx_path)?,
        workbook_metadata.len()
    );

    convert_xlsx_to_pdf(
        &xlsx_path,
        &pdf_path,
        temp_dir.path(),
        tax_exempt.as_deref().unwrap_or(""),
        material_cert.as_deref().unwrap_or(""),
        fob.as_deref().unwrap_or(""),
    )?;

    let pdf_metadata = fs::metadata(&pdf_path)
        .map_err(|_| "Generated PDF file was not found after conversion.".to_string())?;

    if pdf_metadata.len() == 0 {
        return Err("Generated PDF file was empty.".to_string());
    }

    eprintln!(
        "Official requisition export: created PDF {} ({} bytes)",
        path_to_string(&pdf_path)?,
        pdf_metadata.len()
    );

    let pdf_bytes =
        fs::read(&pdf_path).map_err(|_| "Could not read generated requisition PDF.".to_string())?;

    Ok(RequisitionPdfExportResult {
        pdf_base64: general_purpose::STANDARD.encode(pdf_bytes),
        file_name: pdf_file_name,
    })
}

#[tauri::command]
fn fetch_website_preview(url: String) -> Result<WebsitePreview, String> {
    let normalized_url = normalize_website_url(&url);

    if normalized_url == "https://" || normalized_url == "http://" {
        return Err("Website URL is empty.".to_string());
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(6))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) MaintenanceInventoryTracker/0.1")
        .build()
        .map_err(|_| "Could not prepare website preview request.".to_string())?;

    let response = client
        .get(&normalized_url)
        .send()
        .map_err(|error| format!("Could not read vendor website: {}", error))?;
    let final_url = response.url().to_string();

    if !response.status().is_success() {
        return Err(format!(
            "Vendor website returned status {}.",
            response.status()
        ));
    }

    let html = response
        .text()
        .map_err(|_| "Could not read vendor website content.".to_string())?;
    let title = first_capture(&html, &[r"(?is)<title[^>]*>(.*?)</title>"]);
    let description = first_capture(
        &html,
        &[
            r#"(?is)<meta\s+[^>]*(?:name|property)\s*=\s*["'](?:description|og:description)["'][^>]*content\s*=\s*["']([^"']*)["'][^>]*>"#,
            r#"(?is)<meta\s+[^>]*content\s*=\s*["']([^"']*)["'][^>]*(?:name|property)\s*=\s*["'](?:description|og:description)["'][^>]*>"#,
        ],
    );

    Ok(WebsitePreview {
        final_url,
        title,
        description,
    })
}

#[tauri::command]
fn read_backup_file(
    directory_path: String,
    file_name: String,
) -> Result<BackupFileReadResult, String> {
    let path = backup_file_path(&directory_path, &file_name)?;

    if !path.exists() {
        return Err("No backup file found.".to_string());
    }

    let contents = fs::read_to_string(&path).map_err(|error| error.to_string())?;

    Ok(BackupFileReadResult {
        contents,
        last_modified_ms: last_modified_ms(&path),
    })
}

#[tauri::command]
fn write_backup_file(
    directory_path: String,
    file_name: String,
    contents: String,
) -> Result<BackupFileWriteResult, String> {
    let path = backup_file_path(&directory_path, &file_name)?;

    fs::write(&path, contents).map_err(|error| error.to_string())?;

    Ok(BackupFileWriteResult {
        last_modified_ms: last_modified_ms(&path),
    })
}

#[tauri::command]
fn check_csv_folder_exists(directory_path: String) -> bool {
    let directory = PathBuf::from(directory_path);

    directory.exists() && directory.is_dir()
}

#[tauri::command]
fn read_csv_file(
    directory_path: String,
    relative_path: Vec<String>,
) -> Result<CsvFileReadResult, String> {
    let path = csv_file_path(&directory_path, relative_path)?;

    if !path.exists() {
        return Ok(CsvFileReadResult {
            contents: String::new(),
            exists: false,
            last_modified_ms: None,
        });
    }

    if !path.is_file() {
        return Err("CSV path is not a file.".to_string());
    }

    let contents = fs::read_to_string(&path).map_err(|error| error.to_string())?;

    Ok(CsvFileReadResult {
        contents,
        exists: true,
        last_modified_ms: last_modified_ms(&path),
    })
}

#[tauri::command]
fn write_csv_file(
    directory_path: String,
    relative_path: Vec<String>,
    contents: String,
) -> Result<CsvFileWriteResult, String> {
    let path = csv_file_path(&directory_path, relative_path)?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    fs::write(&path, contents).map_err(|error| error.to_string())?;

    Ok(CsvFileWriteResult {
        last_modified_ms: last_modified_ms(&path),
    })
}

#[cfg(target_os = "windows")]
fn choose_windows_directory(description: &str, failure_message: &str) -> Result<Option<String>, String> {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let escaped_description = description.replace('\'', "''");
    let script = format!(
        r#"
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '{}'
$dialog.ShowNewFolderButton = $true
$result = $dialog.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {{
  [Console]::Out.Write($dialog.SelectedPath)
}}
"#,
        escaped_description
    );
    let output = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-STA",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &script,
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|error| error.to_string())?;

    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if message.is_empty() {
            failure_message.to_string()
        } else {
            message
        });
    }

    let directory_path = String::from_utf8_lossy(&output.stdout).trim().to_string();

    if directory_path.is_empty() {
        Ok(None)
    } else {
        Ok(Some(directory_path))
    }
}

#[tauri::command]
fn choose_backup_directory() -> Result<Option<String>, String> {
    #[cfg(target_os = "windows")]
    {
        choose_windows_directory("Choose backup folder", "Could not choose backup folder.")
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(None)
    }
}

#[tauri::command]
fn choose_csv_directory() -> Result<Option<String>, String> {
    #[cfg(target_os = "windows")]
    {
        choose_windows_directory("Choose CSV export/import folder", "Could not choose CSV folder.")
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(None)
    }
}

#[tauri::command]
fn choose_manual_installer_folder() -> Result<Option<String>, String> {
    #[cfg(target_os = "windows")]
    {
        choose_windows_directory(
            "Choose Maintenance Inventory Tracker update folder",
            "Could not choose update folder.",
        )
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(None)
    }
}

#[tauri::command]
fn list_manual_installer_files(directory_path: String) -> Result<InstallerFileList, String> {
    let directory = PathBuf::from(directory_path);

    if !directory.exists() {
        return Ok(InstallerFileList {
            folder_exists: false,
            file_names: Vec::new(),
        });
    }

    if !directory.is_dir() {
        return Err("Installer folder path is not a folder.".to_string());
    }

    let mut file_names = Vec::new();

    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let metadata = entry.metadata().map_err(|error| error.to_string())?;

        if !metadata.is_file() {
            continue;
        }

        if let Some(file_name) = entry.file_name().to_str() {
            file_names.push(file_name.to_string());
        }
    }

    file_names.sort();

    Ok(InstallerFileList {
        folder_exists: true,
        file_names,
    })
}

fn validate_manual_installer_file_name(file_name: &str) -> Result<(), String> {
    if file_name.contains('/') || file_name.contains('\\') || file_name.contains("..") {
        return Err("Installer file name is invalid.".to_string());
    }

    let installer_pattern =
        Regex::new(r"(?i)^Maintenance Inventory Tracker 3\.0_\d+(?:\.\d+){1,3}(?:-[0-9A-Za-z.-]+)?_x64-setup\.exe$")
            .map_err(|error| error.to_string())?;

    if !installer_pattern.is_match(file_name) {
        return Err("Installer file name is invalid.".to_string());
    }

    Ok(())
}

#[tauri::command]
fn open_manual_installer_folder(directory_path: String) -> Result<(), String> {
    let directory = PathBuf::from(directory_path);

    if !directory.exists() {
        return Err("Installer folder not found. Run release build first or choose an update folder.".to_string());
    }

    if !directory.is_dir() {
        return Err("Installer folder path is not a folder.".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x08000000;
        Command::new("explorer.exe")
            .arg(directory)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|error| error.to_string())?;

        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(directory)
            .spawn()
            .map_err(|error| error.to_string())?;

        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(directory)
            .spawn()
            .map_err(|error| error.to_string())?;

        return Ok(());
    }
}

#[tauri::command]
fn open_manual_installer_file(
    app: tauri::AppHandle,
    directory_path: String,
    file_name: String,
) -> Result<(), String> {
    validate_manual_installer_file_name(&file_name)?;

    let directory = PathBuf::from(directory_path);

    if !directory.exists() {
        return Err(
            "Installer folder not found. Run release build first or choose an update folder."
                .to_string(),
        );
    }

    if !directory.is_dir() {
        return Err("Installer folder path is not a folder.".to_string());
    }

    let installer_path = directory.join(&file_name);

    if !installer_path.exists() {
        return Err(
            "Installer file not found. Check the update folder or run release build first."
                .to_string(),
        );
    }

    if !installer_path.is_file() {
        return Err("Installer path is not a file.".to_string());
    }

    app.opener()
        .open_path(installer_path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(SQLITE_CONNECTION, sqlite_migrations())
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            check_csv_folder_exists,
            check_pdf_export_engines,
            choose_backup_directory,
            choose_csv_directory,
            choose_manual_installer_folder,
            export_requisition_xlsx_to_pdf,
            fetch_website_preview,
            get_app_version,
            list_manual_installer_files,
            open_manual_installer_file,
            open_manual_installer_folder,
            read_csv_file,
            read_backup_file,
            write_csv_file,
            write_backup_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running Maintenance Inventory Tracker");
}
