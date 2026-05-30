'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, Summary } from '@/lib/api'
import { isAuthenticated } from '@/lib/auth'
import Nav from '@/components/Nav'

const SEV_COLORS: Record<string, string> = {
  SEV1: 'text-red-400 bg-red-900/30 border-red-800',
  SEV2: 'text-orange-400 bg-orange-900/30 border-orange-800',
  SEV3: 'text-yellow-400 bg-yellow-900/30 border-yellow-800',
  SEV4: 'text-green-400 bg-green-900/30 border-green-800',
}

function StatCard({
  label,
  value,
  valueClass = 'text-white',
}: {
  label: string
  value: number
  valueClass?: string
}) {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
      <p className="text-gray-400 text-sm mb-1">{label}</p>
      <p className={`text-3xl font-bold ${valueClass}`}>{value}</p>
    </div>
  )
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/login')
      return
    }
    api.dashboard
      .summary()
      .then(setSummary)
      .catch(() => router.push('/login'))
      .finally(() => setLoading(false))
  }, [router])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-500 text-sm">Loading...</p>
      </div>
    )
  }

  if (!summary) return null

  return (
    <div className="min-h-screen bg-gray-950">
      <Nav />
      <main className="max-w-6xl mx-auto px-4 py-8">
        <h1 className="text-xl font-semibold text-white mb-6">Dashboard</h1>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard label="Total" value={summary.total} />
          <StatCard label="Open" value={summary.byStatus.OPEN ?? 0} valueClass="text-red-400" />
          <StatCard
            label="Investigating"
            value={summary.byStatus.INVESTIGATING ?? 0}
            valueClass="text-yellow-400"
          />
          <StatCard
            label="Resolved"
            value={summary.byStatus.RESOLVED ?? 0}
            valueClass="text-green-400"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
            <h2 className="text-white font-medium mb-4 text-sm uppercase tracking-wider text-gray-400">
              By Severity
            </h2>
            <div className="space-y-2.5">
              {(['SEV1', 'SEV2', 'SEV3', 'SEV4'] as const).map(sev => (
                <div key={sev} className="flex items-center justify-between">
                  <span
                    className={`text-xs font-semibold px-2.5 py-1 rounded-md border ${SEV_COLORS[sev]}`}
                  >
                    {sev}
                  </span>
                  <span className="text-white font-semibold tabular-nums">
                    {summary.bySeverity[sev] ?? 0}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
            <h2 className="text-white font-medium mb-4 text-sm uppercase tracking-wider text-gray-400">
              Recovery (last 7 days)
            </h2>
            <div className="flex flex-col items-center justify-center h-24">
              <p className="text-5xl font-bold text-green-400 tabular-nums">
                {summary.resolvedLast7d}
              </p>
              <p className="text-gray-500 text-sm mt-2">incidents resolved</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
