import { currentDevice, type Device } from './auth.ts'
import { deviceCookie, error, json, readJson, sameOrigin } from './http.ts'
import { CODE_HEADERS, inviteManifest, invitePage, spendInvitation } from './invite.ts'
import { issuePairingCode, pairWithCode } from './pairing.ts'
import { away, pickSubject, screenState, start, stop, switchSubject, type WriteResult } from './sessions.ts'

export type Env = { DB: D1Database; ASSETS: Fetcher }

// Invitation codes are randomToken(16) or longer: URL-safe base64.
const INVITATION_CODE = /^[\w-]{22,}$/

// Signed-in responses re-issue the cookie, so a device in use stays signed in past 400 days.
function signedIn(device: Device, res: Response): Response {
  res.headers.append('Set-Cookie', deviceCookie(device.token))
  return res
}

function writeResponse(result: WriteResult): Response {
  if (result.kind === 'ok') return json({ applied: result.applied, session: result.session })
  return error(result.kind)
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
    // Anything typed goes through the same check, so a malformed code also counts and sees the pause.
    const code = (await readJson(req))?.code
    const result = await pairWithCode(env.DB, typeof code === 'string' ? code : '', now)
    if (result === null) return error('not_found')
    if (typeof result === 'object') return error('too_many_attempts', result)
    return json({ read_only: true }, { headers: { 'Set-Cookie': deviceCookie(result) } })
  }

  if (!device) return error('not_signed_in')
  // PC is view-only (L7).
  if (writes && device.kind === 'pc') return signedIn(device, error('forbidden'))

  if (path === '/api/state' && req.method === 'GET') {
    return signedIn(device, json({ read_only: device.kind === 'pc', ...(await screenState(env.DB, device.user_id)) }))
  }
  if (path === '/api/sessions' && req.method === 'POST') {
    const body = await readJson(req)
    if (!body) return signedIn(device, error('bad_request'))
    const subjectId = body.subject_id ?? null
    if (subjectId !== null && !Number.isSafeInteger(subjectId)) return signedIn(device, error('bad_request'))
    return signedIn(device, writeResponse(await start(env.DB, device.user_id, subjectId as number | null, now)))
  }
  const write = path.match(/^\/api\/sessions\/(\d+)\/(stop|away|subject|switch)$/)
  if (write && req.method === 'POST') {
    const sessionId = Number(write[1])
    // away also arrives from sendBeacon as text/plain; req.json() reads either.
    const body = await readJson(req)
    if (!body) return signedIn(device, error('bad_request'))
    const { base_rev } = body
    const run = {
      stop: () => stop(env.DB, device.user_id, sessionId, base_rev, body.ended_at, now),
      away: () => away(env.DB, device.user_id, sessionId, base_rev, body.away_at, now),
      subject: () => pickSubject(env.DB, device.user_id, sessionId, base_rev, body.subject_id, now),
      switch: () => switchSubject(env.DB, device.user_id, sessionId, base_rev, body.subject_id, now),
    }[write[2] as 'stop' | 'away' | 'subject' | 'switch']
    return signedIn(device, writeResponse(await run()))
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
    // Anything else under these paths may still carry a code in its URL: never serve it from assets.
    if (/^\/(invite|manifest)\//.test(url.pathname)) return new Response(null, { status: 404, headers: CODE_HEADERS })

    return env.ASSETS.fetch(req)
  },
} satisfies ExportedHandler<Env>
