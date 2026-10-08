import fs from "fs/promises";
import path from "path";

type KeytarLike = {
  findCredentials(service: string): Promise<Array<{ account: string; password: string }>>;
};

const servicePrefix = "social-auto-post";

function splitKeys(raw: string | undefined) {
  return Array.from(
    new Set(
      (raw ?? "")
        .split(/[\r\n,;]+/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}

async function loadKeytar(): Promise<KeytarLike | null> {
  try {
    const dynamicImport = new Function("name", "return import(name)") as (
      name: string,
    ) => Promise<KeytarLike>;
    return await dynamicImport("keytar");
  } catch {
    return null;
  }
}

export type SecretProvider = "gemini" | "groq" | "openai" | "openrouter";

const envVarNames: Record<SecretProvider, string> = {
  gemini: "GEMINI_API_KEYS",
  openai: "OPENAI_API_KEYS",
  openrouter: "OPENROUTER_API_KEYS",
  groq: "GROQ_API_KEYS",
};

/**
 * Session cookie used by the manual model-gateway sync (系统 / 模型管理).
 * It lives next to the provider keys - never inside the repository database.
 */
export const modelGatewayCookieVar = "MODEL_GATEWAY_COOKIE";

function envFilePath() {
  return path.join(process.cwd(), ".env.local");
}

async function readEnvFile() {
  try {
    return await fs.readFile(envFilePath(), "utf-8");
  } catch {
    try {
      return await fs.readFile(path.join(process.cwd(), ".env"), "utf-8");
    } catch {
      return "";
    }
  }
}

function readEnvValue(content: string, varName: string) {
  const line = content
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${varName}=`));
  if (!line) {
    return "";
  }
  return line
    .slice(varName.length + 1)
    .trim()
    .replace(/^["']|["']$/g, "");
}

function setEnvValue(content: string, varName: string, value: string) {
  let found = false;
  const lines = content.split("\n").map((line) => {
    if (line.trim().startsWith(`${varName}=`)) {
      found = true;
      return `${varName}=${value}`;
    }
    return line;
  });

  if (!found) {
    if (lines.length > 0 && lines[lines.length - 1].trim() !== "") {
      lines.push("");
    }
    lines.push(`${varName}=${value}`);
  }

  return lines.join("\n");
}

function removeEnvValue(content: string, varName: string) {
  const lines = content.split("\n").filter((line) => !line.trim().startsWith(`${varName}=`));
  while (lines.length > 1 && lines[lines.length - 1].trim() === "" && lines[lines.length - 2].trim() === "") {
    lines.pop();
  }
  return lines.join("\n");
}

async function writeEnvVar(varName: string, value: string) {
  await fs.writeFile(envFilePath(), setEnvValue(await readEnvFile(), varName, value), "utf-8");
  process.env[varName] = value;
}

async function clearEnvVar(varName: string) {
  await fs.writeFile(envFilePath(), removeEnvValue(await readEnvFile(), varName), "utf-8");
  delete process.env[varName];
}

export async function readProviderKeys(provider: SecretProvider) {
  const keytar = await loadKeytar();
  if (keytar) {
    const credentials = await keytar.findCredentials(`${servicePrefix}:${provider}`);
    const stored = credentials.map((item) => item.password).filter(Boolean);
    if (stored.length > 0) {
      return Array.from(new Set(stored));
    }
  }

  if (provider === "gemini") return splitKeys(process.env.GEMINI_API_KEYS);
  if (provider === "openai") return splitKeys(process.env.OPENAI_API_KEYS ?? process.env.OPENAI_API_KEY);
  if (provider === "openrouter") return splitKeys(process.env.OPENROUTER_API_KEYS ?? process.env.OPENROUTER_API_KEY);
  return splitKeys(process.env.GROQ_API_KEYS);
}

export function maskKey(key: string) {
  const cleaned = key.trim();
  if (!cleaned) {
    return "";
  }
  return `${"*".repeat(Math.max(0, cleaned.length - 4))}${cleaned.slice(-4)}`;
}

export async function writeProviderKey(provider: SecretProvider, key: string) {
  await writeEnvVar(envVarNames[provider], key);
}

/**
 * Reads a variable from the process environment or, failing that, from `.env.local`
 * (the file `writeEnvVar` below writes to). Used by the credential store so keys
 * configured through the legacy settings form keep working.
 */
export async function readAppEnvValue(varName: string) {
  const fromEnv = process.env[varName]?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  return readEnvValue(await readEnvFile(), varName);
}

/** Reads the stored model-gateway session cookie (env first, then `.env.local`). */
export async function readModelGatewayCookie() {
  const fromEnv = process.env[modelGatewayCookieVar]?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  return readEnvValue(await readEnvFile(), modelGatewayCookieVar);
}

/**
 * Persists the model-gateway session cookie locally so manual syncs keep working
 * without pasting it again. Masked placeholders (`****1234`) are never stored.
 */
export async function writeModelGatewayCookie(cookie: string) {
  const value = cookie.trim();
  if (!value || value.includes("*")) {
    return false;
  }
  await writeEnvVar(modelGatewayCookieVar, value);
  return true;
}

/** Removes the stored gateway cookie (used by the reset action). */
export async function clearModelGatewayCookie() {
  await clearEnvVar(modelGatewayCookieVar);
}

