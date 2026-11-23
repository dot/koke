// The schema's own guarantees, written to D1 directly. The API checks most of these first, so
// only these tests notice if a migration drops a trigger.
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { newUser } from './helpers.ts'

const db = env.DB

async function subject(userId: number, parentId: number | null = null): Promise<number> {
  const row = await db
    .prepare('INSERT INTO subjects (user_id, parent_id, name, position, created_at) VALUES (?, ?, ?, 1, 0) RETURNING subject_id')
    .bind(userId, parentId, 's')
    .first<{ subject_id: number }>()
  return row!.subject_id
}

// A session row and its rev 1, as the API inserts them.
async function session(userId: number, { ended = false } = {}): Promise<number> {
  const row = await db.prepare('INSERT INTO sessions (user_id, created_at) VALUES (?, 1000) RETURNING session_id').bind(userId).first<{ session_id: number }>()
  await revision(row!.session_id, 1, userId, { ended_at: ended ? 2000 : null })
  return row!.session_id
}

type Fields = { subject_id?: number | null; ended_at?: number | null; deleted?: number }
function revision(sessionId: number, rev: number, userId: number, f: Fields = {}) {
  return db
    .prepare(
      `INSERT INTO session_revisions (session_id, rev, user_id, subject_id, started_at, ended_at, deleted, source, created_at)
       VALUES (?, ?, ?, ?, 1000, ?, ?, 'app', 1000)`,
    )
    .bind(sessionId, rev, userId, f.subject_id ?? null, f.ended_at ?? null, f.deleted ?? 0)
    .run()
}

const history = async (sessionId: number) =>
  (await db.prepare('SELECT rev, ended_at FROM session_revisions WHERE session_id = ? ORDER BY rev').bind(sessionId).all()).results

describe('session history is append-only', () => {
  it.each([
    ['update a session', 'UPDATE sessions SET created_at = 0 WHERE session_id = ?'],
    ['delete a session', 'DELETE FROM sessions WHERE session_id = ?'],
    ['replace a session', 'INSERT OR REPLACE INTO sessions (session_id, user_id, created_at) SELECT session_id, user_id, 0 FROM sessions WHERE session_id = ?'],
    ['update a revision', 'UPDATE session_revisions SET ended_at = 5000 WHERE session_id = ?'],
    ['delete a revision', 'DELETE FROM session_revisions WHERE session_id = ?'],
  ])('refuses to %s and leaves the history as it was', async (_, sql) => {
    const userId = await newUser()
    const id = await session(userId)
    await revision(id, 2, userId, { ended_at: 3000 })
    const before = await history(id)
    await expect(db.prepare(sql).bind(id).run()).rejects.toThrow(/append-only/)
    expect(await history(id)).toEqual(before)
  })
})

describe('revisions', () => {
  it("refuses a revision written by someone who does not own the session or the subject", async () => {
    const owner = await newUser()
    const other = await newUser()
    const id = await session(owner)
    await expect(revision(id, 2, other)).rejects.toThrow(/does not own the session/)
    await expect(revision(id, 2, owner, { subject_id: await subject(other) })).rejects.toThrow(/does not own the subject/)
    expect(await history(id)).toHaveLength(1)
  })

  it('ignores a stale revision without an error, before checking anything else', async () => {
    const owner = await newUser()
    const other = await newUser()
    const id = await session(owner)
    await revision(id, 2, owner)
    // rev 2 again, with another learner's subject: dropped silently, not failed.
    const r = await revision(id, 2, owner, { subject_id: await subject(other) })
    expect(r.meta.changes).toBe(0)
    expect(await history(id)).toHaveLength(2)
  })

  it('refuses to reopen an ended or deleted session', async () => {
    const userId = await newUser()
    const ended = await session(userId, { ended: true })
    await expect(revision(ended, 2, userId)).rejects.toThrow(/cannot be reopened/)
    const next = await session(userId)
    await revision(next, 2, userId, { deleted: 1 })
    await expect(revision(next, 3, userId)).rejects.toThrow(/cannot be reopened/)
  })
})

describe('only the latest session can run', () => {
  it('refuses a new session while the latest one is running or has no revisions', async () => {
    const userId = await newUser()
    await session(userId)
    await expect(db.prepare('INSERT INTO sessions (user_id, created_at) VALUES (?, 2000)').bind(userId).run()).rejects.toThrow(/not over/)

    const fresh = await newUser()
    await db.prepare('INSERT INTO sessions (user_id, created_at) VALUES (?, 1000)').bind(fresh).run()
    await expect(db.prepare('INSERT INTO sessions (user_id, created_at) VALUES (?, 2000)').bind(fresh).run()).rejects.toThrow(/not over/)
  })
})

describe('subjects', () => {
  it('refuses to change a subject\'s id or owner, or to replace it', async () => {
    const owner = await newUser()
    const other = await newUser()
    const id = await subject(owner)
    await expect(db.prepare('UPDATE subjects SET user_id = ? WHERE subject_id = ?').bind(other, id).run()).rejects.toThrow(/cannot change/)
    await expect(db.prepare('UPDATE subjects SET subject_id = ? WHERE subject_id = ?').bind(id + 1000, id).run()).rejects.toThrow(/cannot change/)
    await expect(
      db.prepare("INSERT OR REPLACE INTO subjects (subject_id, user_id, name, position, created_at) VALUES (?, ?, 'x', 1, 0)").bind(id, other).run(),
    ).rejects.toThrow(/cannot be replaced/)
  })

  it('keeps nesting one level deep and within one learner', async () => {
    const owner = await newUser()
    const other = await newUser()
    const math = await subject(owner)
    const one = await subject(owner, math)
    const english = await subject(owner)
    // Under a child, under another learner's subject, or a parent with children moved under another.
    await expect(subject(owner, one)).rejects.toThrow(/one level/)
    await expect(subject(owner, await subject(other))).rejects.toThrow(/another user/)
    await expect(db.prepare('UPDATE subjects SET parent_id = ? WHERE subject_id = ?').bind(english, math).run()).rejects.toThrow(/one level/)
  })
})
