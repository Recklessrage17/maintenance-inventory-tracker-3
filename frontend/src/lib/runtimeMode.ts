const API_DATA_SOURCE = import.meta.env.VITE_MIT3_DATA_SOURCE === "api";
const API_BASE_URL = (import.meta.env.VITE_MIT3_API_BASE_URL ?? "").replace(/\/$/, "");
const DEFAULT_WEBSITE_BACKEND_URL = "http://localhost:4173";

type TauriWindow = Window & {
  __TAURI__?: unknown;
};

export function hasTauriRuntime() {
  return typeof window !== "undefined" && Boolean((window as TauriWindow).__TAURI__);
}

export function isWebsiteBrowserMode() {
  return API_DATA_SOURCE && !hasTauriRuntime();
}

export function getApiBaseUrl() {
  return API_BASE_URL;
}

export function getWebsiteBackendUrl() {
  return API_BASE_URL || DEFAULT_WEBSITE_BACKEND_URL;
}
