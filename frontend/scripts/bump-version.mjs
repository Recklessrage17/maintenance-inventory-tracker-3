import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const packageName = "maintenance-inventory-tracker";

function filePath(...parts) {
  return path.join(repoRoot, ...parts);
}

function readText(relativePath) {
  return readFileSync(filePath(relativePath), "utf8");
}

function writeText(relativePath, contents) {
  writeFileSync(filePath(relativePath), contents, "utf8");
}

function detectNewline(contents) {
  return contents.includes("\r\n") ? "\r\n" : "\n";
}

function stringifyJson(json, newline) {
  return `${JSON.stringify(json, null, 2).replace(/\n/g, newline)}${newline}`;
}

function readJson(relativePath) {
  const contents = readText(relativePath);
  return {
    json: JSON.parse(contents),
    newline: detectNewline(contents)
  };
}

function bumpPatch(version) {
  const prereleaseMatch = version.match(/^(\d+)\.(\d+)\.(\d+)-([0-9A-Za-z.-]*?)(\d+)$/);

  if (prereleaseMatch) {
    return `${prereleaseMatch[1]}.${prereleaseMatch[2]}.${prereleaseMatch[3]}-${prereleaseMatch[4]}${
      Number.parseInt(prereleaseMatch[5], 10) + 1
    }`;
  }

  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);

  if (!match) {
    throw new Error(`Expected a semver version like 0.1.0 or 3.0.0-alpha.1, but found "${version}".`);
  }

  return `${match[1]}.${match[2]}.${Number.parseInt(match[3], 10) + 1}`;
}

function replaceRequiredVersion(relativePath, pattern, oldVersion, newVersion, label) {
  const contents = readText(relativePath);
  let didReplace = false;
  const nextContents = contents.replace(pattern, (...args) => {
    const prefix = args[1];
    const foundVersion = args[2];
    const suffix = args[3];

    if (foundVersion !== oldVersion) {
      throw new Error(`${label} version is "${foundVersion}", expected "${oldVersion}".`);
    }

    didReplace = true;
    return `${prefix}${newVersion}${suffix}`;
  });

  if (!didReplace) {
    throw new Error(`Could not find ${label} version in ${relativePath}.`);
  }

  writeText(relativePath, nextContents);
}

function updatePackageJson(oldVersion, newVersion) {
  const { json, newline } = readJson("package.json");

  if (json.version !== oldVersion) {
    throw new Error(`package.json version changed while bumping: ${json.version}`);
  }

  json.version = newVersion;
  writeText("package.json", stringifyJson(json, newline));
}

function updatePackageLock(oldVersion, newVersion) {
  const relativePath = "package-lock.json";

  if (!existsSync(filePath(relativePath))) {
    return false;
  }

  const { json, newline } = readJson(relativePath);

  if (json.version === oldVersion) {
    json.version = newVersion;
  }

  if (json.packages?.[""]?.version === oldVersion) {
    json.packages[""].version = newVersion;
  }

  writeText(relativePath, stringifyJson(json, newline));
  return true;
}

function updateTauriConfig(oldVersion, newVersion) {
  const relativePath = path.join("src-tauri", "tauri.conf.json");
  const { json, newline } = readJson(relativePath);

  if (json.version !== oldVersion) {
    throw new Error(`src-tauri/tauri.conf.json version is "${json.version}", expected "${oldVersion}".`);
  }

  json.version = newVersion;
  writeText(relativePath, stringifyJson(json, newline));
}

function updateCargoToml(oldVersion, newVersion) {
  replaceRequiredVersion(
    path.join("src-tauri", "Cargo.toml"),
    /(\[package\][\s\S]*?^version\s*=\s*")([^"]+)(")/m,
    oldVersion,
    newVersion,
    "src-tauri/Cargo.toml"
  );
}

function updateCargoLock(oldVersion, newVersion) {
  const relativePath = path.join("src-tauri", "Cargo.lock");

  if (!existsSync(filePath(relativePath))) {
    return false;
  }

  const contents = readText(relativePath);
  const blocks = contents.split(/(?=\r?\n?\[\[package\]\])/);
  let didFindPackage = false;
  let didUpdatePackage = false;
  const nextContents = blocks
    .map((block) => {
      if (!new RegExp(`^name = "${packageName}"$`, "m").test(block)) {
        return block;
      }

      didFindPackage = true;
      return block.replace(/(^version = ")([^"]+)(")/m, (match, prefix, foundVersion, suffix) => {
        if (foundVersion !== oldVersion) {
          return match;
        }

        didUpdatePackage = true;
        return `${prefix}${newVersion}${suffix}`;
      });
    })
    .join("");

  if (didFindPackage && didUpdatePackage) {
    writeText(relativePath, nextContents);
  }

  return didUpdatePackage;
}

function updateFrontendAppVersion(oldVersion, newVersion) {
  const relativePath = path.join("src", "lib", "appUpdate.ts");

  if (!existsSync(filePath(relativePath))) {
    return false;
  }

  const contents = readText(relativePath);
  const nextContents = contents.replace(
    /(export const APP_VERSION = ")([^"]+)(")/,
    (match, prefix, foundVersion, suffix) => {
      if (foundVersion !== oldVersion) {
        return match;
      }

      return `${prefix}${newVersion}${suffix}`;
    }
  );

  if (nextContents !== contents) {
    writeText(relativePath, nextContents);
    return true;
  }

  return false;
}

const { json: packageJson } = readJson("package.json");
const oldVersion = packageJson.version;
const newVersion = bumpPatch(oldVersion);

updatePackageJson(oldVersion, newVersion);
const packageLockUpdated = updatePackageLock(oldVersion, newVersion);
updateTauriConfig(oldVersion, newVersion);
updateCargoToml(oldVersion, newVersion);
const cargoLockUpdated = updateCargoLock(oldVersion, newVersion);
const frontendVersionUpdated = updateFrontendAppVersion(oldVersion, newVersion);

console.log(`Maintenance Inventory Tracker version: ${oldVersion} -> ${newVersion}`);
console.log(`Old version: ${oldVersion}`);
console.log(`New version: ${newVersion}`);
console.log("Updated package.json");
console.log(packageLockUpdated ? "Updated package-lock.json" : "Skipped package-lock.json (not present)");
console.log("Updated src-tauri/tauri.conf.json");
console.log("Updated src-tauri/Cargo.toml");
console.log(cargoLockUpdated ? "Updated src-tauri/Cargo.lock" : "Skipped src-tauri/Cargo.lock (not present or app version did not match)");
console.log(frontendVersionUpdated ? "Updated src/lib/appUpdate.ts" : "Skipped src/lib/appUpdate.ts (APP_VERSION did not match)");
