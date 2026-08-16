import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Hosted cron entrypoints (§SaaS-1 T3): 404 on the local profile (local runs
// the worker on the instrumentation tick), bearer-gated on hosted. Neither
// route may touch the jobs machinery before those gates pass — the handlers
// import @/lib/jobs lazily, which is what makes these tests runnable without
// a database on either profile.

// Literal import specifiers so vite can resolve the alias statically; the
// import must stay dynamic so each test's stubbed profile env applies.
const ROUTES = [
  { name: "/api/jobs/process", load: () => import("@/app/api/jobs/process/route") },
  { name: "/api/schedules/run", load: () => import("@/app/api/schedules/run/route") },
] as const;

function request(url: string, auth?: string): NextRequest {
  return new NextRequest(`http://localhost:4216${url}`, {
    headers: auth === undefined ? {} : { authorization: auth },
  });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

for (const route of ROUTES) {
  describe(`${route.name} auth`, () => {
    it("returns 404 on the local profile even with a valid bearer", async () => {
      vi.stubEnv("SIFT_PROFILE", "");
      vi.stubEnv("CRON_SECRET", "shh");
      const { GET } = await route.load();
      const res = await GET(request(route.name, "Bearer shh"));
      expect(res.status).toBe(404);
    });

    it("returns 401 on hosted without the bearer", async () => {
      vi.stubEnv("SIFT_PROFILE", "hosted");
      vi.stubEnv("CRON_SECRET", "shh");
      const { GET, POST } = await route.load();
      expect((await GET(request(route.name))).status).toBe(401);
      expect((await POST(request(route.name))).status).toBe(401);
    });

    it("returns 401 on hosted with a wrong bearer", async () => {
      vi.stubEnv("SIFT_PROFILE", "hosted");
      vi.stubEnv("CRON_SECRET", "shh");
      const { GET } = await route.load();
      expect((await GET(request(route.name, "Bearer wrong"))).status).toBe(401);
      expect((await GET(request(route.name, "shh"))).status).toBe(401);
    });

    it("returns 401 on hosted when CRON_SECRET is unset (no 'Bearer undefined' hole)", async () => {
      vi.stubEnv("SIFT_PROFILE", "hosted");
      vi.stubEnv("CRON_SECRET", "");
      const { GET } = await route.load();
      expect((await GET(request(route.name, "Bearer undefined"))).status).toBe(401);
      expect((await GET(request(route.name, "Bearer "))).status).toBe(401);
    });
  });
}
