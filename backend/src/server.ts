import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getDatabase,
  getDatabasePath,
  getHealthCounts,
  loadAppDataFromSqlite,
  saveAppDataSnapshot,
  type AppData
} from "./db.js";

const app = express();
const port = Number(process.env.PORT ?? process.env.MIT3_PORT ?? 4173);
const allowedOrigin = process.env.MIT3_ALLOWED_ORIGIN ?? "http://localhost:5173";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDist = path.resolve(__dirname, "../../frontend/dist");

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || origin === allowedOrigin) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} is not allowed by MIT3 backend.`));
    }
  })
);
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

app.get("/api/health", (_request, response) => {
  getDatabase();

  response.json({
    ok: true,
    mode: "website-sqlite",
    databasePath: getDatabasePath(),
    counts: getHealthCounts(),
    checkedAt: new Date().toISOString()
  });
});

app.get("/api/app-data", (_request, response) => {
  response.json({ data: loadAppDataFromSqlite() });
});

app.put("/api/app-data", (request, response) => {
  const data = request.body as Partial<AppData>;

  if (data.app !== "maintenance-inventory-tracker") {
    response.status(400).json({ error: "Invalid app data payload." });
    return;
  }

  const result = saveAppDataSnapshot(data as AppData);
  response.json({ ok: true, ...result });
});

app.use(express.static(frontendDist));
app.get("*", (_request, response) => {
  response.sendFile(path.join(frontendDist, "index.html"));
});

app.listen(port, () => {
  console.log(`Maintenance Inventory Tracker 3 website backend running on http://localhost:${port}`);
  console.log(`SQLite database: ${getDatabasePath()}`);
});
