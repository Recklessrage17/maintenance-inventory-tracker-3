import { getApiBaseUrl } from "./runtimeMode";

export type WebsiteBackupFileStatus = {
  exists: boolean;
  path: string;
  sizeBytes: number | null;
  updatedAt: string | null;
};

export type WebsiteBackupStatus = {
  backupFolder: "backend/backups";
  checkedAt: string;
  csvFiles: Record<string, WebsiteBackupFileStatus>;
  errors: string[];
  jsonLatest: WebsiteBackupFileStatus;
  lastCsvExportAt: string | null;
  lastJsonBackupAt: string | null;
  message: string;
  ok: boolean;
  status: "failed" | "healthy" | "warning";
  timestampedJsonCount: number;
};

type WebsiteBackupRunResponse =
  | {
      backup: WebsiteBackupStatus;
      ok: true;
    }
  | {
      backup?: WebsiteBackupStatus;
      error: string;
      ok: false;
    };

type WebsiteBackupDownloadKind = "history-csv" | "inventory-csv" | "json";

function apiUrl(path: string) {
  return `${getApiBaseUrl()}${path}`;
}

async function readJsonResponse<T>(response: Response) {
  return (await response.json().catch(() => ({}))) as T;
}

export async function getWebsiteBackupStatus() {
  const response = await fetch(apiUrl("/api/backup/status"), {
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`Backup status check failed with HTTP ${response.status}.`);
  }

  return readJsonResponse<WebsiteBackupStatus>(response);
}

export async function runWebsiteBackup() {
  const response = await fetch(apiUrl("/api/backup/run"), {
    method: "POST",
    headers: { Accept: "application/json" }
  });
  const payload = await readJsonResponse<WebsiteBackupRunResponse>(response);

  if (!response.ok || !payload.ok) {
    throw new Error(("error" in payload && payload.error) || `Backup failed with HTTP ${response.status}.`);
  }

  return payload.backup;
}

function backupDownloadConfig(kind: WebsiteBackupDownloadKind) {
  switch (kind) {
    case "history-csv":
      return {
        fileName: "history.csv",
        path: "/api/backup/download/csv/history"
      };
    case "inventory-csv":
      return {
        fileName: "inventory.csv",
        path: "/api/backup/download/csv/inventory"
      };
    case "json":
      return {
        fileName: "maintenance-inventory-latest.json",
        path: "/api/backup/download/json"
      };
  }
}

export async function downloadWebsiteBackupFile(kind: WebsiteBackupDownloadKind) {
  const config = backupDownloadConfig(kind);
  const response = await fetch(apiUrl(config.path));

  if (!response.ok) {
    const payload = await readJsonResponse<{ error?: string }>(response);

    throw new Error(payload.error || `Download failed with HTTP ${response.status}.`);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = objectUrl;
  link.download = config.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}
