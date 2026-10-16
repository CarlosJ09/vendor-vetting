/**
 * Tests for the TLS decision, written before it.
 *
 * The rule under test is a security boundary, not a convenience: the only way
 * to reach a remote database without certificate verification must be an
 * explicit opt-in that a reader can grep for.
 */

import { describe, expect, it } from "vitest";

import { sslConfigFor } from "./ssl";

const LOCAL = "postgres://vetting:vetting@localhost:5433/vendor_vetting";
const REMOTE = "postgres://user:pw@aws-0-us-west-2.pooler.supabase.com:5432/postgres";

const CA = "-----BEGIN CERTIFICATE-----\nMIIfake\n-----END CERTIFICATE-----";

describe("sslConfigFor", () => {
  it("uses no TLS for a local database", () => {
    // Docker on loopback. Demanding TLS here would make `pnpm test` need certs.
    expect(sslConfigFor(LOCAL, {})).toBe(false);
  });

  it("treats 127.0.0.1 as local too", () => {
    expect(sslConfigFor("postgres://u:p@127.0.0.1:5433/db", {})).toBe(false);
  });

  it("verifies against a supplied CA for a remote database", () => {
    const config = sslConfigFor(REMOTE, { caCert: CA });

    expect(config).toEqual({ ca: CA, rejectUnauthorized: true });
  });

  it("still verifies when no CA is supplied, so a remote connection fails loudly", () => {
    /*
     * Supabase signs with its own root, which is not in the system trust store,
     * so this configuration throws "self-signed certificate in certificate
     * chain". That is the correct outcome: a connection that cannot be
     * authenticated should fail, not quietly downgrade.
     */
    expect(sslConfigFor(REMOTE, {})).toEqual({ rejectUnauthorized: true });
  });

  it("skips verification only when explicitly opted in", () => {
    expect(sslConfigFor(REMOTE, { insecure: true })).toEqual({ rejectUnauthorized: false });
  });

  it("prefers a supplied CA over the insecure opt-in", () => {
    // If someone leaves the opt-in set and later supplies a certificate, the
    // certificate should win rather than the leftover flag.
    expect(sslConfigFor(REMOTE, { caCert: CA, insecure: true })).toEqual({
      ca: CA,
      rejectUnauthorized: true,
    });
  });

  it("never skips verification for a local connection", () => {
    expect(sslConfigFor(LOCAL, { insecure: true })).toBe(false);
  });
});
