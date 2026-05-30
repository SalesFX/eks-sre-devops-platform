import { PrismaClient } from '@prisma/client'
import { Signer } from '@aws-sdk/rds-signer'

const DB_HOST = process.env.DB_HOST
const DB_PORT = 5432
const DB_USER = 'app_user'
const DB_NAME = 'devops_ia'
const AWS_REGION = 'us-east-1'

// Token lifetime is 15 minutes (900 s). Refresh 2 minutes before expiry.
const TOKEN_TTL_MS = 15 * 60 * 1000
const REFRESH_BEFORE_MS = 2 * 60 * 1000
const REFRESH_INTERVAL_MS = TOKEN_TTL_MS - REFRESH_BEFORE_MS

declare global {
  var __prisma: PrismaClient | undefined
  var __prismaRefreshTimer: ReturnType<typeof setInterval> | undefined
}

async function generateIamToken(): Promise<string> {
  if (!DB_HOST) {
    throw new Error('DB_HOST environment variable is not set')
  }
  const signer = new Signer({
    hostname: DB_HOST,
    port: DB_PORT,
    username: DB_USER,
    region: AWS_REGION,
  })
  return signer.getAuthToken()
}

function buildDatabaseUrl(token: string): string {
  const encoded = encodeURIComponent(token)
  return `postgresql://${DB_USER}:${encoded}@${DB_HOST}:${DB_PORT}/${DB_NAME}?sslmode=require`
}

async function createPrismaClientWithIamAuth(): Promise<PrismaClient> {
  const token = await generateIamToken()
  const url = buildDatabaseUrl(token)
  return new PrismaClient({ datasources: { db: { url } } })
}

async function refreshClient(): Promise<void> {
  try {
    const newClient = await createPrismaClientWithIamAuth()
    const old = globalThis.__prisma
    globalThis.__prisma = newClient
    prismaExports.prisma = newClient
    if (old) {
      // Allow in-flight queries to complete before disconnecting.
      old.$disconnect().catch(() => undefined)
    }
  } catch (err) {
    console.error('[prisma] IAM token refresh failed, keeping existing client:', err)
  }
}

// Export shape that allows the refresh cycle to update the reference in place.
const prismaExports: { prisma: PrismaClient } = { prisma: undefined as unknown as PrismaClient }

async function init(): Promise<void> {
  if (globalThis.__prisma) {
    prismaExports.prisma = globalThis.__prisma
    return
  }

  const client = await createPrismaClientWithIamAuth()
  globalThis.__prisma = client
  prismaExports.prisma = client

  // Start the proactive refresh cycle once, even across HMR in development.
  if (!globalThis.__prismaRefreshTimer) {
    globalThis.__prismaRefreshTimer = setInterval(refreshClient, REFRESH_INTERVAL_MS)
    // Allow the Node.js process to exit cleanly even if the timer is active.
    if (typeof globalThis.__prismaRefreshTimer.unref === 'function') {
      globalThis.__prismaRefreshTimer.unref()
    }
  }
}

// Initialise eagerly so callers can await the module-level promise or use
// the synchronous `prisma` export after the first await resolves.
export const ready = init()

export const getPrisma = async (): Promise<PrismaClient> => {
  await ready
  return prismaExports.prisma
}

// Convenience synchronous export for callers that are certain init has run.
// In practice every request handler runs after server startup, so this is safe.
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    if (!prismaExports.prisma) {
      throw new Error(
        '[prisma] Client not yet initialised. Await `ready` before using `prisma` synchronously.',
      )
    }
    const value = (prismaExports.prisma as Record<string | symbol, unknown>)[prop]
    if (typeof value === 'function') {
      return (value as Function).bind(prismaExports.prisma)
    }
    return value
  },
})
