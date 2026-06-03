const AUTH_RECORD_KEY = "maintenance-inventory-auth-record";
const AUTH_SESSION_KEY = "maintenance-inventory-auth-session";
const AUTH_VERSION = 1;

export type AuthRecord = {
  version: number;
  passwordHash: string;
  passwordSalt: string;
  recoveryCodeHash: string;
  recoveryCodeSalt: string;
  recoveryEmail: string;
  createdAt: string;
  updatedAt: string;
};

type AuthSession = {
  unlocked: true;
  unlockedAt: string;
  authUpdatedAt: string;
};

const encoder = new TextEncoder();

const nowIso = () => new Date().toISOString();

const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const randomBytes = (length: number) => {
  const bytes = new Uint8Array(length);

  crypto.getRandomValues(bytes);
  return bytes;
};

const ensureWebCrypto = () => {
  if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) {
    throw new Error("Web Crypto is required to protect the local password.");
  }
};

const createSalt = () => bytesToHex(randomBytes(16));

const sha256Hex = async (salt: string, value: string) => {
  ensureWebCrypto();

  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`${salt}:${value}`));

  return bytesToHex(new Uint8Array(digest));
};

const safeEqual = (left: string, right: string) => {
  if (left.length !== right.length) {
    return false;
  }

  let difference = 0;

  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return difference === 0;
};

export const normalizeRecoveryCode = (code: string) =>
  code
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

export const formatRecoveryCode = (code: string) => {
  const normalized = normalizeRecoveryCode(code);

  if (!normalized.startsWith("MT")) {
    return code.trim().toUpperCase();
  }

  const groups = [normalized.slice(0, 2), normalized.slice(2, 6), normalized.slice(6, 10), normalized.slice(10, 14)].filter(Boolean);

  return groups.join("-");
};

export const generateRecoveryCode = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(12);
  const characters = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");

  return `MT-${characters.slice(0, 4)}-${characters.slice(4, 8)}-${characters.slice(8, 12)}`;
};

const parseAuthRecord = (value: string | null): AuthRecord | null => {
  if (!value) {
    return null;
  }

  try {
    const record = JSON.parse(value) as Partial<AuthRecord>;

    if (
      record.version !== AUTH_VERSION ||
      typeof record.passwordHash !== "string" ||
      typeof record.passwordSalt !== "string" ||
      typeof record.recoveryCodeHash !== "string" ||
      typeof record.recoveryCodeSalt !== "string"
    ) {
      return null;
    }

    return {
      version: AUTH_VERSION,
      passwordHash: record.passwordHash,
      passwordSalt: record.passwordSalt,
      recoveryCodeHash: record.recoveryCodeHash,
      recoveryCodeSalt: record.recoveryCodeSalt,
      recoveryEmail: typeof record.recoveryEmail === "string" ? record.recoveryEmail : "",
      createdAt: typeof record.createdAt === "string" ? record.createdAt : nowIso(),
      updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : nowIso()
    };
  } catch {
    return null;
  }
};

export const readAuthRecord = () => parseAuthRecord(localStorage.getItem(AUTH_RECORD_KEY));

export const saveAuthRecord = (record: AuthRecord) => {
  localStorage.setItem(AUTH_RECORD_KEY, JSON.stringify(record));
};

export const createAuthRecord = async (password: string, recoveryEmail = "") => {
  const recoveryCode = generateRecoveryCode();
  const passwordSalt = createSalt();
  const recoveryCodeSalt = createSalt();
  const createdAt = nowIso();
  const record: AuthRecord = {
    version: AUTH_VERSION,
    passwordHash: await sha256Hex(passwordSalt, password),
    passwordSalt,
    recoveryCodeHash: await sha256Hex(recoveryCodeSalt, normalizeRecoveryCode(recoveryCode)),
    recoveryCodeSalt,
    recoveryEmail: recoveryEmail.trim(),
    createdAt,
    updatedAt: createdAt
  };

  saveAuthRecord(record);

  return { record, recoveryCode };
};

export const verifyPassword = async (password: string, record = readAuthRecord()) => {
  if (!record) {
    return false;
  }

  const hash = await sha256Hex(record.passwordSalt, password);

  return safeEqual(hash, record.passwordHash);
};

export const verifyRecoveryCode = async (recoveryCode: string, record = readAuthRecord()) => {
  if (!record) {
    return false;
  }

  const hash = await sha256Hex(record.recoveryCodeSalt, normalizeRecoveryCode(recoveryCode));

  return safeEqual(hash, record.recoveryCodeHash);
};

export const resetPasswordWithRecovery = async (recoveryCode: string, password: string) => {
  const record = readAuthRecord();

  if (!record || !(await verifyRecoveryCode(recoveryCode, record))) {
    return null;
  }

  const nextRecoveryCode = generateRecoveryCode();
  const passwordSalt = createSalt();
  const recoveryCodeSalt = createSalt();
  const nextRecord: AuthRecord = {
    ...record,
    passwordHash: await sha256Hex(passwordSalt, password),
    passwordSalt,
    recoveryCodeHash: await sha256Hex(recoveryCodeSalt, normalizeRecoveryCode(nextRecoveryCode)),
    recoveryCodeSalt,
    updatedAt: nowIso()
  };

  saveAuthRecord(nextRecord);

  return { record: nextRecord, recoveryCode: nextRecoveryCode };
};

export const rotateRecoveryCode = async () => {
  const record = readAuthRecord();

  if (!record) {
    return null;
  }

  const recoveryCode = generateRecoveryCode();
  const recoveryCodeSalt = createSalt();
  const nextRecord: AuthRecord = {
    ...record,
    recoveryCodeHash: await sha256Hex(recoveryCodeSalt, normalizeRecoveryCode(recoveryCode)),
    recoveryCodeSalt,
    updatedAt: nowIso()
  };

  saveAuthRecord(nextRecord);

  return { record: nextRecord, recoveryCode };
};

const readAuthSession = (): AuthSession | null => {
  const record = readAuthRecord();
  const rawSession = sessionStorage.getItem(AUTH_SESSION_KEY);

  if (!record || !rawSession) {
    return null;
  }

  try {
    const session = JSON.parse(rawSession) as Partial<AuthSession>;

    if (session.unlocked !== true || session.authUpdatedAt !== record.updatedAt) {
      return null;
    }

    return session as AuthSession;
  } catch {
    return null;
  }
};

export const isAuthSessionUnlocked = () => Boolean(readAuthSession());

export const setAuthSessionUnlocked = (record = readAuthRecord()) => {
  if (!record) {
    return;
  }

  const session: AuthSession = {
    unlocked: true,
    unlockedAt: nowIso(),
    authUpdatedAt: record.updatedAt
  };

  sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
};

export const clearAuthSession = () => {
  sessionStorage.removeItem(AUTH_SESSION_KEY);
};
