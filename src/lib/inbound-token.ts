import { randomBytes } from "crypto";

// §INBOX: alphabet for schedule email-in tokens. Lowercase base32 (RFC 4648
// letters+digits, no padding chars) — every character is legal in an email
// local part and survives case-folding mail servers unchanged.
const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
export const INBOUND_TOKEN_LENGTH = 16;

/**
 * Generates the local part of a schedule's inbound email address
 * (`<token>@RESEND_INBOUND_DOMAIN`). 16 chars × 5 bits = 80 bits of CSPRNG
 * entropy — the address is the only credential an outside sender needs, so
 * it must be unguessable. Uniqueness is enforced by the DB unique constraint
 * (collision odds at 80 bits are negligible).
 */
export function generateInboundToken(): string {
  const bytes = randomBytes(INBOUND_TOKEN_LENGTH);
  let out = "";
  for (let i = 0; i < INBOUND_TOKEN_LENGTH; i++) {
    out += ALPHABET[bytes[i] % 32];
  }
  return out;
}
