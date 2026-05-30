'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { isAuthenticated } from '@/lib/auth'
import Nav from '@/components/Nav'

export default function NewIncidentPage() {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [severity, setSeverity] = useState('SEV3')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  useEffect(() => {
    if (!isAuthenticated()) router.push('/login')
  }, [router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await api.incidents.create({
        title,
        description: description.trim() || undefined,
        severity,
      })
      router.push('/incidents')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create incident')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950">
      <Nav />
      <main className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-xl font-semibold text-white mb-6">New Incident</h1>

        <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm text-gray-300 mb-1.5">Title</label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                required
                autoFocus
                maxLength={200}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Brief description of the incident"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-300 mb-1.5">Severity</label>
              <select
                value={severity}
                onChange={e => setSeverity(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="SEV1">SEV1 - Critical (complete outage)</option>
                <option value="SEV2">SEV2 - High (major degradation)</option>
                <option value="SEV3">SEV3 - Medium (partial impact)</option>
                <option value="SEV4">SEV4 - Low (minor issue)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm text-gray-300 mb-1.5">
                Description{' '}
                <span className="text-gray-500">(optional)</span>
              </label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={4}
                maxLength={2000}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                placeholder="What happened? What is the impact? What has been tried?"
              />
            </div>

            {error && (
              <div className="bg-red-900/30 border border-red-800 rounded-lg px-3 py-2">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg px-5 py-2.5 text-sm transition-colors"
              >
                {loading ? 'Creating...' : 'Create Incident'}
              </button>
              <button
                type="button"
                onClick={() => router.back()}
                className="bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium rounded-lg px-5 py-2.5 text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  )
}
