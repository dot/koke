// A learner's subject list (L9). Subjects are settings, edited in place; the schema's triggers keep
// owners fixed and nesting one level deep, and this module turns those cases into 400 / 404 first.
// A deleted subject is a tombstone (deleted_at set) that every query here treats as absent.

import { nameKey } from '../shared/subject-name.ts'
import { SUBJECT_NAME_MAX } from './constants.ts'

export type SubjectRow = { subject_id: number; parent_id: number | null; name: string; hidden: boolean; used: boolean }

export type SubjectResult<T> = { kind: 'ok'; body: T } | { kind: 'not_found' } | { kind: 'bad_request' } | { kind: 'conflict' }

type Row = Omit<SubjectRow, 'hidden' | 'used'> & { hidden: number; used: number }

// Used means the current revision of a session that is not deleted points at the subject. Old
// revisions are history: a subject picked by mistake and then corrected away is not used.
const USED = `EXISTS (SELECT 1 FROM session_revisions r
  WHERE r.subject_id = subjects.subject_id AND r.deleted = 0
    AND r.rev = (SELECT MAX(rev) FROM session_revisions WHERE session_id = r.session_id))`
const COLUMNS = `subject_id, parent_id, name, hidden, ${USED} AS used`
const toRow = (r: Row): SubjectRow => ({ ...r, hidden: r.hidden === 1, used: r.used === 1 })

// Trimmed, 1 to SUBJECT_NAME_MAX characters (code points, so a kanji counts as one).
function subjectName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim()
  const length = [...name].length
  return length >= 1 && length <= SUBJECT_NAME_MAX ? name : null
}

// Names are unique among siblings (the same parent, or both top-level); hidden subjects count.
async function nameTaken(db: D1Database, userId: number, parentId: number | null, name: string, except: number | null) {
  const { results } = await db
    .prepare('SELECT subject_id, name FROM subjects WHERE user_id = ? AND parent_id IS ? AND deleted_at IS NULL')
    .bind(userId, parentId)
    .all<{ subject_id: number; name: string }>()
  return results.some((s) => s.subject_id !== except && nameKey(s.name) === nameKey(name))
}

export async function listSubjects(db: D1Database, userId: number): Promise<SubjectRow[]> {
  const { results } = await db
    .prepare(`SELECT ${COLUMNS} FROM subjects WHERE user_id = ? AND deleted_at IS NULL ORDER BY position, subject_id`)
    .bind(userId)
    .all<Row>()
  return results.map(toRow)
}

export async function addSubject(db: D1Database, userId: number, body: Record<string, unknown>, now: number): Promise<SubjectResult<SubjectRow>> {
  const name = subjectName(body.name)
  const parentId = body.parent_id ?? null
  if (name === null || (parentId !== null && !Number.isSafeInteger(parentId))) return { kind: 'bad_request' }
  if (parentId !== null) {
    const parent = await db
      .prepare('SELECT parent_id FROM subjects WHERE subject_id = ? AND user_id = ? AND deleted_at IS NULL')
      .bind(parentId, userId)
      .first<{ parent_id: number | null }>()
    if (!parent) return { kind: 'not_found' }
    if (parent.parent_id !== null) return { kind: 'bad_request' }
  }
  if (await nameTaken(db, userId, parentId as number | null, name, null)) return { kind: 'conflict' }
  const row = await db
    .prepare(
      `INSERT INTO subjects (user_id, parent_id, name, position, created_at)
       SELECT ?1, ?2, ?3, COALESCE(MAX(position), 0) + 1, ?4 FROM subjects WHERE user_id = ?1
       RETURNING ${COLUMNS}`,
    )
    .bind(userId, parentId, name, now)
    .first<Row>()
  return { kind: 'ok', body: toRow(row!) }
}

export async function changeSubject(db: D1Database, userId: number, subjectId: number, body: Record<string, unknown>): Promise<SubjectResult<SubjectRow>> {
  const sets: string[] = []
  const values: unknown[] = []
  let name: string | null = null
  if ('name' in body) {
    name = subjectName(body.name)
    if (name === null) return { kind: 'bad_request' }
    sets.push('name = ?')
    values.push(name)
  }
  if ('hidden' in body) {
    if (typeof body.hidden !== 'boolean') return { kind: 'bad_request' }
    sets.push('hidden = ?')
    values.push(body.hidden ? 1 : 0)
  }
  if (sets.length === 0) return { kind: 'bad_request' }
  const current = await db
    .prepare('SELECT parent_id FROM subjects WHERE subject_id = ? AND user_id = ? AND deleted_at IS NULL')
    .bind(subjectId, userId)
    .first<{ parent_id: number | null }>()
  if (!current) return { kind: 'not_found' }
  if (name !== null && (await nameTaken(db, userId, current.parent_id, name, subjectId))) return { kind: 'conflict' }
  const row = await db
    .prepare(`UPDATE subjects SET ${sets.join(', ')} WHERE subject_id = ? AND user_id = ? AND deleted_at IS NULL RETURNING ${COLUMNS}`)
    .bind(...values, subjectId, userId)
    .first<Row>()
  return row ? { kind: 'ok', body: toRow(row) } : { kind: 'not_found' }
}

// The list must name every subject of the learner exactly once, so no subject is left at a stale
// position and no other learner's subject can be touched.
export async function reorderSubjects(db: D1Database, userId: number, ids: unknown): Promise<SubjectResult<SubjectRow[]>> {
  if (!Array.isArray(ids) || !ids.every((id) => Number.isSafeInteger(id))) return { kind: 'bad_request' }
  const current = await listSubjects(db, userId)
  const mine = new Set(current.map((s) => s.subject_id))
  if (ids.length !== mine.size || new Set(ids).size !== ids.length || !ids.every((id) => mine.has(id))) {
    return { kind: 'bad_request' }
  }
  // D1 refuses an empty batch; a learner with no subjects has nothing to reorder.
  if (ids.length === 0) return { kind: 'ok', body: [] }
  await db.batch(
    ids.map((id, i) => db.prepare('UPDATE subjects SET position = ? WHERE subject_id = ? AND user_id = ?').bind(i + 1, id, userId)),
  )
  return { kind: 'ok', body: await listSubjects(db, userId) }
}

// Only a subject no current record uses, and with no children left, can go. Its row stays so old
// revisions keep pointing at a real subject.
export async function deleteSubject(db: D1Database, userId: number, subjectId: number, now: number): Promise<SubjectResult<SubjectRow[]>> {
  const target = await db
    .prepare(
      `SELECT ${USED} AS used,
         EXISTS (SELECT 1 FROM subjects c WHERE c.parent_id = subjects.subject_id AND c.deleted_at IS NULL) AS has_children
       FROM subjects WHERE subject_id = ? AND user_id = ? AND deleted_at IS NULL`,
    )
    .bind(subjectId, userId)
    .first<{ used: number; has_children: number }>()
  if (!target) return { kind: 'not_found' }
  if (target.used === 1 || target.has_children === 1) return { kind: 'conflict' }
  // Checked again in the write itself, so a session started with this subject in between keeps it.
  const done = await db
    .prepare(
      `UPDATE subjects SET deleted_at = ? WHERE subject_id = ? AND user_id = ? AND deleted_at IS NULL AND NOT ${USED}
         AND NOT EXISTS (SELECT 1 FROM subjects c WHERE c.parent_id = subjects.subject_id AND c.deleted_at IS NULL)`,
    )
    .bind(now, subjectId, userId)
    .run()
  if (done.meta.changes !== 1) return { kind: 'conflict' }
  return { kind: 'ok', body: await listSubjects(db, userId) }
}
