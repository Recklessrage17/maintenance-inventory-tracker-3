import crypto from "node:crypto";
import { getDatabase } from "./db.js";

const WEBSITE_AUTH_KEY = "website_auth";
const PASSWORD_MIN_LENGTH = 6;
const SCRYPT_KEY_LENGTH = 64;

type WebsiteAuthRecord = {
  algorithm: "scrypt";
  createdAt: string;
  hash: string;
  keyLength: number;
  recoveryEmail: string;
  salt: string;
  updatedAt: string;
};

export class WebsiteAuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
  }
}

function nowIso() {
  return new Date().toISOString();
}

function hashPassword(password: string, salt: string) {
  return crypto.scryptSync(password, salt, SCRYPT_KEY_LENGTH).toString("hex");
}

function parseWebsiteAuthRecord(value: string): WebsiteAuthRecord | null {
  try {
    const record = JSON.parse(value) as Partial<WebsiteAuthRecord>;

    if (
      record.algorithm !== "scrypt" ||
      typeof record.salt !== "string" ||
      typeof record.hash !== "string" ||
      typeof record.createdAt !== "string" ||
      typeof record.updatedAt !== "string"
    ) {
      return null;
    }

    return {
      algorithm: "scrypt",
      createdAt: record.createdAt,
      hash: record.hash,
      keyLength: typeof record.keyLength === "number" ? record.keyLength : SCRYPT_KEY_LENGTH,
      recoveryEmail: typeof record.recoveryEmail === "string" ? record.recoveryEmail : "",
      salt: record.salt,
      updatedAt: record.updatedAt
    };
  } catch {
    return null;
  }
}

export function readWebsiteAuthRecord() {
  const row = getDatabase()
    .prepare("SELECT value_json FROM app_settings WHERE key = ? LIMIT 1")
    .get(WEBSITE_AUTH_KEY) as { value_json: string } | undefined;

  return row ? parseWebsiteAuthRecord(row.value_json) : null;
}

export function getWebsiteAuthStatus() {
  return { configured: Boolean(readWebsiteAuthRecord()) };
}

export function setupWebsiteAuth(password: string, recoveryEmail = "") {
  const cleanPassword = password;

  if (cleanPassword.length < PASSWORD_MIN_LENGTH) {
    throw new WebsiteAuthError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`, 400);
  }

  if (readWebsiteAuthRecord()) {
    throw new WebsiteAuthError("Website password is already configured.", 409);
  }

  const timestamp = nowIso();
  const salt = crypto.randomBytes(16).toString("hex");
  const record: WebsiteAuthRecord = {
    algorithm: "scrypt",
    createdAt: timestamp,
    hash: hashPassword(cleanPassword, salt),
    keyLength: SCRYPT_KEY_LENGTH,
    recoveryEmail: recoveryEmail.trim(),
    salt,
    updatedAt: timestamp
  };

  getDatabase()
    .prepare(
      `INSERT INTO app_settings (key, value_json, description, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
    )
    .run(WEBSITE_AUTH_KEY, JSON.stringify(record), "Website mode backend authentication", timestamp);

  return { configured: true };
}

export function verifyWebsiteAuthPassword(password: string) {
  const record = readWebsiteAuthRecord();

  if (!record) {
    throw new WebsiteAuthError("Website password has not been configured.", 404);
  }

  const expectedHash = Buffer.from(record.hash, "hex");
  const candidateHash = Buffer.from(hashPassword(password, record.salt), "hex");

  if (expectedHash.length !== candidateHash.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedHash, candidateHash);
}
