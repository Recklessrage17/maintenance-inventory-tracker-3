# V3 Data Layer Plan

## Current Live Data Flow

JSON/current app data remains the live data source. The app loads and saves the whole `AppData` object through `frontend/src/lib/db.ts`, which currently stores one `app` record in IndexedDB.

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

Keep `JsonLocalDataAdapter` as the only live behavior until a separate migration pass is planned and tested.

## SQLite Pilot - Vendors And Locations

The first SQLite pilot mirrors only current JSON vendors and locations into SQLite during dev/Tauri runtime. JSON/IndexedDB remains the source of truth, and React screens still read and write the existing `AppData` object.

The mirror uses stable vendor/location IDs, upserts current records, removes mirror rows that no longer exist in JSON, and logs JSON versus SQLite counts for validation. Inventory, stock history, requisitions, PDF, print, backup, and restore behavior are unchanged.
