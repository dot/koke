import { describe, expect, it } from 'vitest'
import { subjectRows } from '../src/app/subjects.ts'

const s = (subject_id: number, name: string, parent_id: number | null = null) => ({ subject_id, parent_id, name })
// 国語, 数学 > 数I, 数A, 英語 in the learner's order.
const subjects = [s(1, '国語'), s(2, '数学'), s(3, '数I', 2), s(4, '数A', 2), s(5, '英語')]
const shape = (rows: ReturnType<typeof subjectRows>) => rows.map((r) => [r.parent.name, ...r.children.map((c) => c.name)])

describe('subject buttons (L2)', () => {
  it("puts each parent's children after it, in the learner's order", () => {
    expect(shape(subjectRows(subjects, null))).toEqual([['国語'], ['数学', '数I', '数A'], ['英語']])
  })

  it('moves the row holding the last subject used to the top, whether it was the parent or a child', () => {
    expect(shape(subjectRows(subjects, 5)).map((r) => r[0])).toEqual(['英語', '国語', '数学'])
    expect(shape(subjectRows(subjects, 4))[0]).toEqual(['数学', '数I', '数A'])
  })

  it('keeps the order when the last subject is no longer shown', () => {
    expect(shape(subjectRows(subjects, 99)).map((r) => r[0])).toEqual(['国語', '数学', '英語'])
  })
})
