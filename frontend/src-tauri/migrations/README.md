# Tauri SQL Migrations

This folder contains Tauri SQL plugin-safe migration files.

`001_initial_schema.sql` is synced from `database/migrations/001_initial_schema.sql`.
The root migration remains the source planning artifact and keeps its explicit
transaction wrapper. The Tauri copy omits `BEGIN TRANSACTION` and `COMMIT`
because the Tauri SQL plugin runs migrations inside its own transaction.

Do not move live app data to SQLite from this folder yet. JSON/local app save
remains the live data system until the app is intentionally migrated.
