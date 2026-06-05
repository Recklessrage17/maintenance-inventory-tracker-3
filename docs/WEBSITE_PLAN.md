# V3 Website Plan

Desktop V3 stays Tauri + SQLite. The current JSON save/load path remains live until a later migration pass.

The website version should reuse React/Vite UI components where practical, but it needs a backend/API because Tauri-only APIs do not run in a browser. Tauri-specific calls should be isolated behind adapter modules before website work begins.

Note: Backend Windows setup and exact install steps are documented in [backend/README.md](../backend/README.md). The backend requires Node 22 LTS, starts on http://localhost:4173, and uses the SQLite database at `backend/data/maintenance_inventory_3_web.db` by default.

PDF generation can remain frontend-based where it is browser-compatible. Desktop-only filesystem features, folder backups, installer checks, and local file dialogs need browser-safe alternatives such as uploads, downloads, cloud storage, or backend jobs.

Future backend options can be Node/Express or a similar API server. The website database can be PostgreSQL or hosted SQL later. Do not implement the website backend or database in this planning pass.
