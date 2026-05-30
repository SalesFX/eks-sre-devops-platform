import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth, AuthRequest } from '../middlewares/auth'

const router = Router()

const CreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  severity: z.enum(['SEV1', 'SEV2', 'SEV3', 'SEV4']),
})

const UpdateSchema = z.object({
  status: z.enum(['OPEN', 'INVESTIGATING', 'RESOLVED']).optional(),
  severity: z.enum(['SEV1', 'SEV2', 'SEV3', 'SEV4']).optional(),
})

router.get('/', requireAuth, async (req: AuthRequest, res) => {
  const page = Math.max(1, Number(req.query.page ?? 1))
  const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 20)))
  const [items, total] = await Promise.all([
    prisma.incident.findMany({
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: { createdBy: { select: { name: true, email: true } } },
    }),
    prisma.incident.count(),
  ])
  res.json({ items, total, page, limit })
})

router.post('/', requireAuth, async (req: AuthRequest, res) => {
  const parsed = CreateSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() })
    return
  }
  const incident = await prisma.incident.create({
    data: { ...parsed.data, createdById: req.user!.sub },
    include: { createdBy: { select: { name: true, email: true } } },
  })
  res.status(201).json(incident)
})

router.patch('/:id', requireAuth, async (req: AuthRequest, res) => {
  const parsed = UpdateSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() })
    return
  }
  const data: Record<string, unknown> = { ...parsed.data }
  if (parsed.data.status === 'RESOLVED') {
    data.resolvedAt = new Date()
  }
  try {
    const incident = await prisma.incident.update({
      where: { id: req.params.id },
      data,
      include: { createdBy: { select: { name: true, email: true } } },
    })
    res.json(incident)
  } catch {
    res.status(404).json({ error: 'Incident not found' })
  }
})

export default router
