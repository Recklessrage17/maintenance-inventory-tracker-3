# V3 Data Layer Plan

## Current Live Data Flow

JSON/current app data remains the live data source for inventory, history, requisitions, settings, backup, and restore. Vendors and locations are now the first SQLite live-read/write pilot on desktop, with IndexedDB still saving the full `AppData` object as fallback/export compatibility.

- App load: `frontend/src/App.tsx` calls `loadAppData()` during startup, normalizes the result, and falls back to demo data when no saved data is found.
- App save: `frontend/src/App.tsx` watches `data` state and calls `saveAppData(data)` after changes.
- Backup/export: `frontend/src/lib/backup.ts` creates portable JSON payloads with `createBackupPayload()`, and `frontend/src/App.tsx` exports JSON with `downloadTextFile()` or writes backup files with `writeBackupFile()`.
- Restore/import: `frontend/src/App.tsx` reads JSON files or folder backups, validates with `validateBackupPayload()`, normalizes through the existing import path, and replaces current app state.
- CSV import: `frontend/src/App.tsx` parses CSV with `parseCsv()`, previews changes, then updates in-memory inventory/vendors/locations before the existing save effect persists data.
- SQLite runtime check: `frontend/src/main.tsx` calls `runDevSqliteRuntimeCheck()` from `frontend/src/lib/sqliteRuntime.ts`; this only verifies the Tauri SQLite foundation in development.

## Desktop V3

Desktop V3 remains a Tauri app. SQLite is the future local live database, but this pass does not migrate inventory, vendors, locations, history, requisitions, or settings into SQLite.

JSON backup/export/import remains part of desktop V3 even after SQLite becomes live storage. SQLite should eventually sit behind a data adapter or repository boundary instead of being called directly from React screens.

## Website V3

The React/Vite frontend can be shared with the future website, but a normal website cannot use Tauri-only APIs such as desktop file dialogs, direct local filesystem commands, or the Tauri SQL plugin.

Website V3 will need a backend/API for server-side data access. The website database can be chosen later, such as PostgreSQL or hosted SQL. The shared UI should call a data adapter instead of directly touching IndexedDB, Tauri commands, or backend fetch calls.

## Adapter Direction

- `JsonLocalDataAdapter`: current live data behavior using IndexedDB plus JSON backup/export/import.
- `SqliteDesktopDataAdapter`: future desktop adapter using Tauri + SQLite.
- `WebApiDataAdapter`: future website adapter using HTTP calls to a backend/API.

Keep `JsonLocalDataAdapter` as the live behavior for everything except the vendor/location SQLite pilot until each later migration pass is planned and tested.

## SQLite Pilot - Vendors And Locations

The first SQLite pilot now covers only vendors and locations. On desktop load, the app still loads the existing JSON/IndexedDB data first, backfills SQLite if the vendor/location tables are empty, then uses SQLite vendors and locations in app state.

Vendor/location state changes continue through the existing React flows, then sync to SQLite with stable IDs, upserts, and delete-by-absence pruning. The full `AppData` object still saves to IndexedDB so JSON backup/export and fallback behavior remain available.

Inventory, stock history, requisitions, PDF, print, backup, and restore behavior are unchanged. Restore/import replaces app state through the existing JSON path, and the vendor/location sync effect writes the restored vendors and locations into SQLite after state updates.

## SQLite Mirror - Inventory

Inventory has started as a SQLite mirror only. In development desktop runs, `data.items` is upserted into `inventory_items` with stable IDs and stale mirror rows are pruned. The Inventory UI, stock edit flow, CSV import, backup/restore, stock history, and requisitions still use the existing JSON/IndexedDB app state path.
