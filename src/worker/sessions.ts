// Session writes (L2–L5) and the screen state. The schema's triggers keep revisions append-only,
// owned and ordered; this module adds the checks the schema leaves to the API (docs/api.md).

import { AWAY_THRESHOLD_MINUTES } from './constants.ts'

export type Session = {
  session_id: number
  rev: number
  subject_id: number | null
  recorded_at: number
  started_at: number
  ended_at: number | null
  away_at: number | null
  prompted_at: number | null
}

type Head = Session & { deleted: number }

export type Subject = { subject_id: number; parent_id: number | null; name: string }

export type WriteResult =
  | { kind: 'ok'; applied: boolean; session: Session }
  | { kind: 'not_found' }
  | { kind: 'conflict' }
  | { kind: 'bad_request' }

const HEAD_COLUMNS = `r.session_id, r.rev, r.subject_id, s.created_at AS recorded_at,
  r.started_at, r.ended_at, r.away_at, r.prompted_at, r.deleted`

const toSession = (h: Head): Session => ({
  session_id: h.session_id,
  rev: h.rev,
  subject_id: h.subject_id,
  recorded_at: h.recorded_at,
  started_at: h.started_at,
  ended_at: h.ended_at,
  away_at: h.away_at,
  prompted_at: h.prompted_at,
})

// The current revision of one of the learner's sessions, or null if it is not theirs.
async function head(db: D1Database, userId: number, sessionId: number): Promise<Head | null> {
  return db
    .prepare(
      `SELECT ${HEAD_COLUMNS}
       FROM sessions s JOIN session_revisions r ON r.session_id = s.session_id
       WHERE s.session_id = ? AND s.user_id = ?
       ORDER BY r.rev DESC LIMIT 1`,
    )
    .bind(sessionId, userId)
    .first<Head>()
}

const running = (h: Head) => h.ended_at === null && h.deleted === 0

async function ownsSubject(db: D1Database, userId: number, subjectId: number): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM subjects WHERE subject_id = ? AND user_id = ? AND deleted_at IS NULL')
    .bind(subjectId, userId)
    .first()
  return row !== null
}

type Patch = Partial<Pick<Session, 'subject_id' | 'ended_at' | 'away_at'>>

// A new revision at base_rev + 1, copying the head and changing only `patch`. A stale base_rev is
// ignored by the schema (RAISE(IGNORE)), so the statement simply reports no change.
function appendRevision(db: D1Database, userId: number, sessionId: number, baseRev: number, patch: Patch, source: string, now: number) {
  const col = (name: keyof Patch) => (name in patch ? '?' : name)
  const values = (['subject_id', 'ended_at', 'away_at'] as const).filter((k) => k in patch).map((k) => patch[k] ?? null)
  return db
    .prepare(
      `INSERT INTO session_revisions
         (session_id, rev, user_id, subject_id, started_at, ended_at, away_at, prompted_at, deleted, source, created_at)
       SELECT session_id, rev + 1, user_id, ${col('subject_id')}, started_at, ${col('ended_at')}, ${col('away_at')},
              prompted_at, deleted, ?, ?
       FROM session_revisions WHERE session_id = ? AND rev = ? AND user_id = ?`,
    )
    .bind(...values, source, now, sessionId, baseRev, userId)
}

// Statements 2 and 3 of docs/api.md: the sessions row and its rev 1, as one batch.
// `afterStop` makes the new session conditional on the statement before it having applied.
function startStatements(db: D1Database, userId: number, subjectId: number | null, now: number, afterStop: boolean) {
  return [
    db
      .prepare(`INSERT INTO sessions (user_id, created_at) SELECT ?, ? ${afterStop ? 'WHERE changes() = 1' : ''}`)
      .bind(userId, now),
    db
      .prepare(
        `INSERT INTO session_revisions
           (session_id, rev, user_id, subject_id, started_at, ended_at, away_at, prompted_at, deleted, source, created_at)
         SELECT s.session_id, 1, s.user_id, ?, ?, NULL, NULL, NULL, 0, 'app', ?
         FROM sessions s
         WHERE s.session_id = (SELECT MAX(session_id) FROM sessions WHERE user_id = ?)
           AND s.created_at = ?
           AND NOT EXISTS (SELECT 1 FROM session_revisions WHERE session_id = s.session_id)`,
      )
      .bind(subjectId, now, now, userId, now),
  ]
}

async function latestHead(db: D1Database, userId: number): Promise<Head | null> {
  return db
    .prepare(
      `SELECT ${HEAD_COLUMNS}
       FROM sessions s JOIN session_revisions r ON r.session_id = s.session_id
       WHERE s.session_id = (SELECT MAX(session_id) FROM sessions WHERE user_id = ?)
       ORDER BY r.rev DESC LIMIT 1`,
    )
    .bind(userId)
    .first<Head>()
}

// POST /api/sessions (L2)
export async function start(db: D1Database, userId: number, subjectId: number | null, now: number): Promise<WriteResult> {
  if (subjectId !== null && !(await ownsSubject(db, userId, subjectId))) return { kind: 'not_found' }
  try {
    await db.batch(startStatements(db, userId, subjectId, now, false))
  } catch (e) {
    // The schema refuses a new session while the latest one is still running.
    if (String(e).includes('the previous session is not over')) return { kind: 'conflict' }
    throw e
  }
  return { kind: 'ok', applied: true, session: toSession((await latestHead(db, userId))!) }
}

// The writes on an existing, running session share their checks: it must be the caller's,
// still running (ending it twice would overwrite its end), and base_rev must be a number.
async function onRunning(
  db: D1Database,
  userId: number,
  sessionId: number,
  baseRev: unknown,
  write: (h: Head) => Promise<WriteResult | D1PreparedStatement>,
): Promise<WriteResult> {
  if (!Number.isSafeInteger(baseRev)) return { kind: 'bad_request' }
  const before = await head(db, userId, sessionId)
  if (!before) return { kind: 'not_found' }
  // A stale base_rev is answered with the head, never as a conflict (docs/api.md).
  if (before.rev !== baseRev) return { kind: 'ok', applied: false, session: toSession(before) }
  if (!running(before)) return { kind: 'conflict' }
  const next = await write(before)
  if ('kind' in next) return next
  const result = await next.run()
  return { kind: 'ok', applied: result.meta.changes === 1, session: toSession((await head(db, userId, sessionId))!) }
}

// POST /api/sessions/:id/stop (L4, and "not studying" in L5)
export function stop(db: D1Database, userId: number, sessionId: number, baseRev: unknown, endedAt: unknown, now: number) {
  return onRunning(db, userId, sessionId, baseRev, async (h) => {
    if (endedAt !== undefined && !Number.isSafeInteger(endedAt)) return { kind: 'bad_request' }
    const end = (endedAt as number | undefined) ?? now
    if (end > now) return { kind: 'bad_request' }
    // An end taken from a recorded moment (away_at) is raised to the start if a fix moved the start past it.
    return appendRevision(db, userId, sessionId, h.rev, { ended_at: Math.max(end, h.started_at) }, 'app', now)
  })
}

// POST /api/sessions/:id/away (L5). Only records the moment; never ends the session.
export function away(db: D1Database, userId: number, sessionId: number, baseRev: unknown, awayAt: unknown, now: number) {
  return onRunning(db, userId, sessionId, baseRev, async (h) => {
    if (!Number.isSafeInteger(awayAt) || (awayAt as number) > now) return { kind: 'bad_request' }
    return appendRevision(db, userId, sessionId, h.rev, { away_at: Math.max(awayAt as number, h.started_at) }, 'away', now)
  })
}

// POST /api/sessions/:id/subject (L3): a subject for an uncategorized running session, from its start.
export function pickSubject(db: D1Database, userId: number, sessionId: number, baseRev: unknown, subjectId: unknown, now: number) {
  return onRunning(db, userId, sessionId, baseRev, async (h) => {
    if (!Number.isSafeInteger(subjectId)) return { kind: 'bad_request' }
    if (!(await ownsSubject(db, userId, subjectId as number))) return { kind: 'not_found' }
    if (h.subject_id !== null) return { kind: 'conflict' }
    return appendRevision(db, userId, sessionId, h.rev, { subject_id: subjectId as number }, 'app', now)
  })
}

// POST /api/sessions/:id/switch (L3): stop this session and start one for another subject, in one batch.
export async function switchSubject(db: D1Database, userId: number, sessionId: number, baseRev: unknown, subjectId: unknown, now: number): Promise<WriteResult> {
  if (!Number.isSafeInteger(baseRev) || !Number.isSafeInteger(subjectId)) return { kind: 'bad_request' }
  const before = await head(db, userId, sessionId)
  if (!before) return { kind: 'not_found' }
  if (before.rev !== baseRev) return { kind: 'ok', applied: false, session: toSession(before) }
  if (!running(before)) return { kind: 'conflict' }
  if (!(await ownsSubject(db, userId, subjectId as number))) return { kind: 'not_found' }
  const [stopped] = await db.batch([
    appendRevision(db, userId, sessionId, before.rev, { ended_at: now }, 'app', now),
    ...startStatements(db, userId, subjectId as number, now, true),
  ])
  if (stopped.meta.changes !== 1) return { kind: 'ok', applied: false, session: toSession((await head(db, userId, sessionId))!) }
  return { kind: 'ok', applied: true, session: toSession((await latestHead(db, userId))!) }
}

// GET /api/state (#4): what the PWA needs to pick its screen.
export async function screenState(db: D1Database, userId: number) {
  const latest = await latestHead(db, userId)
  const { results: subjects } = await db
    .prepare(
      `SELECT c.subject_id, c.parent_id, c.name
       FROM subjects c LEFT JOIN subjects p ON p.subject_id = c.parent_id
       WHERE c.user_id = ? AND c.hidden = 0 AND c.deleted_at IS NULL AND (p.subject_id IS NULL OR p.hidden = 0)
       ORDER BY c.position`,
    )
    .bind(userId)
    .all<Subject>()
  // The last 20 sessions are plenty to find the last subject and keep rows read bounded.
  const last = await db
    .prepare(
      `SELECT r.subject_id
       FROM (SELECT session_id FROM sessions WHERE user_id = ? ORDER BY session_id DESC LIMIT 20) s
       JOIN session_revisions r ON r.session_id = s.session_id
         AND r.rev = (SELECT MAX(rev) FROM session_revisions WHERE session_id = s.session_id)
       WHERE r.subject_id IS NOT NULL AND r.deleted = 0
       ORDER BY s.session_id DESC LIMIT 1`,
    )
    .bind(userId)
    .first<{ subject_id: number }>()
  const current = latest && running(latest) ? toSession(latest) : null
  // `subjects` holds only what can be picked; the running session keeps its label even after its
  // subject or that subject's parent is hidden.
  const path =
    current?.subject_id == null
      ? null
      : await db
          .prepare(
            `SELECT p.name AS parent, c.name FROM subjects c LEFT JOIN subjects p ON p.subject_id = c.parent_id
             WHERE c.subject_id = ? AND c.user_id = ?`,
          )
          .bind(current.subject_id, userId)
          .first<{ parent: string | null; name: string }>()
  return {
    running: current,
    running_subject_path: path ? (path.parent === null ? [path.name] : [path.parent, path.name]) : null,
    subjects,
    last_subject_id: last?.subject_id ?? null,
    away_threshold_minutes: AWAY_THRESHOLD_MINUTES,
  }
}
