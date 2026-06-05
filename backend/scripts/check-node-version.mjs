#!/usr/bin/env node
const semver = (v) => v.split('.').map(n => parseInt(n, 10));
const nodeVersion = process.versions.node; // e.g. '22.22.3'
const major = parseInt(nodeVersion.split('.')[0], 10);
if (major !== 22) {
  console.error(`Maintenance Inventory Tracker 3 backend requires Node.js 22 LTS. Current Node is v${nodeVersion}. Install Node 22 LTS, restart VS Code/PowerShell, then rerun npm install.`);
  process.exit(1);
}
console.log(`Node.js v${nodeVersion} detected (OK for Node 22 LTS).`);
process.exit(0);
