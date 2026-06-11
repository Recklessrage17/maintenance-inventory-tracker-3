Maintenance Inventory Tracker 3 website backups

The website backend manages this folder automatically.

json/maintenance-inventory-latest.json is refreshed after every successful app-data save.
json/maintenance-inventory-YYYY-MM-DD-HHMMSS.json files are timestamped restore points; the backend keeps the latest 30.
csv/*.csv files are refreshed after every successful app-data save for quick review and reporting.

Do not edit generated files while the website is running. Use Settings > Backup Now to refresh backups manually.
