# Seed Data

Seed files for Maintenance Inventory Tracker 3.0 should live in this folder.

Keep seed data small and deterministic. Prefer explicit IDs so local test data,
JSON exports, and future migrations can be compared without noisy changes.

Recommended seed order:

1. roles
2. users
3. vendors
4. locations
5. inventory_items
6. stock_ledger
7. requisitions
8. requisition_lines
9. reorder_history
10. app_settings
11. metadata

Do not store production backups here. JSON backup/export files should remain a
separate backup and restore safety system.
