# V3 Website Plan

The website backend is implemented for the company-laptop/browser mode.

```text
React browser -> backend API -> SQLite
```

Desktop V3 remains Tauri + SQLite, and desktop-only filesystem features remain available in the Tauri desktop app. JSON backup, export, and import stay available as the emergency safety path.

## Current Website Mode

- Website mode is enabled with `VITE_MIT3_DATA_SOURCE=api`.
- The backend runs on `http://localhost:4173`.
- The default SQLite database path is `backend/data/maintenance_inventory_3_web.db`.
- Current data mode is SQLite app snapshot save/load through `GET /api/app-data` and `PUT /api/app-data`.
- Browser CSV uses download/upload actions. CSV folder sync remains a desktop-only Tauri feature.

## Backend Setup

Windows backend setup and install steps are documented in [backend/README.md](../backend/README.md). The backend requires Node 22 LTS.

## Next Hardening Step

Normalize SQLite writes and reads into dedicated tables for inventory, vendors, locations, stock ledger, requisitions, deleted records, audit log, and settings.

Keep the app snapshot table as a recovery/rollback path during that hardening work. Keep JSON backup/export/import as disaster recovery safety.
