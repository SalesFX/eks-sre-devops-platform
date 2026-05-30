import { Router } from 'express'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middlewares/auth'

const router = Router()

router.get('/summary', requireAuth, async (_req, res) => {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const [total, byStatus, bySeverity, resolvedLast7d] = await Promise.all([
    prisma.incident.count(),
    prisma.incident.groupBy({ by: ['status'], _count: { id: true } }),
    prisma.incident.groupBy({ by: ['severity'], _count: { id: true } }),
    prisma.incident.count({
      where: { status: 'RESOLVED', resolvedAt: { gte: sevenDaysAgo } },
    }),
  ])
  res.json({
    total,
    byStatus: Object.fromEntries(byStatus.map(r => [r.status, r._count.id])),
    bySeverity: Object.fromEntries(bySeverity.map(r => [r.severity, r._count.id])),
    resolvedLast7d,
  })
})

export default router
