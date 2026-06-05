# Maintenance Inventory Tracker 3.0 Database Plan

## Current Direction - Website + SQLite

The V3 app is moving to Option B for company-laptop website use:

```text
Company laptop browser -> React website -> Backend API -> SQLite database
```

The browser should not talk directly to SQLite. SQLite belongs behind the backend/API. This keeps the company laptop setup safer and avoids each laptop having its own hidden browser-only database.

## Current Architecture

The repo now contains:

- `frontend` - React/Vite/TypeScript app.
- `frontend/src-tauri` - Tauri desktop wrapper and SQLite plugin setup.
- `frontend/src/lib/db.ts` - shared frontend app-data adapter.
- `frontend/src/lib/sqlite*` files - desktop SQLite mirror/pilot helpers.
- `backend` - website-mode Express API with backend-owned SQLite.
- `database/migrations` - root database planning/migration reference files.
- `docs/WEBSITE_MODE.md` - run guide for website mode.

## Website Mode Implemented Now

This pass adds a safe website backend foundation:

- `backend/package.json`
- `backend/tsconfig.json`
- `backend/src/schema.ts`
- `backend/src/db.ts`
- `backend/src/server.ts`
- `frontend/.env.website.example`
- `frontend/src/lib/db.ts` API mode support
- `docs/WEBSITE_MODE.md`

The backend exposes:

- `GET /api/health`
- `GET /api/app-data`
- `PUT /api/app-data`

The first website implementation stores the full app-data payload in SQLite as an app snapshot. This makes SQLite the website save/load owner without forcing a risky one-shot rewrite of every UI save path.

## Next Database Hardening Step

The next step is to expand backend save/load from snapshot mode into normalized live tables:

- `inventory_items`
- `vendors`
- `locations`
- `stock_ledger`
- `requisitions`
- `requisition_lines`
- `reorder_history`
- `deleted_records`
- `audit_log`
- `app_settings`

Keep `app_snapshots` as a safety fallback and rollback point.

## Planned Live Tables

### inventory_items

Stores live inventory records.

Important fields:

- `id`
- `item_name`
- `description`
- `part_number`
- `category`
- `vendor_id`
- `location_id`
- `stock_on_hand`
- `unit`
- `minimum`
- `low_alert`
- `low_stock_alert_level`
- `cost`
- `item_url`
- `notes`
- `image_placeholder`
- `image_data_url`
- `barcode_placeholder`
- `order_placed`
- `reorder_hold`
- `order_requisition_id`
- `is_demo`
- `created_at`
- `updated_at`

### vendors

Stores vendor records normalized away from inventory item rows.

### locations

Stores storage locations normalized away from inventory item rows.

### stock_ledger

Stores all quantity-changing events.

### requisitions and requisition_lines

Stores requisition headers and requisition item lines.

### reorder_history

Stores reorder events, planned orders, placed orders, received orders, cost snapshots, and notes.

### deleted_records

Stores recoverable trash records and their payload JSON.

### audit_log

Stores user-visible action history.

### app_settings

Stores application preferences and feature settings as JSON values by key.

### metadata

Stores schema and application data metadata.

## JSON Backup Safety

JSON backup/export/import remains part of the 3.0 design and should not be removed.

Backups should preserve:

- inventory
- vendors
- locations
- stock ledger/history
- requisitions
- reorder history
- recently deleted/trash
- audit log
- app settings
- `orderPlaced`
- `reorderHold`

## CSV Import Safety

CSV import should remain inventory-focused. It should import or update inventory items, resolve vendor and location names, and create stock ledger rows only when quantity changes are explicitly accepted by the user.

## Desktop Mode

The Tauri desktop app can still use the Tauri SQLite plugin and local app behavior. Website mode is separate and should use the backend API.

## Company Laptop Rule

For one laptop, local backend + local SQLite is okay.

For multiple company laptops, run one shared backend on a company-network computer/server and have all laptops open that website URL.
