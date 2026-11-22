import type { Subject } from './api.ts'

export type Row = { parent: Subject; children: Subject[] }

// One row per parent with its children after it (L2). `subjects` are the visible ones in the
// learner's order, as GET /api/state sends them. The row holding `lastSubjectId` comes first.
export function subjectRows(subjects: Subject[], lastSubjectId: number | null): Row[] {
  const rows = subjects
    .filter((s) => s.parent_id === null)
    .map((parent) => ({ parent, children: subjects.filter((c) => c.parent_id === parent.subject_id) }))
  const last = rows.findIndex(
    (r) => r.parent.subject_id === lastSubjectId || r.children.some((c) => c.subject_id === lastSubjectId),
  )
  if (last > 0) rows.unshift(...rows.splice(last, 1))
  return rows
}

// "数学 › 数I" for a child, the name alone for a parent.
export function subjectPath(subjects: Subject[], subjectId: number): string {
  const s = subjects.find((x) => x.subject_id === subjectId)
  if (!s) return ''
  const parent = s.parent_id === null ? undefined : subjects.find((x) => x.subject_id === s.parent_id)
  return parent ? `${parent.name} › ${s.name}` : s.name
}
