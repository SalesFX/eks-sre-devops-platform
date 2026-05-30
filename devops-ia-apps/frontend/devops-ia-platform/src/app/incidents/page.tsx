'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { api, Incident } from '@/lib/api'
import { isAuthenticated } from '@/lib/auth'
import Nav from '@/components/Nav'

const SEV_STYLES: Record<string, string> = {
  SEV1: 'bg-red-900/40 text-red-400 border-red-800',
  SEV2: 'bg-orange-900/40 text-orange-400 border-orange-800',
  SEV3: 'bg-yellow-900/40 text-yellow-400 border-yellow-800',
  SEV4: 'bg-green-900/40 text-green-400 border-green-800',
}

const STATUS_STYLES: Record<string, string> = {
  OPEN: 'bg-red-900/40 text-red-400 border-red-800',
  INVESTIGATING: 'bg-blue-900/40 text-blue-400 border-blue-800',
  RESOLVED: 'bg-gray-800 text-gray-400 border-gray-700',
}

export default function IncidentsPage() {
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/login')
      return
    }
    api.incidents
      .list()
      .then(data => {
        setIncidents(data.items)
        setTotal(data.total)
      })
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

  return (
    <div className="min-h-screen bg-gray-950">
      <Nav />
      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold text-white">
            Incidents{' '}
            <span className="text-gray-500 font-normal text-base">({total})</span>
          </h1>
          <Link
            href="/incidents/new"
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            New Incident
          </Link>
        </div>

        {incidents.length === 0 ? (
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-12 text-center">
            <p className="text-gray-400 mb-2">No incidents yet.</p>
            <Link href="/incidents/new" className="text-blue-400 text-sm hover:text-blue-300">
              Create the first one
            </Link>
          </div>
        ) : (
          <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left px-4 py-3 text-gray-400 font-medium">Title</th>
                  <th className="text-left px-4 py-3 text-gray-400 font-medium">Severity</th>
                  <th className="text-left px-4 py-3 text-gray-400 font-medium">Status</th>
                  <th className="text-left px-4 py-3 text-gray-400 font-medium">Created</th>
                  <th className="text-left px-4 py-3 text-gray-400 font-medium">By</th>
                </tr>
              </thead>
              <tbody>
                {incidents.map(inc => (
                  <tr key={inc.id} className="border-b border-gray-800/50 last:border-0 hover:bg-gray-800/30 transition-colors">
                    <td className="px-4 py-3 text-white">{inc.title}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${SEV_STYLES[inc.severity]}`}>
                        {inc.severity}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded border ${STATUS_STYLES[inc.status]}`}>
                        {inc.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      {new Date(inc.createdAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{inc.createdBy.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}
