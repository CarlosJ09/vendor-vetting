/**
 * Tests for the TLS decision, written before it.
 *
 * The rule under test is a security boundary, not a convenience: the only way
 * to reach a remote database without certificate verification must be an
 * explicit opt-in that a reader can grep for.
 */

import { describe, expect, it } from "vitest";

import { caCertFromEnv, describeConnection, sslConfigFor } from "./ssl";

const LOCAL = "postgres://vetting:vetting@localhost:5433/vendor_vetting";
const REMOTE = "postgres://user:pw@aws-0-us-west-2.pooler.supabase.com:5432/postgres";

const CA = "-----BEGIN CERTIFICATE-----\nMIIfake\n-----END CERTIFICATE-----";

/* A base64 body of realistic length — a real certificate runs ~1300 characters. */
const CA_BODY = "MIIDxDCCAqygAwIBAgIUbLxMod62P2kt".repeat(8);
const CA_UNARMORED = `-----BEGIN CERTIFICATE-----\n${CA_BODY}\n-----END CERTIFICATE-----`;

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

/*
 * These exist because of a real deployment that showed "no database
 * connection" and nothing else. The app swallowed the cause, so there was
 * nothing to act on: a wrong host, an env var that never reached the running
 * deployment and a certificate flattened by a dashboard paste all looked
 * identical from outside.
 */
describe("describeConnection", () => {
  it("names the target without ever printing the password", () => {
    const summary = describeConnection(REMOTE, { caCert: CA });

    expect(summary).toContain("host=aws-0-us-west-2.pooler.supabase.com");
    expect(summary).toContain("port=5432");
    expect(summary).toContain("db=postgres");
    expect(summary).not.toContain("pw");
  });

  it("reports that a CA is present without printing it", () => {
    const summary = describeConnection(REMOTE, { caCert: CA });

    expect(summary).toContain("ca=present");
    expect(summary).not.toContain("MIIfake");
  });

  it("distinguishes a missing CA from a supplied one", () => {
    expect(describeConnection(REMOTE, {})).toContain("ca=absent");
  });

  it("flags a certificate that lost its line breaks", () => {
    // What a dashboard's single-line env var field does to a pasted PEM. Node
    // rejects it with an error naming neither the variable nor the cause.
    const flattened = CA.replace(/\n/g, " ");

    expect(describeConnection(REMOTE, { caCert: flattened })).toContain("ca=flattened");
  });

  it("says when verification is switched off", () => {
    expect(describeConnection(REMOTE, { insecure: true })).toContain("ssl=unverified");
  });

  it("says when there is no TLS at all", () => {
    expect(describeConnection(LOCAL, {})).toContain("ssl=off");
  });

  it("does not throw on a URL it cannot parse", () => {
    expect(() => describeConnection("not a url", {})).not.toThrow();
  });
});

/*
 * These come from a deployment that failed with:
 *
 *   Error: DATABASE_CA_CERT points at MIIDxDCCAqygAwIBAgIUbLxMod62P2kt…
 *
 * The variable held the certificate's base64 body with its BEGIN/END lines
 * missing — what you get by selecting the middle of a PEM, or by pasting into
 * a field that strips them. Two things were wrong with that: the message
 * blamed a path, which sent the reader looking for a file that was never
 * meant to exist, and it echoed thirteen hundred characters of base64 into a
 * hosting provider's logs on every single request.
 */
describe("caCertFromEnv", () => {
  it("returns undefined when the variable is unset or empty", () => {
    expect(caCertFromEnv({} as unknown as NodeJS.ProcessEnv)).toBeUndefined();
    expect(caCertFromEnv({ DATABASE_CA_CERT: "" } as unknown as NodeJS.ProcessEnv)).toBeUndefined();
  });

  it("passes an inline PEM straight through", () => {
    expect(caCertFromEnv({ DATABASE_CA_CERT: CA } as unknown as NodeJS.ProcessEnv)).toBe(CA);
  });

  it("names the missing BEGIN/END lines when given a bare certificate body", () => {
    const body = CA_UNARMORED.replace(/-----[A-Z ]+-----/g, "").trim();

    expect(() => caCertFromEnv({ DATABASE_CA_CERT: body } as unknown as NodeJS.ProcessEnv)).toThrow(
      /BEGIN CERTIFICATE/,
    );
    // And must not send the reader hunting for a file.
    expect(() => caCertFromEnv({ DATABASE_CA_CERT: body } as unknown as NodeJS.ProcessEnv)).not.toThrow(
      /points at/,
    );
  });

  it("never echoes the whole value into the error", () => {
    const body = "A".repeat(2000);

    try {
      caCertFromEnv({ DATABASE_CA_CERT: body } as unknown as NodeJS.ProcessEnv);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as Error).message.length).toBeLessThan(400);
    }
  });

  it("still reports an unreadable path as a path", () => {
    expect(() =>
      caCertFromEnv({ DATABASE_CA_CERT: "/no/such/cert.crt" } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/\/no\/such\/cert\.crt/);
  });
});

describe("describeConnection with a mangled certificate", () => {
  it("distinguishes a body stripped of its BEGIN/END lines", () => {
    const body = CA_UNARMORED.replace(/-----[A-Z ]+-----/g, "").trim();

    expect(describeConnection(REMOTE, { caCert: body })).toContain("ca=unarmored");
  });
});
