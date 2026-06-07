import { getApiBaseUrl } from "./runtimeMode";

const WEBSITE_AUTH_SESSION_KEY = "mit3_website_session_unlocked";
const AUTH_SERVICE_ERROR = "Could not reach backend authentication service. Make sure the website backend is running.";

type WebsiteAuthStatus = {
  configured: boolean;
};

type WebsiteAuthResponse = {
  error?: string;
  ok?: boolean;
};

function apiUrl(path: string) {
  return `${getApiBaseUrl()}${path}`;
}

async function readJsonResponse<T>(response: Response) {
  return (await response.json().catch(() => ({}))) as T;
}

async function fetchAuth(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);

  headers.set("Accept", "application/json");

  if (init?.body) {
    headers.set("Content-Type", "application/json");
  }

  try {
    return await fetch(apiUrl(path), {
      ...init,
      headers
    });
  } catch {
    throw new Error(AUTH_SERVICE_ERROR);
  }
}

export async function getWebsiteAuthStatus() {
  const response = await fetchAuth("/api/auth/status");

  if (!response.ok) {
    throw new Error(AUTH_SERVICE_ERROR);
  }

  return readJsonResponse<WebsiteAuthStatus>(response);
}

export async function setupWebsiteAuth(password: string, recoveryEmail = "") {
  const response = await fetchAuth("/api/auth/setup", {
    method: "POST",
    body: JSON.stringify({ password, recoveryEmail })
  });
  const payload = await readJsonResponse<WebsiteAuthResponse>(response);

  if (!response.ok) {
    throw new Error(payload.error || AUTH_SERVICE_ERROR);
  }

  setWebsiteAuthSessionUnlocked();
}

export async function loginWebsiteAuth(password: string) {
  const response = await fetchAuth("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ password })
  });
  const payload = await readJsonResponse<WebsiteAuthResponse>(response);

  if (response.status === 401) {
    return false;
  }

  if (!response.ok) {
    throw new Error(payload.error || AUTH_SERVICE_ERROR);
  }

  setWebsiteAuthSessionUnlocked();
  return true;
}

export async function logoutWebsiteAuth() {
  sessionStorage.removeItem(WEBSITE_AUTH_SESSION_KEY);
  await fetchAuth("/api/auth/logout", { method: "POST" }).catch(() => undefined);
}

export function isWebsiteAuthSessionUnlocked() {
  return sessionStorage.getItem(WEBSITE_AUTH_SESSION_KEY) === "true";
}

export function setWebsiteAuthSessionUnlocked() {
  sessionStorage.setItem(WEBSITE_AUTH_SESSION_KEY, "true");
}
