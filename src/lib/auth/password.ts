import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT_KEYLEN = 64;

export function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(plain, salt, SCRYPT_KEYLEN).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") {
    return false;
  }
  const [, salt, hexHash] = parts;
  if (!salt || !hexHash) return false;
  try {
    const expected = Buffer.from(hexHash, "hex");
    const actual = scryptSync(plain, salt, expected.length);
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
