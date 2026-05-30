import express from 'express'
import cors from 'cors'
import { prisma } from './lib/prisma'
import authRouter from './routes/auth'
import incidentsRouter from './routes/incidents'
import dashboardRouter from './routes/dashboard'

const app = express()
const PORT = Number(process.env.PORT ?? 3001)
const PREFIX = process.env.API_PREFIX ?? '/backend'

app.use(cors({ origin: process.env.CORS_ORIGIN ?? '*' }))
app.use(express.json())

app.get(`${PREFIX}/health`, async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.json({ status: 'ok', db: 'connected' })
  } catch {
    res.status(503).json({ status: 'error', db: 'disconnected' })
  }
})

app.use(`${PREFIX}/auth`, authRouter)
app.use(`${PREFIX}/incidents`, incidentsRouter)
app.use(`${PREFIX}/dashboard`, dashboardRouter)

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}, prefix ${PREFIX}`)
})
