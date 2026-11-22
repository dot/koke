import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import { INVITATION_TTL } from '../src/worker/constants.ts'
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
    expect(await state.json()).toEqual({ read_only: false })
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

  it('tells the learner to ask for a new link when the invitation is spent', async () => {
    const code = await newInvitation(await newUser())
    await call('/api/handoff', { body: { code } })
    const page = await call(`/invite/${code}`)
    expect(page.status).toBe(404)
    expect(await page.text()).toContain('管理者に新しいリンク')
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
    const code = await newInvitation(await newUser())
    expect((await call('/api/handoff', { origin: 'https://evil.test', body: { code } })).status).toBe(403)
  })
})

describe('PC pairing (L7)', () => {
  it('pairs a PC that can read but not write', async () => {
    const phone = await newPhone()
    const pc = await newPc(phone.cookie)
    const state = await call('/api/state', { cookie: pc })
    expect(await state.json()).toEqual({ read_only: true })
    expect((await call('/api/pairing-codes', { cookie: pc, body: {} })).status).toBe(403)
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

  it('revoking a user ends every device, pairing code and unused invitation, and a new invitation carries on', async () => {
    const phone = await newPhone()
    const pc = await newPc(phone.cookie)
    const code = await pairingCode(phone.cookie)
    const leaked = await newInvitation(phone.userId)
    await revoke.user(phone.userId)

    expect((await call('/api/state', { cookie: phone.cookie })).status).toBe(401)
    expect((await call('/api/state', { cookie: pc })).status).toBe(401)
    expect((await call('/api/pair', { body: { code } })).status).toBe(404)
    expect((await call('/api/handoff', { body: { code: leaked } })).status).toBe(404)

    const again = await newPhone(phone.userId)
    expect((await call('/api/state', { cookie: again.cookie })).status).toBe(200)
  })
})
