# Maintenance Inventory Tracker 3.0 Website Mode

Website mode is the company-laptop setup for Maintenance Inventory Tracker 3.0.

## Goal

Use the same React app in a browser, but move live data storage out of the browser and into a backend-owned SQLite database.

```text
Company laptop browser -> React website -> Backend API -> SQLite database
```

This avoids relying on each laptop browser's IndexedDB as the live source of truth.

## Current Implementation

Implemented in this pass:

- `backend/package.json`
- `backend/tsconfig.json`
- `backend/src/schema.ts`
- `backend/src/db.ts`
- `backend/src/server.ts`
- `frontend/.env.website.example`
- `frontend/src/lib/db.ts` API mode support

The backend exposes:

- `GET /api/health` - verifies backend and SQLite startup.
- `GET /api/app-data` - loads the current app data snapshot from SQLite.
- `PUT /api/app-data` - saves the current app data snapshot to SQLite.

## Data Mode

The first website-ready step stores the full app data payload in SQLite as an app snapshot. This keeps the current V3 data shape safe while moving the live save/load path behind a backend API.

Next database hardening step:

- Split the snapshot save into fully normalized table writes for inventory, vendors, locations, stock ledger, requisitions, deleted records, audit log, and settings.
- Keep the snapshot table as an emergency rollback and restore point.
- Keep JSON backup/export/import for disaster recovery.

## Frontend Website Environment

Create `frontend/.env.website` from `frontend/.env.website.example`:

```env
VITE_MIT3_DATA_SOURCE=api
VITE_MIT3_API_BASE_URL=http://localhost:4173
```

For production where the backend serves `frontend/dist`, the API base URL can be blank or omitted.

## Local Development Run

Open two terminals.

Terminal 1:

```powershell
cd backend
npm install
npm run dev
```

Terminal 2:

```powershell
cd frontend
copy .env.website.example .env.local
npm install
npm run dev
```

Then open the Vite dev URL shown in the terminal.

## Single Backend Website Run

Build the frontend first:

```powershell
cd frontend
copy .env.website.example .env.local
npm install
npm run build
```

Then run the backend:

```powershell
cd ..\backend
npm install
npm run build
npm start
```

Open:

```text
http://localhost:4173
```

## SQLite Database Location

Default database path:

```text
backend/data/maintenance_inventory_3_web.db
```

Override it with:

```powershell
$env:MIT3_DB_PATH="D:\Maintenance Inventory Tracker\maintenance_inventory_3_web.db"
```

## Company Laptop Notes

For one maintenance office computer, running the backend locally is fine.

For multiple company laptops at the same time, do not point every laptop at its own local database. Use one shared backend computer or server on the company network, then have laptops open that backend website URL.

## Important Safety Rule

Do not remove JSON backup. SQLite is live data. JSON stays as backup, export, import, and restore safety.
