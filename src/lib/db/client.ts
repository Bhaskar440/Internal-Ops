import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * The single Prisma client for the application.
 *
 * Prisma 7 requires an explicit driver adapter — `new PrismaClient()` with no
 * options throws at runtime.
 *
 * In development Next.js hot-reload re-evaluates modules, so the client is
 * cached on globalThis to avoid exhausting the connection pool.
 */

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and run `npm run db:up`.",
    );
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * Transaction client type — every service method that participates in a
 * transaction takes one of these rather than reaching for the global client,
 * so callers can compose multi-step operations atomically (§54).
 */
export type PrismaTransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;
