/**
 * Secure secret storage for NyteShift.
 *
 * Secrets are encrypted with AES-256-GCM.  The encryption key lives in a
 * separate file from the encrypted data so a leak of the secrets file alone
 * is computationally insufficient to decrypt the contents.
 *
 * Files (both chmod 0600 on POSIX; user-private by home-dir ACL on Windows):
 *   ~/.nyteshift/.keyfile      — 64 hex chars (32-byte AES-256 key)
 *   ~/.nyteshift/secrets.json  — JSON array of encrypted { name, iv, tag, ct }
 *
 * Usage:
 *   await setSecret("provider:openai:apiKey", "sk-...");
 *   const key = await getSecret("provider:openai:apiKey");  // → "sk-..." | undefined
 *   await deleteSecret("provider:openai:apiKey");
 *   const names = await listSecretKeys();
 */

import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { readFile, writeFile, chmod, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { nyteShiftHome } from "../../utils/index.js";

// ── Constants ──────────────────────────────────────────────────────────

const ALG = "aes-256-gcm";
const IV_LEN = 12;  // 96-bit IV – recommended for AES-GCM

// ── Known secret names for built-in providers/integrations ────────────

/** All first-party secret names so callers can reference them consistently. */
export const SECRET_KEYS = {
  providerApiKey: (providerId: string) => `provider:${providerId}:apiKey` as const,
  OPENAI_API_KEY:      "provider:openai:apiKey",
  ANTHROPIC_API_KEY:   "provider:anthropic:apiKey",
  OPENROUTER_API_KEY:  "provider:openrouter:apiKey",
  DISCORD_BOT_TOKEN:   "discord:global:botToken",
  /** Bot token stored per-trigger (replaces the plaintext discordBotToken field). */
  discordTriggerBotToken: (triggerId: string) => `trigger:${triggerId}:discordBotToken` as const,
} as const;

/**
 * Config-JSON paths that map to secret store keys, used during migration.
 * Each entry describes where the secret lived in config.json and where it
 * should live in the secret store.
 */
export const CONFIG_SECRET_PATHS: ReadonlyArray<{
  configPath: string;
  secretKey: string;
}> = [
  { configPath: "providers.openai.apiKey",     secretKey: SECRET_KEYS.OPENAI_API_KEY },
  { configPath: "providers.anthropic.apiKey",  secretKey: SECRET_KEYS.ANTHROPIC_API_KEY },
  { configPath: "providers.openrouter.apiKey", secretKey: SECRET_KEYS.OPENROUTER_API_KEY },
  { configPath: "globalDiscord.botToken",      secretKey: SECRET_KEYS.DISCORD_BOT_TOKEN },
];

/**
 * Field names that are treated as secrets inside any `toolConfig` or
 * `skillConfig` entry.  Used by the generic toolConfig migration and strip
 * helpers so that plaintext values written directly into config.json (e.g.
 * via manual editing) are migrated to the secret store on first read.
 *
 * Note: well-behaved tools use `writeSkillToolConfig` which already routes
 * `type:"secret"` fields to the secret store automatically.  This list is a
 * belt-and-suspenders guard for values that bypassed that path.
 */
export const TOOL_CONFIG_SECRET_FIELD_NAMES: ReadonlySet<string> = new Set([
  "apiKey",
  "token",
  "clientSecret",
  "refreshToken",
  "accessToken",
  "botToken",
  "apiToken",
  "bearerToken",
  "secret",
  "password",
  "privateKey",
]);

// ── File paths ─────────────────────────────────────────────────────────

function keyfilePath(): string {
  return join(nyteShiftHome(), ".keyfile");
}

function secretsPath(): string {
  return join(nyteShiftHome(), "secrets.json");
}

// ── Key management ─────────────────────────────────────────────────────

let _keyCache: Buffer | null = null;

export function clearKeyCache(): void {
  _keyCache = null;
}

async function ensureKey(): Promise<Buffer> {
  if (_keyCache) return _keyCache;

  const kp = keyfilePath();

  if (existsSync(kp)) {
    const raw = await readFile(kp, "utf-8");
    const hex = raw.trim();

    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
      throw new Error(
        "[secretStore] Keyfile is corrupted (expected 64 hex chars).\n" +
        `  File: ${kp}\n` +
        "  To regenerate: delete the keyfile AND secrets.json, then re-enter your API keys.\n" +
        "  WARNING: regenerating loses all stored secrets."
      );
    }

    _keyCache = Buffer.from(hex, "hex");
    return _keyCache;
  }

  // ── First-run: generate a new random key ──────────────────────────
  const key = randomBytes(32);

  // Ensure directory exists
  await mkdir(dirname(kp), { recursive: true });

  // Write with restrictive permissions from the start (mode 0600)
  await writeFile(kp, key.toString("hex") + "\n", {
    encoding: "utf-8",
    mode: 0o600,
  });

  // On POSIX, chmod to 0600 even if the process umask loosened it
  if (process.platform !== "win32") {
    try { await chmod(kp, 0o600); } catch { /* best-effort */ }
  }

  _keyCache = key;
  return _keyCache;
}

// ── Secrets file I/O ───────────────────────────────────────────────────

type EncryptedEntry = { iv: string; tag: string; ct: string };
type SecretsStore  = Record<string, EncryptedEntry>;

async function readStore(): Promise<SecretsStore> {
  const sp = secretsPath();
  if (!existsSync(sp)) return {};
  try {
    const raw = await readFile(sp, "utf-8");
    const parsed = JSON.parse(raw.trim());
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as SecretsStore;
    }
    return {};
  } catch {
    // Corrupted / empty — start fresh (log so the user can investigate)
    console.warn("[secretStore] secrets.json could not be parsed; treating as empty.");
    return {};
  }
}

async function writeStore(store: SecretsStore): Promise<void> {
  const sp = secretsPath();
  await mkdir(dirname(sp), { recursive: true });

  await writeFile(sp, JSON.stringify(store, null, 2) + "\n", {
    encoding: "utf-8",
    mode: 0o600,
  });

  // Tighten permissions on POSIX
  if (process.platform !== "win32") {
    try { await chmod(sp, 0o600); } catch { /* best-effort */ }
  }
}

// ── Crypto helpers ─────────────────────────────────────────────────────

function encryptValue(key: Buffer, plaintext: string): EncryptedEntry {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv:  iv.toString("hex"),
    tag: tag.toString("hex"),
    ct:  ct.toString("hex"),
  };
}

function decryptValue(key: Buffer, entry: EncryptedEntry): string {
  const iv  = Buffer.from(entry.iv,  "hex");
  const tag = Buffer.from(entry.tag, "hex");
  const ct  = Buffer.from(entry.ct,  "hex");

  const decipher = createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf-8");
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Store (or overwrite) a secret under the given name.
 * Each value is encrypted with a fresh random IV.
 */
export async function setSecret(name: string, value: string): Promise<void> {
  if (!name) throw new TypeError("[secretStore] Secret name must be a non-empty string.");
  const key   = await ensureKey();
  const store = await readStore();
  store[name] = encryptValue(key, value);
  await writeStore(store);
}

/**
 * Retrieve a secret.
 * Returns `undefined` if the name is not stored or if decryption fails
 * (e.g. the keyfile has been regenerated).
 */
export async function getSecret(name: string): Promise<string | undefined> {
  if (!name) return undefined;
  const store = await readStore();
  const entry = store[name];
  if (!entry) return undefined;

  try {
    const key = await ensureKey();
    return decryptValue(key, entry);
  } catch {
    // Auth-tag mismatch or key mismatch — treat as absent
    return undefined;
  }
}

/**
 * Delete a stored secret.  No-op if the name does not exist.
 */
export async function deleteSecret(name: string): Promise<void> {
  const store = await readStore();
  if (!(name in store)) return;
  delete store[name];
  await writeStore(store);
}

/**
 * Return the names of all stored secrets (never the values).
 */
export async function listSecretKeys(): Promise<string[]> {
  const store = await readStore();
  return Object.keys(store);
}

/**
 * Compute a canonical secret name for a skill/tool field.
 * Examples:
 *   secretNameFor("tool", "acme/stripe", "clientSecret") -> "tool:acme/stripe:clientSecret"
 *   secretNameFor("skill", "foo/bar", "apiKey", "agent007") -> "agent:agent007:skill:foo/bar:apiKey"
 */
export function secretNameFor(
  kind: "skill" | "tool" | "channel",
  qualifiedName: string,
  key: string,
  agentName?: string,
): string {
  const base = `${kind}:${qualifiedName}:${key}`;
  return agentName ? `agent:${agentName}:${base}` : base;
}

// ── Migration helpers ──────────────────────────────────────────────────

/**
 * Scan a raw config object for known secret fields, move them into the
 * secret store, and return a sanitized copy of the config (without those
 * fields).
 *
 * Only migrates non-empty string values.  Already-absent fields are
 * ignored (they were either never set or already migrated).
 *
 * @returns `{ sanitized, migrated }` — `migrated` lists the secret keys
 *   that were moved (useful for user-facing confirmation messages).
 */
export async function migrateSecretsFromConfig(
  config: Record<string, unknown>,
): Promise<{ sanitized: Record<string, unknown>; migrated: string[] }> {
  const sanitized = deepClone(config);
  const migrated: string[] = [];

  // ── Known top-level provider / discord secrets ─────────────────────
  for (const { configPath, secretKey } of CONFIG_SECRET_PATHS) {
    const value = getNestedValue(sanitized, configPath);
    if (typeof value === "string" && value.trim() !== "") {
      await setSecret(secretKey, value.trim());
      deleteNestedValue(sanitized, configPath);
      migrated.push(secretKey);
    }
  }

  // ── toolConfig / skillConfig generic secret fields ─────────────────
  // Migrate any field whose name is in TOOL_CONFIG_SECRET_FIELD_NAMES that
  // has been stored in plaintext inside toolConfig or skillConfig entries.
  for (const ns of ["toolConfig", "skillConfig"] as const) {
    const bucket = (sanitized as Record<string, unknown>)[ns];
    if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) continue;

    for (const [qualifiedName, toolCfg] of Object.entries(bucket as Record<string, unknown>)) {
      if (!toolCfg || typeof toolCfg !== "object" || Array.isArray(toolCfg)) continue;
      const kind = ns === "toolConfig" ? "tool" : "skill";

      for (const [field, value] of Object.entries(toolCfg as Record<string, unknown>)) {
        if (!TOOL_CONFIG_SECRET_FIELD_NAMES.has(field)) continue;
        if (typeof value !== "string" || value.trim() === "") continue;

        const secretKey = secretNameFor(kind as "tool" | "skill", qualifiedName, field);
        await setSecret(secretKey, value.trim());
        delete (toolCfg as Record<string, unknown>)[field];
        migrated.push(secretKey);
      }
    }
  }

  return { sanitized, migrated };
}

/**
 * Remove all known secret paths from a config object without migrating
 * them.  Use this as a safety net when writing config to disk to ensure
 * secrets never accidentally end up in the plaintext JSON.
 */
export function stripSecretsFromConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized = deepClone(config);

  // ── Known top-level paths ─────────────────────────────────────────
  for (const { configPath } of CONFIG_SECRET_PATHS) {
    deleteNestedValue(sanitized, configPath);
  }

  // ── toolConfig / skillConfig generic strip ────────────────────────
  for (const ns of ["toolConfig", "skillConfig"]) {
    const bucket = (sanitized as Record<string, unknown>)[ns];
    if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) continue;

    for (const toolCfg of Object.values(bucket as Record<string, unknown>)) {
      if (!toolCfg || typeof toolCfg !== "object" || Array.isArray(toolCfg)) continue;
      for (const field of TOOL_CONFIG_SECRET_FIELD_NAMES) {
        delete (toolCfg as Record<string, unknown>)[field];
      }
    }
  }

  return sanitized;
}

// ── Internal helpers ───────────────────────────────────────────────────

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce((cur: unknown, part) => {
    if (cur !== null && typeof cur === "object") {
      return (cur as Record<string, unknown>)[part];
    }
    return undefined;
  }, obj as unknown);
}

function deleteNestedValue(obj: Record<string, unknown>, path: string): void {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur === null || typeof cur !== "object") return;
    cur = (cur as Record<string, unknown>)[parts[i]];
  }
  if (cur !== null && typeof cur === "object") {
    delete (cur as Record<string, unknown>)[parts[parts.length - 1]];
  }
}
