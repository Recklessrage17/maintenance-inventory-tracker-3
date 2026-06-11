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

export type WebsiteUpdateRunResult =
  | {
      message: string;
      ok: true;
    }
  | {
      dirtyFiles?: string[];
      error: string;
      ok: false;
    };

function apiUrl(path: string) {
  return `${getApiBaseUrl()}${path}`;
}

async function readJsonResponse<T>(response: Response) {
  return (await response.json().catch(() => ({}))) as T;
}

export async function getWebsiteUpdateStatus() {
  const response = await fetch(apiUrl("/api/update/status"), {
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`Update status check failed with HTTP ${response.status}.`);
  }

  return readJsonResponse<WebsiteUpdateStatus>(response);
}

export async function runWebsiteUpdate() {
  const response = await fetch(apiUrl("/api/update/run"), {
    method: "POST",
    headers: { Accept: "application/json" }
  });
  const payload = await readJsonResponse<WebsiteUpdateRunResult>(response);

  if (!response.ok && !("error" in payload)) {
    throw new Error(`Update start failed with HTTP ${response.status}.`);
  }

  return payload;
}
