# Maintenance Inventory Tracker 3.0 Website Backend

This backend powers website mode for Maintenance Inventory Tracker 3.0.

```text
Company laptop browser -> React website -> Backend API -> SQLite database
```

The backend runs on `http://localhost:4173` by default and stores website data in SQLite at:

```text
backend/data/maintenance_inventory_3_web.db
```

JSON backup, export, and import remain available in the app as the emergency backup and restore path.

## Required Node Version

Use Node.js 22 LTS for the backend. This repo pins local version-manager files to:

```text
22.11.0
```

Do not use Node 25 for this backend. Native SQLite packages may not have ready Windows binaries for very new Node versions, which can force a local native build and fail if Python or Visual Studio Build Tools are missing.

Check your version:

```powershell
node -v
npm -v
```

Expected Node version:

```text
v22.x.x
```

## Windows Setup

### Option A: Direct Download

1. Go to `nodejs.org`.
2. Download Node.js 22 LTS.
3. Run the installer with default settings.
4. Close every PowerShell, terminal, and VS Code window.
5. Open a new PowerShell and verify:

```powershell
node -v
npm -v
```

### Option B: nvm-windows

```powershell
nvm install 22.11.0
nvm use 22.11.0
node -v
npm -v
```

## Install And Run

From the repo root:

```powershell
cd backend
npm install
npm run build
npm run dev
```

The backend should start at:

```text
http://localhost:4173
```

Health check:

```text
http://localhost:4173/api/health
```

The health response includes SQLite table counts, including `app_snapshots`.

## Production Start

Build the backend, then run the compiled server:

```powershell
cd backend
npm install
npm run build
npm start
```

If `frontend/dist` exists, the backend also serves the built frontend assets.

## Environment Variables

- `PORT` or `MIT3_PORT`: backend port. Default: `4173`.
- `MIT3_ALLOWED_ORIGINS`: comma-separated API origins for CORS. Default: `http://localhost:4173,http://localhost:5173`.
- `MIT3_DB_PATH`: SQLite database file path. Default: `backend/data/maintenance_inventory_3_web.db`.

Example:

```powershell
$env:MIT3_PORT="4173"
$env:MIT3_ALLOWED_ORIGINS="http://localhost:4173,http://localhost:5173"
$env:MIT3_DB_PATH="D:\Maintenance Inventory Tracker\maintenance_inventory_3_web.db"
npm run dev
```

Keep the backend port at `4173` for the standard local website/company-laptop setup.

## API

- `GET /api/health` verifies backend and SQLite startup and returns table counts.
- `GET /api/app-data` loads the current app data snapshot from SQLite.
- `PUT /api/app-data` saves the current app data snapshot to SQLite.

Current website data mode stores the full app data payload in SQLite as an app snapshot. This keeps the V3 data shape intact while moving website save/load behind the backend API.

## Frontend Website Mode

Run the frontend in a second terminal:

```powershell
cd frontend
copy .env.website.example .env.local
npm install
npm run dev
```

The website environment should contain:

```env
VITE_MIT3_DATA_SOURCE=api
VITE_MIT3_API_BASE_URL=http://localhost:4173
```

Open:

```text
http://localhost:5173
```

## Troubleshooting better-sqlite3

If `npm install` fails while installing `better-sqlite3`, first confirm Node 22 is active:

```powershell
node -v
```

Then do a clean install:

```powershell
cd backend
rmdir /s /q node_modules
if (Test-Path package-lock.json) { del package-lock.json }
npm install
```

If it still fails, install:

1. Python 3 from `python.org`.
2. Visual Studio Build Tools 2022.
3. The Visual Studio Installer workload **Desktop development with C++**.

Restart PowerShell or VS Code, then run the clean install again.

## Safety Rule

Do not remove SQLite. Do not remove JSON backup, export, or import. SQLite is the website live data store, and JSON remains the disaster recovery path.
