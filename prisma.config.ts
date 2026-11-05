// Prisma CLI configuration.
// Loaded by every `prisma` command; must not throw when DATABASE_URL is
// unset — the datasource URL is resolved from the schema's env("DATABASE_URL")
// only when a command actually needs it (validate, generate, migrate, db).
import "dotenv/config";
import { defineConfig } from "prisma/config";
import { applyDatabaseUrlToEnv } from "./src/config/database.js";

// Prisma commands follow the same database rules as the app.
applyDatabaseUrlToEnv();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
});
