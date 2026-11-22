import { env, exports } from 'cloudflare:workers'
import { addInvitation, addUser, revokeDevice, revokeUser } from '../src/admin/sql.ts'
import { INVITATION_TTL } from '../src/worker/constants.ts'
import { randomToken, sha256 } from '../src/worker/crypto.ts'

export const ORIGIN = 'https://koke.test'

// Runs admin SQL the way `wrangler d1 execute --file` does: every statement, in order.
export async function runAdminSql(sql: string) {
  const statements = sql
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean)
  return env.DB.batch(statements.map((s) => env.DB.prepare(s)))
}

export async function newUser(name = 'learner'): Promise<number> {
  const [r] = await runAdminSql(addUser(name, Date.now()))
  return (r.results[0] as { user_id: number }).user_id
}

export async function newInvitation(userId: number, { ago = 0 } = {}): Promise<string> {
  const code = randomToken(16)
  await runAdminSql(addInvitation(userId, await sha256(code), Date.now() - ago, INVITATION_TTL))
  return code
}

export const revoke = {
  device: (id: number) => runAdminSql(revokeDevice(id, Date.now())),
  user: (id: number) => runAdminSql(revokeUser(id, Date.now())),
}

export function cookieOf(res: Response): string {
  const set = res.headers.get('Set-Cookie') ?? ''
  const m = set.match(/__Host-koke=([^;]+)/)
  if (!m) throw new Error(`no device cookie in ${res.status} response`)
  return `__Host-koke=${m[1]}`
}

type Call = { cookie?: string; origin?: string | null; body?: unknown; method?: string }

export function call(path: string, { cookie, origin = ORIGIN, body, method }: Call = {}): Promise<Response> {
  const headers = new Headers()
  if (cookie) headers.set('Cookie', cookie)
  if (origin) headers.set('Origin', origin)
  if (body !== undefined) headers.set('Content-Type', 'application/json')
  return exports.default.fetch(
    new Request(`${ORIGIN}${path}`, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
}

// A phone signed in through a fresh invitation.
export async function newPhone(userId?: number): Promise<{ userId: number; cookie: string; deviceId: number }> {
  const uid = userId ?? (await newUser())
  const res = await call('/api/handoff', { body: { code: await newInvitation(uid) } })
  const cookie = cookieOf(res)
  const row = await env.DB.prepare(
    "SELECT device_id FROM devices WHERE user_id = ? AND kind = 'phone' ORDER BY device_id DESC LIMIT 1",
  )
    .bind(uid)
    .first<{ device_id: number }>()
  return { userId: uid, cookie, deviceId: row!.device_id }
}

export async function pairingCode(phoneCookie: string): Promise<string> {
  const res = await call('/api/pairing-codes', { cookie: phoneCookie, body: {} })
  return ((await res.json()) as { code: string }).code
}

export async function newPc(phoneCookie: string): Promise<string> {
  return cookieOf(await call('/api/pair', { body: { code: await pairingCode(phoneCookie) } }))
}
