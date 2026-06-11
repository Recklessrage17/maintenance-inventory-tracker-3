const API_DATA_SOURCE = import.meta.env.VITE_MIT3_DATA_SOURCE === "api";
const API_BASE_URL = (import.meta.env.VITE_MIT3_API_BASE_URL ?? "").replace(/\/$/, "");
const DEFAULT_WEBSITE_BACKEND_URL = "http://localhost:4173";

type TauriWindow = Window & {
  __TAURI__?: unknown;
};

export function hasTauriRuntime() {
  return typeof window !== "undefined" && Boolean((window as TauriWindow).__TAURI__);
}

export function isBackendServedWebsite() {
  return typeof window !== "undefined" && window.location.port === "4173";
}

export function isWebsiteBrowserMode() {
  return !hasTauriRuntime() && (API_DATA_SOURCE || isBackendServedWebsite());
}

export function getApiBaseUrl() {
  if (isWebsiteBrowserMode() && isBackendServedWebsite()) {
    return "";
  }

  return API_BASE_URL;
}

export function getWebsiteBackendUrl() {
  const apiBaseUrl = getApiBaseUrl();

  if (apiBaseUrl) {
    return apiBaseUrl;
  }

  return typeof window !== "undefined" ? window.location.origin : DEFAULT_WEBSITE_BACKEND_URL;
}
