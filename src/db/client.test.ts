/**
 * Tests for the reachability probe's error path.
 *
 * Narrow on purpose: the connection itself is covered by persist.test.ts
 * against a real Postgres. What is tested here is what happens when the
 * configuration is wrong, which is the case that reaches a deployed app.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { closeDb, isReachable } from "./client";

const REMOTE = "postgres://user:pw@aws-0-us-west-2.pooler.supabase.com:6543/postgres";

afterEach(async () => {
  await closeDb();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("isReachable", () => {
  it("reports a certificate it cannot use instead of throwing", async () => {
    /*
     * The regression this exists for: the error path called caCertFromEnv()
     * a second time, which threw again — out of the probe, past the caller,
     * and into a 500 that said nothing. A probe that cannot answer "no" is
     * worse than no probe.
     */
    vi.stubEnv("DATABASE_URL", REMOTE);
    vi.stubEnv("DATABASE_CA_CERT", "MIIDxDCCAqygAwIBAgIUbLxMod62P2kt".repeat(8));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(isReachable()).resolves.toBe(false);

    expect(logged).toHaveBeenCalledOnce();
    expect(logged.mock.calls[0]?.[0]).toContain("ca=unarmored");
  });

  it("stays quiet about a local database that is simply not running", async () => {
    // "No Docker" is the documented case the integration tests skip on. It
    // does not need a stack trace on every test run.
    vi.stubEnv("DATABASE_URL", "postgres://u:p@localhost:59999/vendor_vetting");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(isReachable()).resolves.toBe(false);

    expect(logged).not.toHaveBeenCalled();
  });
});
