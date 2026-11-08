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

  /*
   * A certificate's base64 body with its BEGIN/END lines missing — what you
   * get by selecting the middle of a PEM, or by pasting into a field that
   * strips them. Worth its own message: treating it as a path sends the
   * reader looking for a file that was never meant to exist.
   *
   * Not repaired automatically. Re-wrapping it would also quietly accept a
   * paste that was cut short, turning a clear configuration error into a TLS
   * handshake failure further away from its cause.
   */
  if (looksLikeCertificateBody(value)) {
    throw new Error(
      "DATABASE_CA_CERT looks like a certificate body with its armour missing. " +
        "Include the -----BEGIN CERTIFICATE----- and -----END CERTIFICATE----- " +
        "lines, and the line breaks between them.",
    );
  }

  try {
    return readFileSync(value, "utf8");
  } catch {
    // Truncated: this message reaches a hosting provider's logs on every
    // request, and a stray paste can be thousands of characters long.
    throw new Error(
      `DATABASE_CA_CERT points at ${abbreviate(value)}, which could not be read. ` +
        "Give it either the certificate's PEM contents or a readable path.",
    );
  }
}

/** Shorten a value for an error message that will be written to logs. */
function abbreviate(value: string, max = 60): string {
  return value.length <= max ? value : `${value.slice(0, max)}… (${value.length} chars)`;
}

/**
 * Whether a value is a certificate's base64 body stripped of its PEM armour.
 *
 * Long, and base64 and nothing else. A filesystem path fails this on the
 * slashes and dots it needs to be a path at all.
 */
function looksLikeCertificateBody(value: string): boolean {
  const compact = value.replace(/\s+/g, "");
  return compact.length > 100 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact);
}

/**
 * Whether a PEM has lost its line breaks.
 *
 * A hosting dashboard's environment-variable field sometimes flattens a pasted
 * certificate onto one line. Node then rejects it with an error that names
 * neither the variable nor the cause, which is a bad half hour to spend.
 */
function pemIsFlattened(pem: string): boolean {
  return pem.includes("BEGIN CERTIFICATE") && !/-----BEGIN CERTIFICATE-----\s*\n/.test(pem);
}

/**
 * A one-line description of what a connection is aiming at, safe to log.
 *
 * Deliberately never includes the password: this is written to logs a hosting
 * provider keeps, and a credential in a log outlives every intention about it.
 */
export function describeConnection(url: string, inputs: SslInputs): string {
  let host = "unparseable";
  let port = "unparseable";
  let database = "unparseable";

  try {
    const parsed = new URL(url);
    host = parsed.hostname;
    port = parsed.port === "" ? "5432" : parsed.port;
    database = parsed.pathname.replace(/^\//, "") || "(none)";
  } catch {
    // Keep the placeholders: an unparseable URL is itself the finding, and is
    // worth reporting rather than throwing from inside an error path.
  }

  const config = sslConfigFor(url, inputs);
  const ssl =
    config === false
      ? "off"
      : config.rejectUnauthorized
        ? config.ca === undefined
          ? "verify-system-roots"
          : "verify-with-ca"
        : "unverified";

  const ca = classifyCaCert(inputs.caCert);

  return `host=${host} port=${port} db=${database} ssl=${ssl} ca=${ca}`;
}

/** How the configured CA value looks, for a log line that has to be actionable. */
function classifyCaCert(value: string | undefined): string {
  if (value === undefined || value === "") return "absent";
  if (value.includes("BEGIN CERTIFICATE")) return pemIsFlattened(value) ? "flattened" : "present";
  if (looksLikeCertificateBody(value)) return "unarmored";
  return "path";
}
