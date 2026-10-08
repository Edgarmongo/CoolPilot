import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { dataRoot } from "@/lib/paths";
import { maskKey, readAppEnvValue } from "@/lib/secrets";

/**
 * Local credential store for the AI runtime.
 *
 * The database only ever stores a `credential_ref` such as `credential://qwen/default`;
 * the secret itself lives in `.env.local` (written by the legacy settings form) or in
 * the encrypted vault next to the app data. Two backends exist today:
 *
 *   - `file-encrypted` - AES-256-GCM blob inside `<data>/credential-vault.json`, keyed
 *     by a random 32 byte key in `<data>/credential-vault.key` (0600). This protects
 *     the key from accidental sharing (backups, screenshots, support bundles) but not
 *     from a local attacker who can read the app data directory.
 *   - `env-only`       - the operator put the key in the environment; the app only reads.
 *
 * An `os-encrypted` backend (Windows DPAPI / macOS Keychain) is the planned third one.
 * It is not implemented, and the UI says so instead of pretending otherwise.
 */
export const credentialBackends = ["file-encrypted", "env-only"] as const;

export type CredentialBackend = (typeof credentialBackends)[number];

export const osSecureStorage = {
  available: false,
  reason: "No OS keychain backend is installed (keytar is not a dependency).",
} as const;

const refPrefix = "credential://";
const vaultFileName = "credential-vault.json";
const vaultKeyFileName = "credential-vault.key";
const vaultVersion = 1;

export type CredentialRef = {
  slug: string;
  name: string;
};

export type CredentialStatus = {
  ref: string;
  slug: string;
  name: string;
  backend: CredentialBackend;
  configured: boolean;
  /** Masked last four of the first key. */
  masked: string;
  /** How many keys the credential holds; rotation uses all of them. */
  keyCount: number;
  /** One masked entry per key, in rotation order. */
  maskedKeys: string[];
  source: "vault" | "env" | "none";
};

type VaultEntry = {
  iv: string;
  tag: string;
  data: string;
  hint: string;
  updatedAt: number;
};

type VaultFile = {
  version: number;
  entries: Record<string, VaultEntry>;
};

function vaultPath() {
  return path.join(dataRoot(), vaultFileName);
}

function vaultKeyPath() {
  return path.join(dataRoot(), vaultKeyFileName);
}

/** Normalizes an arbitrary provider slug to the `[a-z0-9_-]` alphabet used in refs. */
export function normalizeCredentialSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function credentialRefFor(providerId: string, name = "default") {
  const slug = normalizeCredentialSlug(providerId);
  const entry = normalizeCredentialSlug(name) || "default";
  return `${refPrefix}${slug}/${entry}`;
}

export function parseCredentialRef(ref: string | null | undefined): CredentialRef | null {
  if (!ref || !ref.startsWith(refPrefix)) {
    return null;
  }
  const [slug, name = "default"] = ref.slice(refPrefix.length).split("/");
  const normalizedSlug = normalizeCredentialSlug(slug ?? "");
  if (!normalizedSlug) {
    return null;
  }
  return { slug: normalizedSlug, name: normalizeCredentialSlug(name) || "default" };
}

/** Environment variable names searched, in order, for a credential slug. */
export function credentialEnvVarNames(slug: string) {
  const upper = normalizeCredentialSlug(slug).toUpperCase().replace(/-/g, "_");
  return [`${upper}_API_KEYS`, `${upper}_API_KEY`];
}

/**
 * One credential can hold several keys - a provider rate-limits per key, not per account.
 * Pasted values are separated by commas, semicolons or newlines, and duplicates collapse
 * so a key is never counted (and rotated) twice.
 */
export function splitCredentialKeys(raw: string | null | undefined): string[] {
  return Array.from(
    new Set(
      (raw ?? "")
        .split(/[\r\n,;]+/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}

/** `****1234` style placeholders echoed by the UI are never treated as a key. */
export function isMaskedPlaceholder(value: string) {
  return value.includes("*");
}

/** Rotation order of one credential: vault first, then the environment fallback. */
export async function readCredentialKeys(ref: string | null | undefined): Promise<string[]> {
  const entry = parseCredentialRef(ref);
  if (!entry) {
    return [];
  }
  const fromVault = splitCredentialKeys(await readVaultSecret(entry));
  if (fromVault.length > 0) {
    return fromVault;
  }
  for (const varName of credentialEnvVarNames(entry.slug)) {
    const fromEnv = splitCredentialKeys(await readAppEnvValue(varName));
    if (fromEnv.length > 0) {
      return fromEnv;
    }
  }
  return [];
}

function vaultKey(entry: CredentialRef) {
  return `${entry.slug}/${entry.name}`;
}

async function readVault(): Promise<VaultFile> {
  try {
    const raw = await fs.readFile(vaultPath(), "utf-8");
    const parsed = JSON.parse(raw) as VaultFile;
    if (!parsed || typeof parsed !== "object" || !parsed.entries) {
      return { version: vaultVersion, entries: {} };
    }
    return { version: vaultVersion, entries: parsed.entries };
  } catch {
    return { version: vaultVersion, entries: {} };
  }
}

async function writeVault(vault: VaultFile) {
  await fs.writeFile(vaultPath(), `${JSON.stringify(vault, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
}

async function loadVaultKey() {
  try {
    const raw = await fs.readFile(vaultKeyPath(), "utf-8");
    const buffer = Buffer.from(raw.trim(), "base64");
    if (buffer.length === 32) {
      return buffer;
    }
  } catch {
    // First run: fall through and create one.
  }
  const created = randomBytes(32);
  await fs.writeFile(vaultKeyPath(), `${created.toString("base64")}\n`, { encoding: "utf-8", mode: 0o600 });
  return created;
}

function encryptSecret(plaintext: string, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64"),
  };
}

function decryptSecret(entry: VaultEntry, key: Buffer) {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(entry.iv, "base64"));
  decipher.setAuthTag(Buffer.from(entry.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(entry.data, "base64")), decipher.final()]).toString("utf-8");
}

async function readVaultSecret(entry: CredentialRef) {
  const vault = await readVault();
  const stored = vault.entries[vaultKey(entry)];
  if (!stored) {
    return null;
  }
  try {
    return decryptSecret(stored, await loadVaultKey());
  } catch {
    // Vault key rotated or blob damaged: treat as "not configured" instead of throwing,
    // so one broken entry cannot take the whole runtime down.
    return null;
  }
}

/**
 * Resolves the first usable secret for a ref, or null when nothing is configured.
 * The value is meant to live inside a single request; callers must never store it,
 * log it or put it into an API response. Rotation-aware callers use
 * `readCredentialKeys` and the key pool instead.
 */
export async function readCredential(ref: string | null | undefined): Promise<string | null> {
  return (await readCredentialKeys(ref))[0] ?? null;
}

export async function describeCredential(ref: string | null | undefined): Promise<CredentialStatus> {
  const entry = parseCredentialRef(ref);
  const empty: CredentialStatus = {
    ref: ref ?? "",
    slug: entry?.slug ?? "",
    name: entry?.name ?? "",
    backend: "env-only",
    configured: false,
    masked: "",
    keyCount: 0,
    maskedKeys: [],
    source: "none",
  };
  if (!entry) {
    return empty;
  }
  const fromVault = splitCredentialKeys(await readVaultSecret(entry));
  if (fromVault.length > 0) {
    return {
      ...empty,
      backend: "file-encrypted",
      configured: true,
      masked: maskKey(fromVault[0]),
      keyCount: fromVault.length,
      maskedKeys: fromVault.map(maskKey),
      source: "vault",
    };
  }
  const fromEnv = await readCredentialKeys(ref);
  if (fromEnv.length > 0) {
    return {
      ...empty,
      backend: "env-only",
      configured: true,
      masked: maskKey(fromEnv[0]),
      keyCount: fromEnv.length,
      maskedKeys: fromEnv.map(maskKey),
      source: "env",
    };
  }
  return empty;
}

/**
 * Stores one or more secrets in the encrypted vault. Masked placeholders echoed back by
 * the UI (`****1234`) are ignored, and an empty string clears the stored entry.
 * Multiple keys are stored newline-separated inside the same encrypted blob.
 */
export async function writeCredential(ref: string, secret: string): Promise<CredentialStatus> {
  const entry = parseCredentialRef(ref);
  if (!entry) {
    return describeCredential(ref);
  }
  const value = secret.trim();
  if (isMaskedPlaceholder(value) && splitCredentialKeys(value).every(isMaskedPlaceholder)) {
    return describeCredential(ref);
  }
  const keys = splitCredentialKeys(value).filter((key) => !isMaskedPlaceholder(key));

  const vault = await readVault();
  const key = vaultKey(entry);
  if (keys.length === 0) {
    delete vault.entries[key];
    await writeVault(vault);
    return describeCredential(ref);
  }

  const payload = keys.join("\n");
  vault.entries[key] = {
    ...encryptSecret(payload, await loadVaultKey()),
    hint: keys.map(maskKey).join(", ").slice(0, 200),
    updatedAt: Date.now(),
  };
  await writeVault(vault);
  return describeCredential(ref);
}

/** Removes the vault entry for a ref. Environment credentials are left untouched. */
export async function clearCredential(ref: string) {
  const entry = parseCredentialRef(ref);
  if (!entry) {
    return;
  }
  const vault = await readVault();
  delete vault.entries[vaultKey(entry)];
  await writeVault(vault);
}
