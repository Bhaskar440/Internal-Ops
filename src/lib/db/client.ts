import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * The single Prisma client for the application.
 *
 * Prisma 7 requires an explicit driver adapter — `new PrismaClient()` with no
 * options throws at runtime.
 *
 * Construction is LAZY. If the client were built at module load, a missing
 * DATABASE_URL or an unreachable database would throw during import, before any
 * caller's try/catch could run — surfacing as an opaque bundler module error
 * instead of a handleable failure. Deferring construction to first property
 * access keeps errors at query time, where pages can catch and explain them.
 *
 * In development Next.js hot-reload re-evaluates modules, so the instance is
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
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function getClient(): PrismaClient {
  globalForPrisma.prisma ??= createClient();
  return globalForPrisma.prisma;
}

/**
 * Proxy so that `prisma.venture.findMany()` constructs the real client on first
 * use. Importing this module never opens a connection by itself.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getClient();
    const value = Reflect.get(client as object, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
  has(_target, prop) {
    return Reflect.has(getClient() as object, prop);
  },
});

/**
 * Transaction client type — every service method that participates in a
 * transaction takes one of these rather than reaching for the global client,
 * so callers can compose multi-step operations atomically (§54).
 */
export type PrismaTransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;
