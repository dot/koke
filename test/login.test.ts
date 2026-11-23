import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import { INVITATION_TTL } from '../src/worker/constants.ts'
import { sha256 } from '../src/worker/crypto.ts'
import { spendInvitation } from '../src/worker/invite.ts'
import { pairWithCode } from '../src/worker/pairing.ts'
import {
  call,
  cookieOf,
  newInvitation,
  newPc,
  newPhone,
  newUser,
  pairingCode,
  revoke,
} from './helpers.ts'

const count = async (sql: string, ...params: unknown[]) =>
  (await env.DB.prepare(sql).bind(...params).first<{ n: number }>())!.n

beforeEach(async () => {
  await env.DB.prepare('UPDATE pairing_guard SET failures = 0, paused_until = 0').run()
})

describe('invitation (A1, L1)', () => {
  it('signs a phone in with a fresh invitation and keeps it signed in', async () => {
    const userId = await newUser()
    const code = await newInvitation(userId)
    const res = await call('/api/handoff', { body: { code } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ read_only: false })
    const setCookie = res.headers.get('Set-Cookie')!
    expect(setCookie).toMatch(/^__Host-koke=[\w-]{43}; Path=\/; Max-Age=34560000; HttpOnly; Secure; SameSite=Lax$/)

    const state = await call('/api/state', { cookie: cookieOf(res) })
    expect(state.status).toBe(200)
    expect(await state.json()).toMatchObject({ read_only: false })
    expect(state.headers.get('Set-Cookie')).toBe(setCookie)
  })

  it('refuses an invitation that was already used', async () => {
    const code = await newInvitation(await newUser())
    expect((await call('/api/handoff', { body: { code } })).status).toBe(200)
    const again = await call('/api/handoff', { body: { code } })
    expect(again.status).toBe(404)
    expect(again.headers.get('Set-Cookie')).toBeNull()
  })

  it('refuses an expired invitation', async () => {
    const code = await newInvitation(await newUser(), { ago: INVITATION_TTL + 1 })
    expect((await call('/api/handoff', { body: { code } })).status).toBe(404)
  })

  it('keeps a signed-in device on its account and leaves another invitation unspent', async () => {
    const phone = await newPhone()
    const other = await newUser('other')
    const code = await newInvitation(other)
    const res = await call('/api/handoff', { cookie: phone.cookie, body: { code } })
    expect(res.status).toBe(200)
    expect(await count('SELECT COUNT(*) AS n FROM devices WHERE user_id = ?', other)).toBe(0)
    expect((await call('/api/handoff', { body: { code } })).status).toBe(200)
  })

  it('stores codes and tokens only as hashes', async () => {
    const userId = await newUser()
    const code = await newInvitation(userId)
    const token = cookieOf(await call('/api/handoff', { body: { code } })).split('=')[1]
    expect(await count('SELECT COUNT(*) AS n FROM invitations WHERE code_hash = ?', code)).toBe(0)
    expect(await count('SELECT COUNT(*) AS n FROM devices WHERE token_hash = ?', token)).toBe(0)
  })

  // The launch URL /?handoff= is a static asset that never reaches the Worker.
  it('does not change login state on GET of the invitation page or its manifest', async () => {
    const userId = await newUser()
    const code = await newInvitation(userId)
    const page = await call(`/invite/${code}`)
    expect(page.status).toBe(200)
    expect(page.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(page.headers.get('Cache-Control')).toBe('no-store')
    expect(await page.text()).toContain(`/manifest/${code}`)

    const manifest = await call(`/manifest/${code}`)
    expect(manifest.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(((await manifest.json()) as { start_url: string }).start_url).toBe(`/?handoff=${code}`)

    expect(await count('SELECT COUNT(*) AS n FROM invitations WHERE user_id = ? AND used_at IS NULL', userId)).toBe(1)
    expect(await count('SELECT COUNT(*) AS n FROM devices WHERE user_id = ?', userId)).toBe(0)
  })

  it('tells the learner to ask for a new link when the invitation is spent, expired or unknown', async () => {
    const userId = await newUser()
    const spent = await newInvitation(userId)
    await call('/api/handoff', { body: { code: spent } })
    const expired = await newInvitation(userId, { ago: INVITATION_TTL + 1 })
    for (const code of [spent, expired, 'AAAAAAAAAAAAAAAAAAAAAA']) {
      const page = await call(`/invite/${code}`)
      expect(page.status).toBe(404)
      expect(page.headers.get('Cache-Control')).toBe('no-store')
      expect(page.headers.get('Referrer-Policy')).toBe('no-referrer')
      expect(await page.text()).toContain('管理者に新しいリンク')
    }
  })

  it('sends the manifest with no-store', async () => {
    const code = await newInvitation(await newUser())
    expect((await call(`/manifest/${code}`)).headers.get('Cache-Control')).toBe('no-store')
  })

  it('answers any other request under /invite/ or /manifest/ with an uncached 404', async () => {
    const code = await newInvitation(await newUser())
    const requests: [string, string][] = [
      ['HEAD', `/invite/${code}`],
      ['GET', `/invite/${code}/`],
      ['HEAD', `/manifest/${code}`],
      ['GET', `/manifest/${code}/x`],
    ]
    for (const [method, path] of requests) {
      const res = await call(path, { method })
      expect(res.status, `${method} ${path}`).toBe(404)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
      expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')
    }
  })

  it('spends one invitation once even when two launches send it at the same time', async () => {
    const userId = await newUser()
    const code = await newInvitation(userId)
    const statuses = await Promise.all([1, 2].map(() => call('/api/handoff', { body: { code } }).then((r) => r.status)))
    expect(statuses.sort()).toEqual([200, 404])
    expect(await count('SELECT COUNT(*) AS n FROM devices WHERE user_id = ?', userId)).toBe(1)
  })
})

describe('requests', () => {
  it('answers 401 without a device cookie', async () => {
    const res = await call('/api/state')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'not_signed_in' })
  })

  it('refuses state-changing requests from another origin', async () => {
    const phone = await newPhone()
    for (const origin of ['https://evil.test', null]) {
      const res = await call('/api/pairing-codes', { cookie: phone.cookie, origin, body: {} })
      expect(res.status).toBe(403)
    }
    const userId = await newUser()
    const code = await newInvitation(userId)
    const pairing = await pairingCode(phone.cookie)
    for (const origin of ['https://evil.test', null]) {
      expect((await call('/api/handoff', { origin, body: { code } })).status).toBe(403)
      expect((await call('/api/pair', { origin, body: { code: pairing } })).status).toBe(403)
    }
    expect(await count('SELECT COUNT(*) AS n FROM devices WHERE user_id = ?', userId)).toBe(0)
    expect((await call('/api/pair', { body: { code: pairing } })).status).toBe(200)
  })
})

describe('PC pairing (L7)', () => {
  it('pairs a PC that can read but not write', async () => {
    const phone = await newPhone()
    const paired = await call('/api/pair', { body: { code: await pairingCode(phone.cookie) } })
    expect(paired.headers.get('Set-Cookie')).toMatch(/; Path=\/; Max-Age=34560000; HttpOnly; Secure; SameSite=Lax$/)
    const pc = cookieOf(paired)
    const state = await call('/api/state', { cookie: pc })
    expect(await state.json()).toMatchObject({ read_only: true })
    const write = await call('/api/pairing-codes', { cookie: pc, body: {} })
    expect(write.status).toBe(403)
    // Refused writes still count as use, so the PC stays signed in.
    expect(cookieOf(write)).toBe(pc)
    const row = await env.DB.prepare("SELECT user_id, paired_from FROM devices WHERE kind = 'pc' ORDER BY device_id DESC")
      .first<{ user_id: number; paired_from: number }>()
    expect(row).toEqual({ user_id: phone.userId, paired_from: phone.deviceId })
  })

  it('spends a pairing code once', async () => {
    const phone = await newPhone()
    const code = await pairingCode(phone.cookie)
    expect((await call('/api/pair', { body: { code } })).status).toBe(200)
    expect((await call('/api/pair', { body: { code } })).status).toBe(404)
  })

  it('replaces the code a phone showed before', async () => {
    const phone = await newPhone()
    const first = await pairingCode(phone.cookie)
    await pairingCode(phone.cookie)
    expect((await call('/api/pair', { body: { code: first } })).status).toBe(404)
  })

  it('refuses an expired pairing code', async () => {
    const phone = await newPhone()
    const code = await pairingCode(phone.cookie)
    await env.DB.prepare('UPDATE pairing_codes SET expires_at = ? WHERE device_id = ?').bind(Date.now() - 1, phone.deviceId).run()
    expect((await call('/api/pair', { body: { code } })).status).toBe(404)
  })

  it('pauses pairing for everyone and spends every code after 5 wrong attempts', async () => {
    const phone = await newPhone()
    const code = await pairingCode(phone.cookie)
    const wrong = code === '000000' ? '000001' : '000000'
    for (let i = 0; i < 4; i++) expect((await call('/api/pair', { body: { code: wrong } })).status).toBe(404)
    const fifth = await call('/api/pair', { body: { code: wrong } })
    expect(fifth.status).toBe(429)
    const { paused_until } = (await fifth.json()) as { paused_until: number }
    expect(paused_until - Date.now()).toBeGreaterThan(14 * 60_000)

    expect((await call('/api/pair', { body: { code } })).status).toBe(429)
    expect((await call('/api/pairing-codes', { cookie: phone.cookie, body: {} })).status).toBe(429)

    // After the pause the old code stays spent; a new one works.
    await env.DB.prepare('UPDATE pairing_guard SET paused_until = 0').run()
    expect((await call('/api/pair', { body: { code } })).status).toBe(404)
    expect((await call('/api/pair', { body: { code: await pairingCode(phone.cookie) } })).status).toBe(200)
  })

  it('allows at most 5 wrong guesses even when they arrive at the same time', async () => {
    const phone = await newPhone()
    const code = await pairingCode(phone.cookie)
    const wrong = code === '000000' ? '000001' : '000000'
    const results = await Promise.all(
      Array.from({ length: 12 }, () => call('/api/pair', { body: { code: wrong } }).then((r) => r.status)),
    )
    expect(results.filter((s) => s === 404).length).toBeLessThanOrEqual(4)
    expect(results.filter((s) => s === 429).length).toBeGreaterThanOrEqual(8)
  })

  it('answers 429 during a pause whatever is typed', async () => {
    await env.DB.prepare('UPDATE pairing_guard SET paused_until = ?').bind(Date.now() + 60_000).run()
    for (const code of ['123', '1234567', 'abcdef']) {
      expect((await call('/api/pair', { body: { code } })).status).toBe(429)
    }
  })

  it('pairs with the phone holding the code now, even when the same digits were spent earlier at the same moment', async () => {
    const earlier = await newPhone()
    const holder = await newPhone()
    const running = ((await (await call('/api/sessions', { cookie: holder.cookie, body: {} })).json()) as { session: { session_id: number } }).session
    const code = '424242'
    const at = Date.now()
    const hash = await sha256(code)
    // Another learner's phone held these digits before, spent at `at`; the holder's code is in force now.
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO pairing_codes (code_hash, device_id, created_at, expires_at, spent_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(hash, earlier.deviceId, at - 600_000, at - 300_000, at),
      env.DB.prepare('INSERT INTO pairing_codes (code_hash, device_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(
        hash,
        holder.deviceId,
        at,
        at + 300_000,
      ),
    ])
    const token = await pairWithCode(env.DB, code, at)
    expect(typeof token).toBe('string')
    const state = (await (await call('/api/state', { cookie: `__Host-koke=${token}` })).json()) as {
      read_only: boolean
      running: { session_id: number } | null
    }
    expect(state.read_only).toBe(true)
    expect(state.running?.session_id).toBe(running.session_id)
  })

  it('never has two codes in force with the same digits', async () => {
    const a = await newPhone()
    const b = await newPhone()
    const code = await pairingCode(a.cookie)
    // Force b onto the same digits: the index must refuse the duplicate.
    const dup = env.DB.prepare(
      'INSERT INTO pairing_codes (code_hash, device_id, created_at, expires_at) SELECT code_hash, ?, created_at, expires_at FROM pairing_codes WHERE device_id = ? AND spent_at IS NULL',
    ).bind(b.deviceId, a.deviceId)
    await expect(dup.run()).rejects.toThrow(/UNIQUE/)
    expect(code).toMatch(/^\d{6}$/)
  })
})

describe('revocation (A1)', () => {
  it('shuts out a revoked phone and every PC paired from it', async () => {
    const phone = await newPhone()
    const pc = await newPc(phone.cookie)
    await revoke.device(phone.deviceId)
    expect((await call('/api/state', { cookie: phone.cookie })).status).toBe(401)
    expect((await call('/api/state', { cookie: pc })).status).toBe(401)
  })

  it('revoking one PC leaves its phone and the other PCs signed in', async () => {
    const phone = await newPhone()
    const pcA = await newPc(phone.cookie)
    const pcB = await newPc(phone.cookie)
    const a = await env.DB.prepare("SELECT MIN(device_id) AS id FROM devices WHERE paired_from = ?")
      .bind(phone.deviceId)
      .first<{ id: number }>()
    await revoke.device(a!.id)
    expect((await call('/api/state', { cookie: pcA })).status).toBe(401)
    expect((await call('/api/state', { cookie: pcB })).status).toBe(200)
    expect((await call('/api/state', { cookie: phone.cookie })).status).toBe(200)
  })

  it('refuses a pairing code from a phone revoked after showing it', async () => {
    const phone = await newPhone()
    const code = await pairingCode(phone.cookie)
    await env.DB.prepare('UPDATE devices SET revoked_at = ? WHERE device_id = ?').bind(Date.now(), phone.deviceId).run()
    expect((await call('/api/pair', { body: { code } })).status).toBe(404)
  })

  it("deletes a revoked phone's push subscriptions", async () => {
    const phone = await newPhone()
    await env.DB.prepare(
      "INSERT INTO push_subscriptions (endpoint, user_id, device_id, p256dh, auth, created_at) VALUES ('https://push.test/1', ?, ?, 'k', 'a', 0)",
    )
      .bind(phone.userId, phone.deviceId)
      .run()
    await revoke.device(phone.deviceId)
    expect(await count('SELECT COUNT(*) AS n FROM push_subscriptions WHERE device_id = ?', phone.deviceId)).toBe(0)
  })

  it('refuses an invitation cancelled by revoking its user, even for a handoff that started earlier', async () => {
    const userId = await newUser()
    const code = await newInvitation(userId)
    const startedAt = Date.now() - 1000
    await revoke.user(userId)
    expect(await spendInvitation(env.DB, code, startedAt)).toBeNull()
  })

  it('revoking a user ends every device, pairing code and unused invitation, and a new invitation carries on', async () => {
    const phone = await newPhone()
    const pc = await newPc(phone.cookie)
    const code = await pairingCode(phone.cookie)
    const leaked = await newInvitation(phone.userId)
    // A running session with a second revision, which must survive the revocation untouched.
    const started = ((await (await call('/api/sessions', { cookie: phone.cookie, body: {} })).json()) as { session: { session_id: number } }).session
    await call(`/api/sessions/${started.session_id}/away`, { cookie: phone.cookie, body: { base_rev: 1, away_at: Date.now() } })
    // Another learner, signed in and holding an unused invitation, must not be touched.
    const bystander = await newPhone()
    const theirs = await newInvitation(bystander.userId)
    await revoke.user(phone.userId)

    expect((await call('/api/state', { cookie: phone.cookie })).status).toBe(401)
    expect((await call('/api/state', { cookie: pc })).status).toBe(401)
    expect((await call('/api/pair', { body: { code } })).status).toBe(404)
    expect((await call('/api/handoff', { body: { code: leaked } })).status).toBe(404)

    const again = await newPhone(phone.userId)
    const state = (await (await call('/api/state', { cookie: again.cookie })).json()) as { running: { session_id: number; rev: number } | null }
    expect(state.running).toMatchObject({ session_id: started.session_id, rev: 2 })

    expect((await call('/api/state', { cookie: bystander.cookie })).status).toBe(200)
    expect((await call('/api/handoff', { body: { code: theirs } })).status).toBe(200)
  })
})
