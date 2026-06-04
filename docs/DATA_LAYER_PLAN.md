# V3 Data Layer Plan

## Current Live Data Flow

JSON/current app data remains the live data source for settings, backup, and restore. Vendors, locations, inventory, stock ledger/history, requisitions, and Recently Deleted/trash are now SQLite live-read/write pilots on desktop, with IndexedDB still saving the full `AppData` object as fallback/export compatibility.

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

Keep `JsonLocalDataAdapter` as the live behavior for settings, backup, and restore until each later migration pass is planned and tested.

## SQLite Pilot - Vendors And Locations

The first SQLite pilot now covers only vendors and locations. On desktop load, the app still loads the existing JSON/IndexedDB data first, backfills SQLite if the vendor/location tables are empty, then uses SQLite vendors and locations in app state.

Vendor/location state changes continue through the existing React flows, then sync to SQLite with stable IDs, upserts, and delete-by-absence pruning. The full `AppData` object still saves to IndexedDB so JSON backup/export and fallback behavior remain available.

Inventory, stock history, requisitions, PDF, print, backup, and restore behavior are unchanged. Restore/import replaces app state through the existing JSON path, and the vendor/location sync effect writes the restored vendors and locations into SQLite after state updates.

## SQLite Pilot - Inventory

Inventory now uses SQLite as the active desktop read/write pilot. On desktop load, the app loads JSON/IndexedDB first for fallback compatibility, backfills SQLite inventory when needed, then uses SQLite inventory rows in `data.items`.

Inventory changes still flow through the existing React app state, then sync to SQLite with stable IDs, upserts, and stale-row pruning. The full `AppData` object still saves to IndexedDB so backup/export/import and fallback remain compatible. Stock history, requisitions, PDF/print, and UI behavior are unchanged.

## SQLite Pilot - Stock Ledger

Stock ledger/history now uses SQLite as the active desktop read/write pilot. On desktop load, the app loads JSON/IndexedDB first for fallback compatibility, backfills SQLite history when needed, then uses SQLite stock ledger rows in `data.stockChanges`.

Stock edit still creates history through the existing React app state flow, then syncs to SQLite with stable IDs, upserts, and stale-row pruning. History Logs UI, history pagination, history print/export, backup/restore, and requisitions keep their existing behavior.

## SQLite Pilot - Requisitions

Requisitions now use SQLite as the active desktop read/write pilot. On desktop load, the app loads JSON/IndexedDB first for fallback compatibility, backfills SQLite requisition data when needed, then uses SQLite requisition rows in `data.requisitionMadeRecords`.

The Reorder List, Requisition Made view, requisition history, and official PDF generation still use the same React state shape and UI flow. Backup/export/import still uses the full JSON `AppData` payload, and restore/import syncs restored requisition records back into SQLite.

## SQLite Pilot - Recently Deleted / Trash

Recently Deleted/trash now uses SQLite as the active desktop read/write pilot. On desktop load, the app loads JSON/IndexedDB first for fallback compatibility, syncs JSON deleted records into SQLite when needed, then uses SQLite deleted records in `data.deletedRecords`.

Delete, undo/restore, Delete Forever, and the 30-minute purge keep the same React UI flow while also saving or removing the matching SQLite `deleted_records` rows. Backup/export/import still uses the full JSON `AppData` payload, and restore/import syncs restored deleted records back into SQLite before app state is replaced.
