# Maintenance Inventory Tracker 3.0 Database Plan

## Architecture Detected

The current project is a very small React/Vite frontend workspace.

- `frontend/package.json` defines a Vite React app with `dev`, `build`, `lint`, and `preview` scripts.
- `frontend/src` contains the default starter-style React app.
- `frontend/vite.config.ts` uses only `@vitejs/plugin-react`.
- `backend` exists as a folder, but no backend package, source files, or config files were found.
- `database/migrations` and `database/seed` exist and were empty before this pass.
- No `src-tauri` folder was found at the project root or under `frontend`.
- No Express, SQLite, Tauri, localStorage app data layer, CSV import, JSON backup, or inventory domain code was found in the current source files.

Conclusion: this is frontend-only right now. It is not currently a Tauri desktop app and it does not currently have a Node/Express backend.

## Safest Database Direction

Use SQLite as the future local live database, but do not install SQLite packages or wire the UI yet because there is no confirmed runtime host for SQLite.

The safest next implementation step is to choose the runtime boundary first:

- If this becomes a local backend app, put SQLite access in the backend and expose a small API to the frontend.
- If this becomes a Tauri desktop app, use a Tauri-compatible SQLite plugin and keep database access behind Tauri commands or a repository layer.
- If it remains browser-only, SQLite is not the right direct runtime without a deliberate WebAssembly or IndexedDB-backed choice, so keep the frontend unchanged until that decision is made.

For 3.0, keep this split:

- SQLite: live app data.
- JSON: backup, export, import, and restore.
- CSV: inventory item import.

## Implemented Now

This pass only adds safe foundation artifacts:

- `database/migrations/001_initial_schema.sql`
- `database/seed/README.md`
- `docs/DATABASE_PLAN.md`

No frontend runtime code was changed. No backend runtime code was added. No packages were installed.

## Planned Tables

### inventory_items

Stores live inventory records.

Important fields preserved:

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
- `cost`
- `notes`
- `order_placed`
- `reorder_hold`
- `created_at`
- `updated_at`

Legacy JSON names should map as follows:

- `itemName` maps to `item_name`.
- `partNumber` maps to `part_number`.
- `vendorId` maps to `vendor_id`.
- `vendorName` resolves or creates a row in `vendors`, then maps to `vendor_id`.
- `locationId` maps to `location_id`.
- `locationName` resolves or creates a row in `locations`, then maps to `location_id`.
- `stockOnHand` maps to `stock_on_hand`.
- `lowAlert` maps to `low_alert`.
- `orderPlaced` maps to `order_placed`.
- `reorderHold` maps to `reorder_hold`.
- `createdAt` maps to `created_at`.
- `updatedAt` maps to `updated_at`.

### vendors

Stores vendor records normalized away from inventory item rows. JSON imports that only contain `vendorName` should create or reuse a vendor by name.

### locations

Stores storage locations normalized away from inventory item rows. JSON imports that only contain `locationName` should create or reuse a location by name.

### stock_ledger

Stores all quantity-changing events.

Important fields preserved:

- `id`
- `item_id`
- `part_number`
- `action_type`
- `old_quantity`
- `quantity_change`
- `new_quantity`
- `reason`
- `used_by`
- `notes`
- `date_time`

Legacy JSON names should map as follows:

- `itemId` maps to `item_id`.
- `partNumber` maps to `part_number`.
- `actionType` maps to `action_type`.
- `oldQuantity` maps to `old_quantity`.
- `quantityChange` maps to `quantity_change`.
- `newQuantity` maps to `new_quantity`.
- `usedBy` maps to `used_by`.
- `dateTime` maps to `date_time`.

### requisitions

Stores requisition headers, including requester, status, needed date, notes, submission date, and fulfillment date.

### requisition_lines

Stores requisition item lines linked to requisitions and, when possible, inventory items.

### reorder_history

Stores reorder events, planned orders, placed orders, received orders, cost snapshots, and notes.

### deleted_records

Stores recoverable trash records.

Important fields preserved:

- `id`
- `record_type`
- `record_id`
- `deleted_at`
- `expires_at`
- `payload_json`

Legacy JSON names should map as follows:

- `recordType` maps to `record_type`.
- `recordId` maps to `record_id`.
- `deletedAt` maps to `deleted_at`.
- `expiresAt` maps to `expires_at`.
- `payloadJson` maps to `payload_json`.

### app_settings

Stores application preferences and feature settings as JSON values by key.

### users

Stores local user records for future accountability fields such as requester, fulfiller, and stock adjustment actor.

### roles

Stores local role definitions and permission JSON.

### metadata

Stores schema and application data metadata, including schema version and live-data mode.

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
- app settings
- `orderPlaced`
- `reorderHold`

Future JSON restore flow:

1. Validate backup shape and version.
2. Load vendors and locations first.
3. Load inventory items and preserve original IDs.
4. Load stock ledger rows and preserve original IDs.
5. Load requisitions and requisition lines.
6. Load reorder history.
7. Load deleted records with `payload_json` intact.
8. Load app settings and metadata.
9. Recalculate low-stock indicators only after raw values are imported.
10. Produce a restore report with row counts and skipped records.

## CSV Import Safety

CSV import should remain inventory-focused. It should import or update inventory items, resolve vendor and location names, and create stock ledger rows only when quantity changes are explicitly accepted by the user.

## Future Runtime Options

### If a backend is added

Use the backend as the SQLite owner. Add a small database module such as `backend/src/db.ts`, run migrations from `database/migrations`, and expose narrow API endpoints for inventory, vendors, locations, stock ledger, requisitions, backups, restores, and imports.

### If Tauri is added

Use a Tauri-compatible SQLite setup after the `src-tauri` project exists. Keep migrations in `database/migrations`, keep SQL access behind Tauri commands or a repository layer, and avoid giving React components direct SQL responsibility.

### If the app remains frontend-only

Pause before adding SQLite dependencies. Browser-only SQLite needs an explicit storage strategy, such as WebAssembly plus IndexedDB persistence. That is a larger architectural choice than this foundation pass.

## Not Implemented Yet

- SQLite runtime package installation.
- Backend database connection code.
- Tauri SQLite plugin setup.
- React data repository wiring.
- JSON-to-SQLite migration script.
- CSV import implementation.
- UI changes.
