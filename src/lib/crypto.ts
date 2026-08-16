import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// Hosted-profile key vault primitives (§SaaS-1 T5, donor: extracto-app,
// verbatim). BYO Anthropic keys are encrypted at rest with AES-256-GCM
// (random 12-byte IV per encryption, auth tag verified on decrypt) and stored
// as a hex triple `iv:tag:ciphertext`. `ENCRYPTION_SECRET` must be 64 hex
// chars (32 bytes) and is only read at call time — the local profile never
// calls into this module.

function key(): Buffer {
  const hex = process.env.ENCRYPTION_SECRET;
  if (!hex || hex.length !== 64) {
    throw new Error("ENCRYPTION_SECRET must be 64 hex chars (32 bytes)");
  }
  return Buffer.from(hex, "hex");
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${ct.toString("hex")}`;
}

export function decryptSecret(payload: string): string {
  const [ivHex, tagHex, ctHex] = payload.split(":");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(ctHex, "hex")), decipher.final()]).toString("utf8");
}

export function maskKey(k: string): string {
  const prefix = k.startsWith("sk-ant") ? "sk-ant-" : k.slice(0, 4);
  return `${prefix}…${k.slice(-4)}`;
}
