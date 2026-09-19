/**
 * Domény, na kterých má Účtárna běžet (stejný Vercel projekt).
 * Runtime URL vždy bereme z aktuálního originu — session/localStorage
 * jsou per-origin (vercel.app ≠ uctarna.eu).
 */

export const CANONICAL_HOST = 'uctarna.eu'
export const CANONICAL_SITE_URL = 'https://uctarna.eu'

export const SITE_HOSTS = [
  'uctarna.eu',
  'www.uctarna.eu',
  'uctarna.vercel.app',
] as const

export type SiteHost = (typeof SITE_HOSTS)[number]

export function isAllowedSiteHost(hostname: string): boolean {
  const host = hostname.toLowerCase().split(':')[0]
  if (host === 'localhost' || host === '127.0.0.1') return true
  return (SITE_HOSTS as readonly string[]).includes(host)
}

/** Preferuj env, jinak kanonickou produkční URL (SEO / metadata). */
export function getCanonicalSiteUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (fromEnv) return fromEnv.replace(/\/$/, '')
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.replace(/\/$/, '')}`
  }
  return CANONICAL_SITE_URL
}

/** Absolutní URL z requestu (API / SSR) — funguje na obou doménách. */
export function getRequestOrigin(requestUrl: string | URL): string {
  const url = typeof requestUrl === 'string' ? new URL(requestUrl) : requestUrl
  return url.origin
}
