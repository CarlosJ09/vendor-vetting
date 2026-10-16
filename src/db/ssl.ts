/**
 * Whether and how to use TLS for a database connection.
 *
 * ## Why this is not just `ssl: true`
 *
 * Supabase signs its pooler certificates with a private root — "Supabase Root
 * 2021 CA" — which is not in Node's trust store. `ssl: true` therefore fails
 * with "self-signed certificate in certificate chain", and the tempting fix is
 * `rejectUnauthorized: false`, which encrypts the connection without
 * authenticating the other end. That is not a smaller version of TLS; it is
 * TLS with the part that stops an impostor removed.
 *
 * The correct fix is to supply the provider's root certificate, obtained from
 * their dashboard rather than from the connection itself. A root certificate
 * offered by the server you are trying to verify proves nothing.
 *
 * `DATABASE_SSL_INSECURE` exists because a one-off command against a database
 * of synthetic data is sometimes worth unblocking. It is deliberately verbose,
 * greppable, and never the default.
 */

import { readFileSync } from "node:fs";

export interface SslInputs {
  /** PEM contents of the provider's root certificate. */
  caCert?: string;
  /** Opt out of verification entirely. Encrypted but unauthenticated. */
  insecure?: boolean;
}

export type SslConfig = false | { ca?: string; rejectUnauthorized: boolean };

/** Hosts treated as local, where TLS would be ceremony with nothing behind it. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

function isLocal(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    // An unparseable URL is not something to guess about; assume remote, which
    // is the configuration that verifies rather than the one that does not.
    return false;
  }
}

export function sslConfigFor(url: string, inputs: SslInputs): SslConfig {
  if (isLocal(url)) return false;

  if (inputs.caCert !== undefined && inputs.caCert !== "") {
    return { ca: inputs.caCert, rejectUnauthorized: true };
  }

  return { rejectUnauthorized: inputs.insecure !== true };
}

/**
 * Read the CA certificate from the environment.
 *
 * Accepts the PEM inline, because a serverless platform's environment variables
 * are text and not a filesystem, or a path, because a developer has a file.
 */
export function caCertFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env.DATABASE_CA_CERT;
  if (value === undefined || value === "") return undefined;
  if (value.includes("BEGIN CERTIFICATE")) return value;

  try {
    return readFileSync(value, "utf8");
  } catch {
    throw new Error(
      `DATABASE_CA_CERT points at ${value}, which could not be read. ` +
        "Give it either the certificate's PEM contents or a readable path.",
    );
  }
}
