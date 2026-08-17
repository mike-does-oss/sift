import { describe, expect, it } from "vitest";
import { generateInboundToken, INBOUND_TOKEN_LENGTH } from "@/lib/inbound-token";

// §INBOX: the token IS the credential for a schedule's email-in address —
// pin its shape (email-local-part safe) and that it's actually random.

describe("generateInboundToken", () => {
  it("is 16 lowercase base32 chars (email-local-part safe)", () => {
    for (let i = 0; i < 50; i++) {
      const token = generateInboundToken();
      expect(token).toHaveLength(INBOUND_TOKEN_LENGTH);
      expect(token).toMatch(/^[a-z2-7]{16}$/);
    }
  });

  it("does not repeat", () => {
    const tokens = new Set(Array.from({ length: 200 }, generateInboundToken));
    expect(tokens.size).toBe(200);
  });
});
