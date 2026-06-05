import type { AppData } from "../types";

const DB_NAME = "maintenance-inventory-tracker";
const DB_VERSION = 1;
const STORE_NAME = "appData";
const APP_KEY = "app";
const API_DATA_SOURCE = import.meta.env.VITE_MIT3_DATA_SOURCE === "api";
const API_BASE_URL = (import.meta.env.VITE_MIT3_API_BASE_URL ?? "").replace(/\/$/, "");

type AppDataRow = {
  key: string;
  value: AppData;
};

type ApiLoadResponse = {
  data: AppData | null;
};

function apiUrl(path: string) {
  return `${API_BASE_URL}${path}`;
}

async function loadAppDataFromApi() {
  const response = await fetch(apiUrl("/api/app-data"), {
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`App data API load failed with HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as ApiLoadResponse;
  return payload.data ?? undefined;
}

async function saveAppDataToApi(value: AppData) {
  const response = await fetch(apiUrl("/api/app-data"), {
    method: "PUT",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(value)
  });

  if (!response.ok) {
    throw new Error(`App data API save failed with HTTP ${response.status}.`);
  }
}

const openDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

async function loadAppDataFromIndexedDb() {
  const db = await openDatabase();

  return new Promise<AppData | undefined>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(APP_KEY);

    request.onsuccess = () => resolve((request.result as AppDataRow | undefined)?.value);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

async function saveAppDataToIndexedDb(value: AppData) {
  const db = await openDatabase();

  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);

    store.put({ key: APP_KEY, value });
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

export const loadAppData = async () => {
  if (API_DATA_SOURCE) {
    return loadAppDataFromApi();
  }

  return loadAppDataFromIndexedDb();
};

export const saveAppData = async (value: AppData) => {
  if (API_DATA_SOURCE) {
    await saveAppDataToApi(value);
    return;
  }

  await saveAppDataToIndexedDb(value);
};
