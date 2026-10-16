import { defineConfig } from "drizzle-kit";

import { caCertFromEnv, sslConfigFor } from "./src/db/ssl";

const url =
  process.env.DATABASE_URL ?? "postgres://vetting:vetting@localhost:5433/vendor_vetting";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url,
    // The same decision the runtime pool makes, imported rather than restated:
    // migrations and queries must not disagree about who they trust.
    ssl: sslConfigFor(url, {
      caCert: caCertFromEnv(),
      insecure: process.env.DATABASE_SSL_INSECURE === "1",
    }),
  },
  verbose: true,
  strict: true,
});
