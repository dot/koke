import { COOKIE_MAX_AGE_SECONDS, COOKIE_NAME } from './constants.ts'

export type ErrorCode = 'bad_request' | 'not_signed_in' | 'forbidden' | 'not_found' | 'conflict' | 'too_many_attempts'

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  not_signed_in: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  too_many_attempts: 429,
}

export function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  headers.set('Cache-Control', 'no-store')
  return new Response(JSON.stringify(body), { ...init, headers })
}

export function error(code: ErrorCode, extra: Record<string, unknown> = {}): Response {
  return json({ error: code, ...extra }, { status: STATUS[code] })
}

export function deviceCookie(token: string): string {
  return `${COOKIE_NAME}=${token}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Lax`
}

export function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get('Cookie') ?? '').split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return null
}

// Requests that change state must come from koke's own pages (ADR 2).
export function sameOrigin(req: Request): boolean {
  return req.headers.get('Origin') === new URL(req.url).origin
}

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await req.json()
    return body !== null && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}
