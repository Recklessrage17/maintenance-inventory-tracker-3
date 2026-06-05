# Maintenance Inventory Tracker 3.0 Backend

This backend is for website mode.

```text
Company laptop browser -> React website -> Backend API -> SQLite database
```

## Required Node Version

Use Node.js 22 LTS.

Do not use Node 25 for this backend. Native SQLite packages may not have ready Windows binaries for very new Node versions, which can force a local build and fail if Python or Visual Studio Build Tools are missing.

Check your version:

```powershell
node -v
npm -v
```

Expected Node version:

```text
v22.x.x
```

## Option A: Direct Download

1. Go to nodejs.org.
2. Download Node.js 22 LTS.
3. Run the installer with default settings.
4. Close every PowerShell, terminal, and VS Code window.
5. Open a new PowerShell.
6. Verify:

```powershell
node -v
npm -v
```

## Option B: nvm-windows

If you use nvm-windows:

```powershell
nvm install 22
nvm use 22
node -v
npm -v
```

## Clean Install After Switching to Node 22

From the repo root:

```powershell
cd backend
rmdir /s /q node_modules
if (Test-Path package-lock.json) { del package-lock.json }
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

## If better-sqlite3 Still Fails

Install the Windows native build tools:

1. Install Python 3 from python.org.
2. Install Visual Studio Build Tools.
3. In Visual Studio Installer, select **Desktop development with C++**.
4. Restart PowerShell / VS Code.
5. Run the clean install again:

```powershell
cd backend
rmdir /s /q node_modules
if (Test-Path package-lock.json) { del package-lock.json }
npm install
npm run build
npm run dev
```

## Scripts

```powershell
npm run dev
npm run build
npm start
```

## Database File

Default SQLite database:

```text
backend/data/maintenance_inventory_3_web.db
```

Override with:

```powershell
$env:MIT3_DB_PATH="D:\Maintenance Inventory Tracker\maintenance_inventory_3_web.db"
```

## Safety Rule

SQLite is the website live data store. JSON backup/export/import must stay in the app as the emergency backup and restore path.
