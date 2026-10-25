import type { MetadataRoute } from 'next'
import { ROBOTS_DISALLOW } from '@/lib/security/token-paths'

// robots.txt. Nothing in this app is meant for search engines: every page
// already carries noindex (root layout), and token pages also send
// X-Robots-Tag. This keeps well-behaved crawlers off the token paths
// (patient checkout, plan, intake and sign-up links, invites) and the API.
// It names the path prefixes only, never a token.
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: '*', disallow: [...ROBOTS_DISALLOW] }] }
}
