import { env, exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { ORIGIN, call, newPc, newPhone } from './helpers.ts'

type Session = {
  session_id: number
  rev: number
  subject_id: number | null
  recorded_at: number
  started_at: number
  ended_at: number | null
  away_at: number | null
}
type Write = { applied: boolean; session: Session }

async function addSubject(userId: number, name: string, opts: { parent?: number; hidden?: boolean; position?: number } = {}) {
  const row = await env.DB.prepare(
    `INSERT INTO subjects (user_id, parent_id, name, position, hidden, created_at) VALUES (?, ?, ?, ?, ?, 0) RETURNING subject_id`,
  )
    .bind(userId, opts.parent ?? null, name, opts.position ?? 0, opts.hidden ? 1 : 0)
    .first<{ subject_id: number }>()
  return row!.subject_id
}

async function post<T = Write>(cookie: string, path: string, body: unknown): Promise<{ status: number; body: T }> {
  const res = await call(path, { cookie, body })
  return { status: res.status, body: (await res.json()) as T }
}

const start = (cookie: string, body: unknown = {}) => post(cookie, '/api/sessions', body)
const revisions = async (sessionId: number) =>
  (await env.DB.prepare('SELECT rev, source, ended_at, away_at, subject_id FROM session_revisions WHERE session_id = ? ORDER BY rev')
    .bind(sessionId)
    .all()).results

describe('start (L2)', () => {
  it('starts an uncategorized session', async () => {
    const phone = await newPhone()
    const { status, body } = await start(phone.cookie)
    expect(status).toBe(200)
    expect(body.session).toMatchObject({ rev: 1, subject_id: null, ended_at: null, away_at: null })
    expect(body.session.recorded_at).toBe(body.session.started_at)
  })

  it('starts a session for one of the learner\'s subjects', async () => {
    const phone = await newPhone()
    const math = await addSubject(phone.userId, 'math')
    expect((await start(phone.cookie, { subject_id: math })).body.session.subject_id).toBe(math)
  })

  it('refuses to start while a session is running', async () => {
    const phone = await newPhone()
    await start(phone.cookie)
    expect((await start(phone.cookie)).status).toBe(409)
  })

  it("answers 404 for another learner's subject", async () => {
    const phone = await newPhone()
    const other = await newPhone()
    const theirs = await addSubject(other.userId, 'theirs')
    expect((await start(phone.cookie, { subject_id: theirs })).status).toBe(404)
  })

  it('refuses a body that is not a JSON object instead of starting a session', async () => {
    const phone = await newPhone()
    expect((await start(phone.cookie, 'start')).status).toBe(400)
    expect((await call('/api/state', { cookie: phone.cookie }).then((r) => r.json()) as { running: unknown }).running).toBeNull()
  })
})

describe('stop (L4)', () => {
  it('ends the session now', async () => {
    const phone = await newPhone()
    const { session } = (await start(phone.cookie)).body
    const { status, body } = await post(phone.cookie, `/api/sessions/${session.session_id}/stop`, { base_rev: 1 })
    expect(status).toBe(200)
    expect(body.applied).toBe(true)
    expect(body.session.rev).toBe(2)
    expect(body.session.ended_at).toBeGreaterThanOrEqual(session.started_at)
  })

  it('records a double-fired stop once', async () => {
    const phone = await newPhone()
    const { session } = (await start(phone.cookie)).body
    const path = `/api/sessions/${session.session_id}/stop`
    const [a, b] = await Promise.all([post(phone.cookie, path, { base_rev: 1 }), post(phone.cookie, path, { base_rev: 1 })])
    expect([a.body.applied, b.body.applied].sort()).toEqual([false, true])
    expect(await revisions(session.session_id)).toHaveLength(2)
  })

  it('does not move the end of a session that already ended', async () => {
    const phone = await newPhone()
    const { session } = (await start(phone.cookie)).body
    await post(phone.cookie, `/api/sessions/${session.session_id}/stop`, { base_rev: 1 })
    expect((await post(phone.cookie, `/api/sessions/${session.session_id}/stop`, { base_rev: 2 })).status).toBe(409)
  })

  it('ends at the moment koke went away when the learner was not studying (L5)', async () => {
    const phone = await newPhone()
    const { session } = (await start(phone.cookie)).body
    const awayAt = session.started_at + 1
    await post(phone.cookie, `/api/sessions/${session.session_id}/away`, { base_rev: 1, away_at: awayAt })
    const { body } = await post(phone.cookie, `/api/sessions/${session.session_id}/stop`, { base_rev: 2, ended_at: awayAt })
    expect(body.session.ended_at).toBe(awayAt)
  })

  it('refuses an end in the future', async () => {
    const phone = await newPhone()
    const { session } = (await start(phone.cookie)).body
    const res = await post(phone.cookie, `/api/sessions/${session.session_id}/stop`, { base_rev: 1, ended_at: Date.now() + 60_000 })
    expect(res.status).toBe(400)
  })

  it("answers 404 for another learner's session", async () => {
    const phone = await newPhone()
    const other = await newPhone()
    const { session } = (await start(other.cookie)).body
    expect((await post(phone.cookie, `/api/sessions/${session.session_id}/stop`, { base_rev: 1 })).status).toBe(404)
    expect(await revisions(session.session_id)).toHaveLength(1)
  })

  it('refuses writes from a PC', async () => {
    const phone = await newPhone()
    const pc = await newPc(phone.cookie)
    expect((await call('/api/sessions', { cookie: pc, body: {} })).status).toBe(403)
  })
})

describe('away (L5)', () => {
  it('never ends a session, however often the phone goes away', async () => {
    const phone = await newPhone()
    const { session } = (await start(phone.cookie)).body
    let rev = 1
    for (let i = 0; i < 3; i++) {
      const { body } = await post(phone.cookie, `/api/sessions/${session.session_id}/away`, { base_rev: rev, away_at: Date.now() })
      expect(body.applied).toBe(true)
      expect(body.session.ended_at).toBeNull()
      rev = body.session.rev
    }
    const state = await call('/api/state', { cookie: phone.cookie })
    expect(((await state.json()) as { running: Session }).running.session_id).toBe(session.session_id)
  })

  it('accepts the text/plain body sendBeacon sends', async () => {
    const phone = await newPhone()
    const { session } = (await start(phone.cookie)).body
    const raw = await exports.default.fetch(
      new Request(`${ORIGIN}/api/sessions/${session.session_id}/away`, {
        method: 'POST',
        headers: { Cookie: phone.cookie, Origin: ORIGIN, 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ base_rev: 1, away_at: Date.now() }),
      }),
    )
    expect(raw.status).toBe(200)
    expect(((await raw.json()) as Write).session.away_at).not.toBeNull()
  })
})

describe('subject (L3)', () => {
  it('gives an uncategorized running session a subject from its start', async () => {
    const phone = await newPhone()
    const math = await addSubject(phone.userId, 'math')
    const { session } = (await start(phone.cookie)).body
    const { body } = await post(phone.cookie, `/api/sessions/${session.session_id}/subject`, { base_rev: 1, subject_id: math })
    expect(body.session).toMatchObject({ subject_id: math, started_at: session.started_at, ended_at: null })
  })

  it('answers a stale base_rev with the head, and a session with a subject with 409', async () => {
    const phone = await newPhone()
    const math = await addSubject(phone.userId, 'math')
    const { session } = (await start(phone.cookie)).body
    const path = `/api/sessions/${session.session_id}/subject`
    await post(phone.cookie, path, { base_rev: 1, subject_id: math })
    const stale = await post(phone.cookie, path, { base_rev: 1, subject_id: math })
    expect(stale.status).toBe(200)
    expect(stale.body).toMatchObject({ applied: false, session: { rev: 2 } })
    expect((await post(phone.cookie, path, { base_rev: 2, subject_id: math })).status).toBe(409)
  })
})

describe('switch (L3)', () => {
  it('ends this session now and starts one for the new subject', async () => {
    const phone = await newPhone()
    const math = await addSubject(phone.userId, 'math')
    const english = await addSubject(phone.userId, 'english')
    const { session } = (await start(phone.cookie, { subject_id: math })).body
    const { body } = await post(phone.cookie, `/api/sessions/${session.session_id}/switch`, { base_rev: 1, subject_id: english })
    expect(body.applied).toBe(true)
    expect(body.session).toMatchObject({ rev: 1, subject_id: english, ended_at: null })
    expect(body.session.session_id).not.toBe(session.session_id)
    const old = await revisions(session.session_id)
    expect(old[1]).toMatchObject({ rev: 2, source: 'app' })
    expect(old[1].ended_at).toBe(body.session.started_at)
  })

  it('lets exactly one of a stop and a switch with the same base_rev take effect', async () => {
    const phone = await newPhone()
    const math = await addSubject(phone.userId, 'math')
    const english = await addSubject(phone.userId, 'english')
    const { session } = (await start(phone.cookie, { subject_id: math })).body
    const [stopped, switched] = await Promise.all([
      post(phone.cookie, `/api/sessions/${session.session_id}/stop`, { base_rev: 1 }),
      post(phone.cookie, `/api/sessions/${session.session_id}/switch`, { base_rev: 1, subject_id: english }),
    ])
    expect([stopped.body.applied, switched.body.applied].filter(Boolean)).toHaveLength(1)
    const { n } = (await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').bind(phone.userId).first<{ n: number }>())!
    const state = (await (await call('/api/state', { cookie: phone.cookie })).json()) as { running: Session | null }
    const old = (await revisions(session.session_id)) as { rev: number; ended_at: number | null }[]
    expect(old).toHaveLength(2)
    if (stopped.body.applied) {
      expect(n).toBe(1)
      expect(state.running).toBeNull()
    } else {
      expect(n).toBe(2)
      expect(state.running).toMatchObject({ subject_id: english, started_at: old[1].ended_at })
    }
  })

  it("answers 404 for another learner's subject and leaves the session running", async () => {
    const phone = await newPhone()
    const other = await newPhone()
    const theirs = await addSubject(other.userId, 'theirs')
    const { session } = (await start(phone.cookie)).body
    const res = await post(phone.cookie, `/api/sessions/${session.session_id}/switch`, { base_rev: 1, subject_id: theirs })
    expect(res.status).toBe(404)
    expect(await revisions(session.session_id)).toHaveLength(1)
    const state = (await (await call('/api/state', { cookie: phone.cookie })).json()) as { running: Session | null }
    expect(state.running?.session_id).toBe(session.session_id)
  })

  it('answers a stale base_rev with the head before looking at the subject', async () => {
    const phone = await newPhone()
    const math = await addSubject(phone.userId, 'math')
    const other = await newPhone()
    const theirs = await addSubject(other.userId, 'theirs')
    const { session } = (await start(phone.cookie, { subject_id: math })).body
    await post(phone.cookie, `/api/sessions/${session.session_id}/away`, { base_rev: 1, away_at: Date.now() })
    const { status, body } = await post(phone.cookie, `/api/sessions/${session.session_id}/switch`, { base_rev: 1, subject_id: theirs })
    expect(status).toBe(200)
    expect(body).toMatchObject({ applied: false, session: { rev: 2 } })
  })
})

describe('screen state (#4)', () => {
  it('shows the running session, the visible subjects in order and the last subject used', async () => {
    const phone = await newPhone()
    const math = await addSubject(phone.userId, 'math', { position: 1 })
    const algebra = await addSubject(phone.userId, 'algebra', { parent: math, position: 2 })
    const art = await addSubject(phone.userId, 'art', { position: 0, hidden: true })
    await addSubject(phone.userId, 'drawing', { parent: art, position: 3 })
    const { session } = (await start(phone.cookie, { subject_id: algebra })).body
    await post(phone.cookie, `/api/sessions/${session.session_id}/stop`, { base_rev: 1 })
    const running = (await start(phone.cookie)).body.session

    const state = (await (await call('/api/state', { cookie: phone.cookie })).json()) as Record<string, unknown>
    expect(state).toMatchObject({
      read_only: false,
      running: { session_id: running.session_id, subject_id: null },
      subjects: [
        { subject_id: math, parent_id: null, name: 'math' },
        { subject_id: algebra, parent_id: math, name: 'algebra' },
      ],
      last_subject_id: algebra,
      away_threshold_minutes: 30,
    })
  })

  it('shows nothing running once the session ends', async () => {
    const phone = await newPhone()
    const { session } = (await start(phone.cookie)).body
    await post(phone.cookie, `/api/sessions/${session.session_id}/stop`, { base_rev: 1 })
    const state = (await (await call('/api/state', { cookie: phone.cookie })).json()) as Record<string, unknown>
    expect(state).toMatchObject({ running: null, last_subject_id: null })
  })
})
