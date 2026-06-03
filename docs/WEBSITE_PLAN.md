# V3 Website Plan

Desktop V3 stays Tauri + SQLite. The current JSON save/load path remains live until a later migration pass.

The website version should reuse React/Vite UI components where practical, but it needs a backend/API because Tauri-only APIs do not run in a browser. Tauri-specific calls should be isolated behind adapter modules before website work begins.

PDF generation can remain frontend-based where it is browser-compatible. Desktop-only filesystem features, folder backups, installer checks, and local file dialogs need browser-safe alternatives such as uploads, downloads, cloud storage, or backend jobs.

Future backend options can be Node/Express or a similar API server. The website database can be PostgreSQL or hosted SQL later. Do not implement the website backend or database in this planning pass.
