// A learner's subject list (L9). Subjects are settings, edited in place; the schema's triggers keep
// owners fixed and nesting one level deep, and this module turns those cases into 400 / 404 first.

import { SUBJECT_NAME_MAX } from './constants.ts'

export type SubjectRow = { subject_id: number; parent_id: number | null; name: string; hidden: boolean }

export type SubjectResult<T> = { kind: 'ok'; body: T } | { kind: 'not_found' } | { kind: 'bad_request' }

const COLUMNS = 'subject_id, parent_id, name, hidden'
const toRow = (r: Omit<SubjectRow, 'hidden'> & { hidden: number }): SubjectRow => ({ ...r, hidden: r.hidden === 1 })

// Trimmed, 1 to SUBJECT_NAME_MAX characters (code points, so a kanji counts as one).
function subjectName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim()
  const length = [...name].length
  return length >= 1 && length <= SUBJECT_NAME_MAX ? name : null
}

export async function listSubjects(db: D1Database, userId: number): Promise<SubjectRow[]> {
  const { results } = await db
    .prepare(`SELECT ${COLUMNS} FROM subjects WHERE user_id = ? ORDER BY position, subject_id`)
    .bind(userId)
    .all<Omit<SubjectRow, 'hidden'> & { hidden: number }>()
  return results.map(toRow)
}

export async function addSubject(db: D1Database, userId: number, body: Record<string, unknown>, now: number): Promise<SubjectResult<SubjectRow>> {
  const name = subjectName(body.name)
  const parentId = body.parent_id ?? null
  if (name === null || (parentId !== null && !Number.isSafeInteger(parentId))) return { kind: 'bad_request' }
  if (parentId !== null) {
    const parent = await db
      .prepare('SELECT parent_id FROM subjects WHERE subject_id = ? AND user_id = ?')
      .bind(parentId, userId)
      .first<{ parent_id: number | null }>()
    if (!parent) return { kind: 'not_found' }
    if (parent.parent_id !== null) return { kind: 'bad_request' }
  }
  const row = await db
    .prepare(
      `INSERT INTO subjects (user_id, parent_id, name, position, created_at)
       SELECT ?1, ?2, ?3, COALESCE(MAX(position), 0) + 1, ?4 FROM subjects WHERE user_id = ?1
       RETURNING ${COLUMNS}`,
    )
    .bind(userId, parentId, name, now)
    .first<Omit<SubjectRow, 'hidden'> & { hidden: number }>()
  return { kind: 'ok', body: toRow(row!) }
}

export async function changeSubject(db: D1Database, userId: number, subjectId: number, body: Record<string, unknown>): Promise<SubjectResult<SubjectRow>> {
  const sets: string[] = []
  const values: unknown[] = []
  if ('name' in body) {
    const name = subjectName(body.name)
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
  const row = await db
    .prepare(`UPDATE subjects SET ${sets.join(', ')} WHERE subject_id = ? AND user_id = ? RETURNING ${COLUMNS}`)
    .bind(...values, subjectId, userId)
    .first<Omit<SubjectRow, 'hidden'> & { hidden: number }>()
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
