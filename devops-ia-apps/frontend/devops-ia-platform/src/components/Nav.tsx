'use client'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { clearToken } from '@/lib/auth'

export default function Nav() {
  const router = useRouter()
  const pathname = usePathname()

  function logout() {
    clearToken()
    router.push('/login')
  }

  return (
    <nav className="bg-gray-900 border-b border-gray-800">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <span className="text-white font-semibold text-sm tracking-tight">devops-ia</span>
          <Link
            href="/dashboard"
            className={`text-sm transition-colors ${
              pathname === '/dashboard' ? 'text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Dashboard
          </Link>
          <Link
            href="/incidents"
            className={`text-sm transition-colors ${
              pathname?.startsWith('/incidents') ? 'text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Incidents
          </Link>
        </div>
        <button onClick={logout} className="text-gray-400 hover:text-white text-sm transition-colors">
          Sign out
        </button>
      </div>
    </nav>
  )
}
