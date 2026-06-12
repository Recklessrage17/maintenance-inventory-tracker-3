import cors from "cors";
import express, { type RequestHandler } from "express";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  getBackupDownloadPath,
  getBackupRoot,
  getBackupStatus,
  runWebsiteBackup,
} from "./backups.js";
import {
  getWebsiteAuthStatus,
  setupWebsiteAuth,
  verifyWebsiteAuthPassword,
  WebsiteAuthError,
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
  type AppData,
} from "./db.js";

const app = express();
const port = Number(process.env.PORT ?? process.env.MIT3_PORT ?? 4173);
const defaultAllowedOrigins = [
  `http://localhost:${port}`,
  "http://localhost:5173",
];
const allowedOrigins = (
  process.env.MIT3_ALLOWED_ORIGINS ?? defaultAllowedOrigins.join(",")
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const frontendDist = path.resolve(__dirname, "../../frontend/dist");
const updateScriptPath = path.join(
  repoRoot,
  "scripts",
  "update-mit3-website.ps1",
);
const updateStatusPath = path.join(repoRoot, "backend", "update-status.json");
const updateLogsDir = path.join(repoRoot, "backend", "update-logs");
const execFileAsync = promisify(execFile);
let updateRunInProgress = false;

type UpdateRunStatus = {
  afterSha: string | null;
  beforeSha: string | null;
  completedAt: string | null;
  error: string | null;
  logFile: string | null;
  message: string;
  ok: boolean | null;
  phase: string;
  repoRoot: string;
  running: boolean;
  startedAt: string | null;
  updatedAt: string | null;
};

type GitUpdateStatus = {
  behindCount: number | null;
  branch: string;
  checkedAt: string;
  localSha: string;
  ok: true;
  remoteSha: string;
  updateAvailable: boolean;
};

function requestOrigin(request: express.Request) {
  const host = request.get("host");

  return host ? `${request.protocol}://${host}` : "";
}

const apiCors: RequestHandler = (request, response, next) => {
  cors({
    origin(origin, callback) {
      if (
        !origin ||
        allowedOrigins.includes(origin) ||
        origin === requestOrigin(request)
      ) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} is not allowed by MIT3 backend.`));
    },
  })(request, response, next);
};

function stringBodyValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function handleAuthError(
  error: unknown,
  response: express.Response,
  fallbackMessage: string,
) {
  if (error instanceof WebsiteAuthError) {
    response.status(error.statusCode).json({ ok: false, error: error.message });
    return;
  }

  console.error(fallbackMessage, error);
  response.status(500).json({ ok: false, error: fallbackMessage });
}

async function runGit(args: string[]) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: repoRoot,
    maxBuffer: 1024 * 1024,
    timeout: 30_000,
    windowsHide: true,
  });

  return stdout.trim();
}

function updateErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return fallback;
}

function backupErrorMessage(error: unknown) {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : "Backend backup failed.";
}

async function getGitUpdateStatus(): Promise<GitUpdateStatus> {
  const branch = await runGit(["rev-parse", "--abbrev-ref", "HEAD"]);

  if (!branch || branch === "HEAD") {
    throw new Error(
      "Cannot check updates while the repository is detached from a branch.",
    );
  }

  const localSha = await runGit(["rev-parse", "HEAD"]);

  await runGit(["fetch", "--quiet"]);

  const remoteRef = `origin/${branch}`;
  const remoteSha = await runGit(["rev-parse", remoteRef]);
  const behindCountText = await runGit([
    "rev-list",
    "--count",
    `HEAD..${remoteRef}`,
  ]).catch(() => "");
  const behindCount = behindCountText
    ? Number.parseInt(behindCountText, 10)
    : null;

  return {
    ok: true,
    branch,
    localSha,
    remoteSha,
    updateAvailable: localSha !== remoteSha,
    behindCount: Number.isFinite(behindCount) ? behindCount : null,
    checkedAt: new Date().toISOString(),
  };
}

function isIgnoredRuntimeStatusLine(line: string) {
  const normalizedPath = line.slice(3).replace(/\\/g, "/");

  return (
    /^backend\/data\/.+\.(db|db-shm|db-wal|sqlite|sqlite-shm|sqlite-wal)$/i.test(
      normalizedPath,
    ) ||
    normalizedPath === "backend/update-status.json" ||
    normalizedPath.startsWith("backend/update-logs/")
  );
}

async function getUpdateRunStatus(): Promise<UpdateRunStatus> {
  try {
    const raw = await fs.promises.readFile(updateStatusPath, "utf8");
    return JSON.parse(raw) as UpdateRunStatus;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }

    return {
      running: false,
      phase: "idle",
      message: "No update has run yet",
      repoRoot,
      startedAt: null,
      updatedAt: null,
      completedAt: null,
      ok: null,
      error: null,
      beforeSha: null,
      afterSha: null,
      logFile: null,
    };
  }
}

async function getLatestUpdateLogPath() {
  const status = await getUpdateRunStatus().catch(() => null);

  if (
    status?.logFile &&
    path.resolve(status.logFile).startsWith(updateLogsDir)
  ) {
    return status.logFile;
  }

  const entries = await fs.promises
    .readdir(updateLogsDir, { withFileTypes: true })
    .catch(() => []);
  const logFiles = entries
    .filter(
      (entry) =>
        entry.isFile() && /^update-\d{8}-\d{6}\.log$/i.test(entry.name),
    )
    .map((entry) => path.join(updateLogsDir, entry.name))
    .sort();

  return logFiles.at(-1) ?? null;
}

function lastLogLines(text: string, maxLines = 200) {
  const lines = text.split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - maxLines)).join("\n");
}

async function getDirtyStatusLines() {
  const status = await runGit(["status", "--porcelain"]);

  return status
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .filter((line) => !isIgnoredRuntimeStatusLine(line));
}

app.use(express.json({ limit: "50mb" }));

// Lightweight request logging middleware: method, URL, status, response time
app.use((request, response, next) => {
  const startedAt = Date.now();
  response.on("finish", () => {
    try {
      console.log(
        `${request.method} ${request.originalUrl} ${response.statusCode} ${Date.now() - startedAt}ms`,
      );
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
      ...setupWebsiteAuth(
        stringBodyValue(request.body?.password),
        stringBodyValue(request.body?.recoveryEmail),
      ),
    });
  } catch (error) {
    handleAuthError(
      error,
      response,
      "Could not configure website authentication.",
    );
  }
});

app.post("/api/auth/login", (request, response) => {
  try {
    if (!verifyWebsiteAuthPassword(stringBodyValue(request.body?.password))) {
      response
        .status(401)
        .json({
          ok: false,
          error: "Password did not match this inventory system.",
        });
      return;
    }

    response.json({ ok: true });
  } catch (error) {
    handleAuthError(
      error,
      response,
      "Could not verify website authentication.",
    );
  }
});

app.post("/api/auth/logout", (_request, response) => {
  response.json({ ok: true });
});

app.get("/api/update/status", async (_request, response) => {
  try {
    response.json(await getGitUpdateStatus());
  } catch (error) {
    response.status(200).json({
      ok: false,
      error: updateErrorMessage(error, "Could not check GitHub update status."),
      checkedAt: new Date().toISOString(),
    });
  }
});

app.post("/api/update/run", async (_request, response) => {
  if (updateRunInProgress) {
    response
      .status(409)
      .json({ ok: false, error: "An MIT3 website update is already running." });
    return;
  }

  try {
    const dirtyLines = await getDirtyStatusLines();

    if (dirtyLines.length > 0) {
      response.status(409).json({
        ok: false,
        error: "Local changes found",
        details: dirtyLines.join("\n"),
        dirtyFiles: dirtyLines,
      });
      return;
    }

    updateRunInProgress = true;

    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        updateScriptPath,
        "-RepoRoot",
        repoRoot,
        "-NoFolderPicker",
        "-Restart",
      ],
      {
        cwd: repoRoot,
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      },
    );

    child.on("error", (error) => {
      updateRunInProgress = false;
      console.error("Could not start MIT3 website update:", error);
    });
    child.unref();

    response.json({
      ok: true,
      message: "Update started",
      repoRoot,
      statusUrl: "/api/update/run/status",
    });
  } catch (error) {
    updateRunInProgress = false;
    response.status(500).json({
      ok: false,
      error: updateErrorMessage(error, "Could not start MIT3 website update."),
    });
  }
});

app.get("/api/update/run/status", async (_request, response) => {
  try {
    const status = await getUpdateRunStatus();
    updateRunInProgress = status.running;
    response.json(status);
  } catch (error) {
    response.status(500).json({
      running: false,
      phase: "failed",
      message: "Could not read update status.",
      ok: false,
      error: updateErrorMessage(error, "Could not read update status."),
    });
  }
});

app.get("/api/update/run/log", async (_request, response) => {
  try {
    const logPath = await getLatestUpdateLogPath();

    if (!logPath) {
      response.type("text/plain").send("No update log has been written yet.");
      return;
    }

    const text = await fs.promises.readFile(logPath, "utf8");
    response.type("text/plain").send(lastLogLines(text));
  } catch (error) {
    response
      .status(500)
      .type("text/plain")
      .send(updateErrorMessage(error, "Could not read update log."));
  }
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
    checkedAt: new Date().toISOString(),
  });
});

app.get("/api/app-data", (_request, response) => {
  const loadResult = loadAppDataWithSource();

  response.json({
    data: loadResult.data,
    normalizedLoadError: loadResult.normalizedLoadError,
    normalizedLoadReady: loadResult.normalizedLoadReady,
    source: loadResult.source,
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

    try {
      const backup = runWebsiteBackup(data as AppData);

      response.json({ ok: true, ...result, backup });
    } catch (backupError) {
      const error = backupErrorMessage(backupError);

      console.error("Error writing website backup:", backupError);
      response.status(500).json({
        ok: false,
        error: "App data saved to SQLite, but backend backup failed.",
        backup: getBackupStatus([error]),
        sqlite: result,
      });
    }
  } catch (err) {
    console.error("Error saving normalized tables:", err);
    // Attempt at least to save snapshot as fallback
    try {
      const fallback = saveAppDataSnapshot(data as AppData);
      response
        .status(500)
        .json({
          ok: false,
          error: "Normalized save failed; snapshot saved.",
          fallback,
        });
    } catch (err2) {
      console.error("Error saving snapshot as fallback:", err2);
      response
        .status(500)
        .json({ ok: false, error: "Failed to save app data." });
    }
  }
});

app.get("/api/backup/status", (_request, response) => {
  response.json(getBackupStatus());
});

app.post("/api/backup/run", (_request, response) => {
  const loadResult = loadAppDataWithSource();

  if (!loadResult.data) {
    response
      .status(404)
      .json({ ok: false, error: "No app data is available to back up." });
    return;
  }

  try {
    const backup = runWebsiteBackup(loadResult.data);

    response.json({ ok: backup.status !== "failed", backup });
  } catch (error) {
    const message = backupErrorMessage(error);

    console.error("Error running website backup:", error);
    response
      .status(500)
      .json({ ok: false, error: message, backup: getBackupStatus([message]) });
  }
});

function sendBackupDownload(
  response: express.Response,
  kind: "history" | "inventory" | "json",
  fileName: string,
  contentType: string,
) {
  const filePath = getBackupDownloadPath(kind);

  if (!fs.existsSync(filePath)) {
    response
      .status(404)
      .json({
        ok: false,
        error: `${fileName} has not been created yet. Run Backup Now first.`,
      });
    return;
  }

  response.download(filePath, fileName, {
    headers: { "Content-Type": contentType },
  });
}

app.get("/api/backup/download/json", (_request, response) => {
  sendBackupDownload(
    response,
    "json",
    "maintenance-inventory-latest.json",
    "application/json; charset=utf-8",
  );
});

app.get("/api/backup/download/csv/inventory", (_request, response) => {
  sendBackupDownload(
    response,
    "inventory",
    "inventory.csv",
    "text/csv; charset=utf-8",
  );
});

app.get("/api/backup/download/csv/history", (_request, response) => {
  sendBackupDownload(
    response,
    "history",
    "history.csv",
    "text/csv; charset=utf-8",
  );
});

app.get("/api/normalized-summary", (_request, response) => {
  try {
    const counts = getHealthCounts();
    const loadResult = loadAppDataWithSource();
    const freshness = getDataFreshnessSummary();
    const db = getDatabase();
    const latestItem = db
      .prepare("SELECT MAX(updated_at) AS latest FROM inventory_items")
      .get() as { latest: string };
    const latestStock = db
      .prepare("SELECT MAX(date_time) AS latest FROM stock_ledger")
      .get() as { latest: string };
    const latestReq = db
      .prepare("SELECT MAX(created_at) AS latest FROM requisitions")
      .get() as { latest: string };
    const latestAudit = db
      .prepare("SELECT MAX(occurred_at) AS latest FROM audit_log")
      .get() as { latest: string };

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
      latestSnapshotUpdatedAt: freshness.latestSnapshotUpdatedAt,
    });
  } catch (err) {
    console.error("Error fetching normalized summary:", err);
    response
      .status(500)
      .json({ ok: false, error: "Failed to build normalized summary." });
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
        source: loadResult.source,
      },
    });
  } catch (err) {
    console.error("Error comparing app data sources:", err);
    response
      .status(500)
      .json({ ok: false, error: "Failed to compare app data sources." });
  }
});

app.use(express.static(frontendDist));
app.get("*", (_request, response) => {
  response.sendFile(path.join(frontendDist, "index.html"));
});

app.listen(port, () => {
  console.log(
    `Maintenance Inventory Tracker 3 website backend running on http://localhost:${port}`,
  );
  console.log(`Allowed API origins: ${allowedOrigins.join(", ")}`);
  console.log(`Frontend dist: ${frontendDist}`);
  console.log(`SQLite database: ${getDatabasePath()}`);
  console.log(`Backup folder: ${getBackupRoot()}`);
});
