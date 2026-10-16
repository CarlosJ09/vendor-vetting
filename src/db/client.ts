/**
 * Database client.
 *
 * A single lazily-created pool per process. Next.js dev-mode hot reload
 * re-evaluates modules on every edit, so the pool is stashed on `globalThis` —
 * without that, a few minutes of editing exhausts Postgres's connection limit
 * and the app starts failing on something that has nothing to do with the code
 * being edited.
 *
 * The default URL matches `docker-compose.yml`. Hardcoding a default is normally
 * a smell, but this database holds only synthetic documents on a developer's own
 * machine (§2 forbids real supplier data ever reaching it), and requiring an
 * env file to run `pnpm test` would be friction with nothing behind it.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";
import { caCertFromEnv, sslConfigFor } from "./ssl";

export const DEFAULT_DATABASE_URL = "postgres://vetting:vetting@localhost:5433/vendor_vetting";

export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

const globalForDb = globalThis as unknown as { __vettingPool?: Pool };

function pool(): Pool {
  if (globalForDb.__vettingPool === undefined) {
    const url = databaseUrl();

    globalForDb.__vettingPool = new Pool({
      connectionString: url,
      // See ./ssl.ts: a managed provider signs with its own root, so this is a
      // decision rather than a boolean.
      ssl: sslConfigFor(url, {
        caCert: caCertFromEnv(),
        insecure: process.env.DATABASE_SSL_INSECURE === "1",
      }),
      // The pipeline is sequential and the UI is one reader; a large pool would
      // only make an exhausted-connection bug harder to notice.
      max: 5,
      connectionTimeoutMillis: 5_000,
    });
  }
  return globalForDb.__vettingPool;
}

export type Database = ReturnType<typeof drizzle<typeof schema>>;

let cached: Database | undefined;

export function db(): Database {
  cached ??= drizzle(pool(), { schema });
  return cached;
}

/** Close the pool. For test teardown and one-shot CLI scripts. */
export async function closeDb(): Promise<void> {
  const existing = globalForDb.__vettingPool;
  if (existing === undefined) return;

  globalForDb.__vettingPool = undefined;
  cached = undefined;
  await existing.end();
}

/**
 * Whether the database is reachable.
 *
 * Used by the integration tests to skip rather than fail on a machine with no
 * Docker running. A skipped test is honest; a test suite that cannot run
 * without infrastructure it never documents is not.
 */
export async function isReachable(): Promise<boolean> {
  try {
    const client = await pool().connect();
    client.release();
    return true;
  } catch {
    return false;
  }
}
