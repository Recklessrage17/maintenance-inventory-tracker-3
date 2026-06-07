import cors from "cors";
import express, { type RequestHandler } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getWebsiteAuthStatus,
  setupWebsiteAuth,
  verifyWebsiteAuthPassword,
  WebsiteAuthError
} from "./auth.js";
import {
  getAppDataCountComparison,
  getDataFreshnessSummary,
  getDatabase,
  getDatabasePath,
  getHealthCounts,
  loadAppDataWithSource,
  saveAppDataSnapshot,
  saveNormalizedTablesFromAppData,
  type AppData
} from "./db.js";

const app = express();
const port = Number(process.env.PORT ?? process.env.MIT3_PORT ?? 4173);
const defaultAllowedOrigins = [`http://localhost:${port}`, "http://localhost:5173"];
const allowedOrigins = (process.env.MIT3_ALLOWED_ORIGINS ?? defaultAllowedOrigins.join(","))
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDist = path.resolve(__dirname, "../../frontend/dist");

function requestOrigin(request: express.Request) {
  const host = request.get("host");

  return host ? `${request.protocol}://${host}` : "";
}

const apiCors: RequestHandler = (request, response, next) => {
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin) || origin === requestOrigin(request)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} is not allowed by MIT3 backend.`));
    }
  })(request, response, next);
};

function stringBodyValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function handleAuthError(error: unknown, response: express.Response, fallbackMessage: string) {
  if (error instanceof WebsiteAuthError) {
    response.status(error.statusCode).json({ ok: false, error: error.message });
    return;
  }

  console.error(fallbackMessage, error);
  response.status(500).json({ ok: false, error: fallbackMessage });
}

app.use(express.json({ limit: "50mb" }));

// Lightweight request logging middleware: method, URL, status, response time
app.use((request, response, next) => {
  const startedAt = Date.now();
  response.on("finish", () => {
    try {
      console.log(`${request.method} ${request.originalUrl} ${response.statusCode} ${Date.now() - startedAt}ms`);
    } catch (err) {
      // ignore logging errors
    }
  });
  next();
});

app.use("/api", apiCors);

app.get("/api/auth/status", (_request, response) => {
  response.json(getWebsiteAuthStatus());
});

app.post("/api/auth/setup", (request, response) => {
  try {
    response.json({
      ok: true,
      ...setupWebsiteAuth(stringBodyValue(request.body?.password), stringBodyValue(request.body?.recoveryEmail))
    });
  } catch (error) {
    handleAuthError(error, response, "Could not configure website authentication.");
  }
});

app.post("/api/auth/login", (request, response) => {
  try {
    if (!verifyWebsiteAuthPassword(stringBodyValue(request.body?.password))) {
      response.status(401).json({ ok: false, error: "Password did not match this inventory system." });
      return;
    }

    response.json({ ok: true });
  } catch (error) {
    handleAuthError(error, response, "Could not verify website authentication.");
  }
});

app.post("/api/auth/logout", (_request, response) => {
  response.json({ ok: true });
});

app.get("/api/health", (_request, response) => {
  getDatabase();
  const loadResult = loadAppDataWithSource();

  response.json({
    ok: true,
    mode: "website-sqlite",
    databasePath: getDatabasePath(),
    counts: getHealthCounts(),
    appDataLoadSource: loadResult.source,
    normalizedLoadReady: loadResult.normalizedLoadReady,
    normalizedLoadError: loadResult.normalizedLoadError,
    ...getDataFreshnessSummary(),
    checkedAt: new Date().toISOString()
  });
});

app.get("/api/app-data", (_request, response) => {
  const loadResult = loadAppDataWithSource();

  response.json({
    data: loadResult.data,
    normalizedLoadError: loadResult.normalizedLoadError,
    normalizedLoadReady: loadResult.normalizedLoadReady,
    source: loadResult.source
  });
});

app.put("/api/app-data", (request, response) => {
  const data = request.body as Partial<AppData>;

  if (data.app !== "maintenance-inventory-tracker") {
    response.status(400).json({ error: "Invalid app data payload." });
    return;
  }

  try {
    const result = saveNormalizedTablesFromAppData(data as AppData);
    response.json({ ok: true, ...result });
  } catch (err) {
    console.error("Error saving normalized tables:", err);
    // Attempt at least to save snapshot as fallback
    try {
      const fallback = saveAppDataSnapshot(data as AppData);
      response.status(500).json({ ok: false, error: "Normalized save failed; snapshot saved.", fallback });
    } catch (err2) {
      console.error("Error saving snapshot as fallback:", err2);
      response.status(500).json({ ok: false, error: "Failed to save app data." });
    }
  }
});

app.get("/api/normalized-summary", (_request, response) => {
  try {
    const counts = getHealthCounts();
    const loadResult = loadAppDataWithSource();
    const freshness = getDataFreshnessSummary();
    const db = getDatabase();
    const latestItem = db.prepare("SELECT MAX(updated_at) AS latest FROM inventory_items").get() as { latest: string };
    const latestStock = db.prepare("SELECT MAX(date_time) AS latest FROM stock_ledger").get() as { latest: string };
    const latestReq = db.prepare("SELECT MAX(created_at) AS latest FROM requisitions").get() as { latest: string };
    const latestAudit = db.prepare("SELECT MAX(occurred_at) AS latest FROM audit_log").get() as { latest: string };

    response.json({
      ok: true,
      counts,
      appDataLoadSource: loadResult.source,
      normalizedLoadReady: loadResult.normalizedLoadReady,
      normalizedLoadError: loadResult.normalizedLoadError,
      latestItemUpdatedAt: latestItem.latest ?? freshness.latestItemUpdatedAt,
      latestStockDateTime: latestStock.latest,
      latestRequisitionCreatedAt: latestReq.latest,
      latestAuditOccurredAt: latestAudit.latest,
      latestSnapshotUpdatedAt: freshness.latestSnapshotUpdatedAt
    });
  } catch (err) {
    console.error("Error fetching normalized summary:", err);
    response.status(500).json({ ok: false, error: "Failed to build normalized summary." });
  }
});

app.get("/api/app-data/compare", (_request, response) => {
  try {
    const loadResult = loadAppDataWithSource();

    response.json({
      ok: true,
      ...getAppDataCountComparison(),
      load: {
        normalizedLoadError: loadResult.normalizedLoadError,
        normalizedLoadReady: loadResult.normalizedLoadReady,
        source: loadResult.source
      }
    });
  } catch (err) {
    console.error("Error comparing app data sources:", err);
    response.status(500).json({ ok: false, error: "Failed to compare app data sources." });
  }
});

app.use(express.static(frontendDist));
app.get("*", (_request, response) => {
  response.sendFile(path.join(frontendDist, "index.html"));
});

app.listen(port, () => {
  console.log(`Maintenance Inventory Tracker 3 website backend running on http://localhost:${port}`);
  console.log(`Allowed API origins: ${allowedOrigins.join(", ")}`);
  console.log(`Frontend dist: ${frontendDist}`);
  console.log(`SQLite database: ${getDatabasePath()}`);
});
