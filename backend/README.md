<<<<<<< HEAD
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
=======
# Backend Setup for Windows

This backend powers the website version of Maintenance Inventory Tracker. It uses Node.js 22 LTS with Express and SQLite.

## Prerequisites

### Windows Setup (Recommended)

For best compatibility on Windows company laptops, follow these steps **in order**:

1. **Install Node.js 22 LTS**
   - Download from [nodejs.org](https://nodejs.org/en/) (choose LTS version 22.x)
   - Run the installer with default settings
   - Restart your terminal/PowerShell after installation
   - Verify: `node --version` should show `v22.x.x`

2. **Install Python 3**
   - Download from [python.org](https://www.python.org/downloads/) (version 3.9 or newer)
   - Run the installer and **check "Add Python to PATH"**
   - Restart your terminal after installation
   - Verify: `python --version` should show `3.x.x`

3. **Install Visual Studio Build Tools**
   - Download from [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/)
   - Look for "Build Tools for Visual Studio 2022"
   - Install with option: **Desktop development with C++**
   - This provides the compiler needed for `better-sqlite3`

### Verify Your Environment

After all installations, verify everything is working:

```powershell
node --version      # Should be v22.x.x or higher
npm --version       # Should be 11.x.x or higher (comes with Node)
python --version    # Should be 3.9 or higher
```

## Installation

### Clean Install (if you had errors before)

```powershell
cd backend
rm -r node_modules
rm package-lock.json
npm install
```

### Normal Install

```powershell
cd backend
npm install
```

## Development

Start the development server with hot reload:

```powershell
cd backend
npm run dev
```

The backend will be available at `http://localhost:4173` (configurable via `MIT3_PORT` env var).

## Build for Production

Compile TypeScript to JavaScript:

```powershell
cd backend
npm run build
```

Output goes to `dist/` folder.

## Start Production Server

Run the built production version:

```powershell
cd backend
npm start
```

## Environment Variables

- `PORT` or `MIT3_PORT`: Backend port (default: 4173)
- `MIT3_ALLOWED_ORIGIN`: Frontend origin for CORS (default: http://localhost:5173)

Example:

```powershell
$env:MIT3_PORT = 4173
$env:MIT3_ALLOWED_ORIGIN = "http://localhost:5173"
npm run dev
```

## Architecture

- **Database**: SQLite with automatic schema initialization
- **API**: Express REST API with CORS support
- **Frontend Integration**: Serves data via `/api/app-data` endpoint
- **Health Check**: `/api/health` endpoint for diagnostics

The backend maintains SQLite as the primary database and supports JSON backup exports.

## Troubleshooting

### Error: `better-sqlite3` build fails

This usually means Node version or build tools are missing:

1. Verify Node 22 is installed: `node --version`
2. Verify Python is installed: `python --version`
3. Verify Visual Studio Build Tools are installed (see Prerequisites)
4. Delete `node_modules` and `package-lock.json`
5. Run `npm install` again

If issues persist, run:

```powershell
npm config set msbuild_path "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\MSBuild.exe"
rm -r node_modules
rm package-lock.json
npm install
```

### Error: `tsx` is not recognized

This error appears when `npm install` failed. Solution:

1. Check that `npm install` completed successfully with no errors
2. Verify Node and npm are in your PATH: `node --version` and `npm --version`
3. If still failing, delete `node_modules` and `package-lock.json` and reinstall

### Port 4173 already in use

If the backend can't start on the default port:

```powershell
$env:MIT3_PORT = 5000
npm run dev
```

Then update your frontend `.env` or `MIT3_ALLOWED_ORIGIN` accordingly.

## Next Steps

After setup, the backend is ready for the website version development. See [../docs/WEBSITE_PLAN.md](../docs/WEBSITE_PLAN.md) for architecture details.
>>>>>>> 4ab1d60 (update 6)
