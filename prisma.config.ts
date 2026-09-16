import path from "node:path";
import { defineConfig } from "prisma/config";

// prisma.config.ts opts out of Prisma's automatic .env loading, so load it
// ourselves for local dev (`prisma migrate` / `prisma studio` CLI usage).
// In production the platform provides real environment variables and no
// .env file exists, which is fine.
try {
  process.loadEnvFile();
} catch {
  // no .env file present - environment variables are provided by the platform
}

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
