const API_URL = process.env.NEXT_PUBLIC_API_URL ?? ''
const BACKEND = `${API_URL}/backend`

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
  const res = await fetch(`${BACKEND}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  })
  if (res.status === 401) {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('token')
      window.location.href = '/login'
    }
    throw new Error('Unauthorized')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error ?? `Request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

export interface Incident {
  id: string
  title: string
  description: string | null
  severity: 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4'
  status: 'OPEN' | 'INVESTIGATING' | 'RESOLVED'
  createdAt: string
  resolvedAt: string | null
  createdBy: { name: string; email: string }
}

export interface Summary {
  total: number
  byStatus: Record<string, number>
  bySeverity: Record<string, number>
  resolvedLast7d: number
}

export const api = {
  auth: {
    login: (email: string, password: string) =>
      apiFetch<{ token: string; user: { id: string; email: string; name: string } }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    register: (email: string, password: string, name: string) =>
      apiFetch<{ token: string; user: { id: string; email: string; name: string } }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, name }),
      }),
  },
  dashboard: {
    summary: () => apiFetch<Summary>('/dashboard/summary'),
  },
  incidents: {
    list: (page = 1) =>
      apiFetch<{ items: Incident[]; total: number; page: number; limit: number }>(
        `/incidents?page=${page}`
      ),
    create: (data: { title: string; description?: string; severity: string }) =>
      apiFetch<Incident>('/incidents', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: { status?: string; severity?: string }) =>
      apiFetch<Incident>(`/incidents/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  },
}
