import { getApiBaseUrl } from "./runtimeMode";

export type WebsiteUpdateStatus =
  | {
      behindCount: number | null;
      branch: string;
      checkedAt: string;
      localSha: string;
      ok: true;
      remoteSha: string;
      updateAvailable: boolean;
    }
  | {
      checkedAt?: string;
      error: string;
      ok: false;
    };

export type WebsiteUpdateRunStatus = {
  afterSha: string | null;
  beforeSha: string | null;
  completedAt: string | null;
  error: string | null;
  logFile: string | null;
  message: string;
  ok: boolean | null;
  phase: string;
  repoRoot?: string;
  scriptPath?: string;
  pid?: number | null;
  running: boolean;
  startedAt: string | null;
  updatedAt: string | null;
};

export type WebsiteUpdateRunResult =
  | {
      message: string;
      ok: true;
      repoRoot: string;
      scriptPath: string;
      pid: number | null;
      statusUrl: string;
    }
  | {
      details?: string;
      dirtyFiles?: string[];
      error: string;
      ok: false;
      repoRoot?: string;
      scriptPath?: string;
      pid?: number | null;
      statusUrl?: string;
    };

function apiUrl(path: string) {
  return `${getApiBaseUrl()}${path}`;
}

async function readJsonResponse<T>(response: Response) {
  return (await response.json().catch(() => ({}))) as T;
}

export async function getWebsiteUpdateStatus() {
  const response = await fetch(apiUrl("/api/update/status"), {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Update status check failed with HTTP ${response.status}.`);
  }

  return readJsonResponse<WebsiteUpdateStatus>(response);
}

export async function getWebsiteUpdateRunStatus() {
  const response = await fetch(apiUrl("/api/update/run/status"), {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(
      `Update progress check failed with HTTP ${response.status}.`,
    );
  }

  return readJsonResponse<WebsiteUpdateRunStatus>(response);
}

export async function getWebsiteUpdateRunLog() {
  const response = await fetch(apiUrl("/api/update/run/log"), {
    cache: "no-store",
    headers: { Accept: "text/plain" },
  });

  const text = await response.text().catch(() => "");

  if (!response.ok) {
    throw new Error(
      text || `Update log check failed with HTTP ${response.status}.`,
    );
  }

  return text;
}

export async function runWebsiteUpdate() {
  const response = await fetch(apiUrl("/api/update/run"), {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  const payload = await readJsonResponse<WebsiteUpdateRunResult>(response);

  if (!response.ok && !("error" in payload)) {
    throw new Error(`Update start failed with HTTP ${response.status}.`);
  }

  return payload;
}
