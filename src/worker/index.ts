import { currentDevice, type Device } from './auth.ts'
import { deviceCookie, error, json, readJson, sameOrigin } from './http.ts'
import { inviteManifest, invitePage, spendInvitation } from './invite.ts'
import { issuePairingCode, pairWithCode } from './pairing.ts'

export type Env = { DB: D1Database; ASSETS: Fetcher }

const PAIRING_CODE = /^\d{6}$/
// Invitation codes are randomToken(16) or longer: URL-safe base64.
const INVITATION_CODE = /^[\w-]{22,}$/

// Signed-in responses re-issue the cookie, so a device in use stays signed in past 400 days.
function signedIn(device: Device, res: Response): Response {
  res.headers.append('Set-Cookie', deviceCookie(device.token))
  return res
}

async function api(req: Request, env: Env, path: string, now: number): Promise<Response> {
  const writes = req.method !== 'GET' && req.method !== 'HEAD'
  if (writes && !sameOrigin(req)) return error('forbidden')
  const device = await currentDevice(req, env.DB)

  // The two ways in, usable without a cookie.
  if (path === '/api/handoff' && req.method === 'POST') {
    // A valid cookie wins: koke never switches accounts because of a code in the URL.
    if (device) return signedIn(device, json({ read_only: device.kind === 'pc' }))
    const code = (await readJson(req))?.code
    if (typeof code !== 'string' || !INVITATION_CODE.test(code)) return error('not_found')
    const token = await spendInvitation(env.DB, code, now)
    if (!token) return error('not_found')
    return json({ read_only: false }, { headers: { 'Set-Cookie': deviceCookie(token) } })
  }
  if (path === '/api/pair' && req.method === 'POST') {
    if (device) return signedIn(device, json({ read_only: device.kind === 'pc' }))
    const code = (await readJson(req))?.code
    if (typeof code !== 'string' || !PAIRING_CODE.test(code)) return error('not_found')
    const result = await pairWithCode(env.DB, code, now)
    if (result === null) return error('not_found')
    if (typeof result === 'object') return error('too_many_attempts', result)
    return json({ read_only: true }, { headers: { 'Set-Cookie': deviceCookie(result) } })
  }

  if (!device) return error('not_signed_in')
  // PC is view-only (L7).
  if (writes && device.kind === 'pc') return error('forbidden')

  if (path === '/api/state' && req.method === 'GET') {
    return signedIn(device, json({ read_only: device.kind === 'pc' }))
  }
  if (path === '/api/pairing-codes' && req.method === 'POST') {
    const result = await issuePairingCode(env.DB, device.device_id, now)
    if ('paused_until' in result) return signedIn(device, error('too_many_attempts', result))
    return signedIn(device, json(result))
  }
  return signedIn(device, error('not_found'))
}

export default {
  async fetch(req, env): Promise<Response> {
    const url = new URL(req.url)
    const now = Date.now()
    if (url.pathname.startsWith('/api/')) return api(req, env, url.pathname, now)

    const invite = url.pathname.match(/^\/invite\/([\w-]+)$/)
    if (invite && req.method === 'GET') return invitePage(env.DB, invite[1], now)
    const manifest = url.pathname.match(/^\/manifest\/([\w-]+)$/)
    if (manifest && req.method === 'GET') return inviteManifest(manifest[1])

    return env.ASSETS.fetch(req)
  },
} satisfies ExportedHandler<Env>
