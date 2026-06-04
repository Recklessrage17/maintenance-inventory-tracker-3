import { getAppVersion } from "./appVersion";

export const APP_VERSION = "3.0.0-rc.1";
export const DEFAULT_MANUAL_UPDATE_FOLDER =
  "C:\\Users\\maste\\OneDrive\\Company - Files - 2.0\\JBT USA - Files\\Dash Board - Info\\Inventoy System app\\Maintenance Inventory Tracker\\App Updates\\";

const UPDATE_FOLDER_STORAGE_KEY = "maintenance-inventory-manual-update-folder";
const INSTALLER_PATTERN = /^Maintenance Inventory Tracker 3\.0_(\d+(?:\.\d+){1,3}(?:-[0-9A-Za-z.-]+)?)_x64-setup\.exe$/i;

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type TauriWindow = Window & {
  __TAURI__?: {
    core?: {
      invoke?: TauriInvoke;
    };
  };
};

type TauriInstallerFileList = {
  folderExists: boolean;
  fileNames: string[];
};

export type InstallerCandidate = {
  fileName: string;
  version: string;
};

export type ManualInstallerCheckResult = {
  currentVersion: string;
  folderExists: boolean;
  folderPath: string;
  installers: InstallerCandidate[];
  newestInstaller: InstallerCandidate | null;
  newerInstaller: InstallerCandidate | null;
  statusMessage: string;
};

function getTauriInvoke(): TauriInvoke | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return (window as TauriWindow).__TAURI__?.core?.invoke;
}

function normalizeUpdateFolder(folderPath: string) {
  return folderPath.trim() || DEFAULT_MANUAL_UPDATE_FOLDER;
}

export function getManualInstallerFolder() {
  if (typeof localStorage === "undefined") {
    return DEFAULT_MANUAL_UPDATE_FOLDER;
  }

  return normalizeUpdateFolder(localStorage.getItem(UPDATE_FOLDER_STORAGE_KEY) ?? "");
}

export function saveManualInstallerFolder(folderPath: string) {
  const normalizedFolder = normalizeUpdateFolder(folderPath);

  if (typeof localStorage !== "undefined") {
    localStorage.setItem(UPDATE_FOLDER_STORAGE_KEY, normalizedFolder);
  }

  return normalizedFolder;
}

export function compareVersions(leftVersion: string, rightVersion: string) {
  const parseVersion = (version: string) => {
    const trimmedVersion = version.trim();
    const prereleaseStart = trimmedVersion.indexOf("-");
    const core = prereleaseStart === -1 ? trimmedVersion : trimmedVersion.slice(0, prereleaseStart);
    const prerelease = prereleaseStart === -1 ? "" : trimmedVersion.slice(prereleaseStart + 1);

    return {
      parts: core.split(".").map((part) => Number.parseInt(part, 10)),
      prereleaseParts: prerelease ? prerelease.split(".") : []
    };
  };
  const comparePrereleasePart = (leftPart: string, rightPart: string) => {
    const numericIdentifierPattern = /^\d+$/;
    const leftIsNumeric = numericIdentifierPattern.test(leftPart);
    const rightIsNumeric = numericIdentifierPattern.test(rightPart);

    if (leftIsNumeric && rightIsNumeric) {
      const leftNumber = Number.parseInt(leftPart, 10);
      const rightNumber = Number.parseInt(rightPart, 10);

      return leftNumber === rightNumber ? 0 : leftNumber > rightNumber ? 1 : -1;
    }

    if (leftIsNumeric !== rightIsNumeric) {
      return leftIsNumeric ? -1 : 1;
    }

    return leftPart === rightPart ? 0 : leftPart > rightPart ? 1 : -1;
  };
  const leftVersionParts = parseVersion(leftVersion);
  const rightVersionParts = parseVersion(rightVersion);
  const leftParts = leftVersionParts.parts;
  const rightParts = rightVersionParts.parts;
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const left = Number.isFinite(leftParts[index]) ? leftParts[index] : 0;
    const right = Number.isFinite(rightParts[index]) ? rightParts[index] : 0;

    if (left > right) {
      return 1;
    }

    if (left < right) {
      return -1;
    }
  }

  if (leftVersionParts.prereleaseParts.length && !rightVersionParts.prereleaseParts.length) {
    return -1;
  }

  if (!leftVersionParts.prereleaseParts.length && rightVersionParts.prereleaseParts.length) {
    return 1;
  }

  const prereleaseLength = Math.max(leftVersionParts.prereleaseParts.length, rightVersionParts.prereleaseParts.length);

  for (let index = 0; index < prereleaseLength; index += 1) {
    const leftPart = leftVersionParts.prereleaseParts[index];
    const rightPart = rightVersionParts.prereleaseParts[index];

    if (leftPart === undefined) {
      return -1;
    }

    if (rightPart === undefined) {
      return 1;
    }

    const comparison = comparePrereleasePart(leftPart, rightPart);

    if (comparison !== 0) {
      return comparison;
    }
  }

  return 0;
}

function installerFromFileName(fileName: string): InstallerCandidate | null {
  const match = fileName.match(INSTALLER_PATTERN);

  if (!match) {
    return null;
  }

  return {
    fileName,
    version: match[1]
  };
}

export function getNewestInstaller(fileNames: string[]) {
  const installers = fileNames
    .map(installerFromFileName)
    .filter((installer): installer is InstallerCandidate => Boolean(installer))
    .sort((left, right) => compareVersions(right.version, left.version) || left.fileName.localeCompare(right.fileName));

  return installers[0] ?? null;
}

function isSafeInstallerFileName(fileName: string) {
  return INSTALLER_PATTERN.test(fileName) && !fileName.includes("/") && !fileName.includes("\\") && !fileName.includes("..");
}

export async function getCurrentAppVersion() {
  return getAppVersion(APP_VERSION);
}

export async function checkManualInstallerFolder(folderPath = getManualInstallerFolder()): Promise<ManualInstallerCheckResult> {
  const normalizedFolder = normalizeUpdateFolder(folderPath);
  const currentVersion = await getCurrentAppVersion();
  const invoke = getTauriInvoke();

  if (!invoke) {
    return {
      currentVersion,
      folderExists: false,
      folderPath: normalizedFolder,
      installers: [],
      newestInstaller: null,
      newerInstaller: null,
      statusMessage: "Installer folder checking is available in the desktop app."
    };
  }

  const result = await invoke<TauriInstallerFileList>("list_manual_installer_files", {
    directoryPath: normalizedFolder
  });
  const installers = result.fileNames
    .map(installerFromFileName)
    .filter((installer): installer is InstallerCandidate => Boolean(installer))
    .sort((left, right) => compareVersions(right.version, left.version) || left.fileName.localeCompare(right.fileName));
  const newestInstaller = installers[0] ?? null;
  const newerInstaller = installers.find((installer) => compareVersions(installer.version, currentVersion) > 0) ?? null;
  const statusMessage = !result.folderExists
    ? "Installer folder not found. Run release build first or choose an update folder."
    : newerInstaller
      ? "Update available."
      : "You are up to date.";

  return {
    currentVersion,
    folderExists: result.folderExists,
    folderPath: normalizedFolder,
    installers,
    newestInstaller,
    newerInstaller,
    statusMessage
  };
}

export async function openInstallerFolder(folderPath = getManualInstallerFolder()) {
  const invoke = getTauriInvoke();

  if (!invoke) {
    throw new Error("Opening the installer folder is available in the desktop app.");
  }

  await invoke("open_manual_installer_folder", {
    directoryPath: normalizeUpdateFolder(folderPath)
  });
}

export async function openInstallerFile(folderPath: string, fileName: string) {
  if (!isSafeInstallerFileName(fileName)) {
    throw new Error("Installer file name is invalid.");
  }

  const invoke = getTauriInvoke();

  if (!invoke) {
    throw new Error("Opening the installer file is available in the desktop app.");
  }

  await invoke("open_manual_installer_file", {
    directoryPath: normalizeUpdateFolder(folderPath),
    fileName
  });
}

export async function chooseManualInstallerFolder() {
  const invoke = getTauriInvoke();

  if (!invoke) {
    throw new Error("Choosing an installer folder is available in the desktop app.");
  }

  const folderPath = await invoke<string | null>("choose_manual_installer_folder");

  if (!folderPath) {
    throw new Error("No update folder selected.");
  }

  return saveManualInstallerFolder(folderPath);
}
