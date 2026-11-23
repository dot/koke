import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { call, newPc, newPhone } from './helpers.ts'

type Subject = { subject_id: number; parent_id: number | null; name: string; hidden: boolean; used: boolean }

async function send<T>(cookie: string, path: string, body: unknown, method = 'POST'): Promise<{ status: number; body: T }> {
  const res = await call(path, { cookie, body, method })
  return { status: res.status, body: (await res.json()) as T }
}

const add = (cookie: string, body: unknown) => send<Subject>(cookie, '/api/subjects', body)
const patch = (cookie: string, id: number, body: unknown) => send<Subject>(cookie, `/api/subjects/${id}`, body, 'PATCH')
const order = (cookie: string, ids: unknown) => send<Subject[]>(cookie, '/api/subjects/order', { subject_ids: ids }, 'PUT')
const list = async (cookie: string) => (await (await call('/api/subjects', { cookie })).json()) as Subject[]
const names = (subjects: { name: string }[]) => subjects.map((s) => s.name)
const remove = (cookie: string, id: number) => send<Subject[]>(cookie, `/api/subjects/${id}`, undefined, 'DELETE')
const state = async (cookie: string) => (await (await call('/api/state', { cookie })).json()) as { subjects: Subject[] }

// Starts a session for `subjectId` and returns its id. Corrections (L8) have no API yet, so
// `revise` appends the revision a fix or a deletion would write.
async function startWith(cookie: string, subjectId: number | null): Promise<number> {
  const res = await send<{ session: { session_id: number } }>(cookie, '/api/sessions', subjectId === null ? {} : { subject_id: subjectId })
  return res.body.session.session_id
}
async function revise(sessionId: number, subjectId: number | null, deleted: 0 | 1) {
  await env.DB.prepare(
    `INSERT INTO session_revisions (session_id, rev, user_id, subject_id, started_at, ended_at, deleted, source, created_at)
     SELECT session_id, rev + 1, user_id, ?, started_at, COALESCE(ended_at, started_at), ?, 'manual', started_at
     FROM session_revisions WHERE session_id = ? ORDER BY rev DESC LIMIT 1`,
  )
    .bind(subjectId, deleted, sessionId)
    .run()
}

describe('add a subject (L9)', () => {
  it('appends a top-level subject and a child to the end of the list', async () => {
    const phone = await newPhone()
    const math = (await add(phone.cookie, { name: ' 数学 ' })).body
    expect(math).toMatchObject({ name: '数学', parent_id: null, hidden: false })
    const one = await add(phone.cookie, { name: '数I', parent_id: math.subject_id })
    expect(one.status).toBe(200)
    expect(one.body.parent_id).toBe(math.subject_id)
    await add(phone.cookie, { name: '英語' })
    expect(names(await list(phone.cookie))).toEqual(['数学', '数I', '英語'])
  })

  it('refuses an empty name or one longer than 40 characters', async () => {
    const phone = await newPhone()
    expect((await add(phone.cookie, { name: '  ' })).status).toBe(400)
    expect((await add(phone.cookie, { name: 'あ'.repeat(41) })).status).toBe(400)
    expect((await add(phone.cookie, { name: 'あ'.repeat(40) })).status).toBe(200)
    expect((await add(phone.cookie, {})).status).toBe(400)
  })

  it("answers 404 for another learner's or an unknown parent, and 400 for one that is not an id", async () => {
    const phone = await newPhone()
    const other = await newPhone()
    const theirs = (await add(other.cookie, { name: 'theirs' })).body
    expect((await add(phone.cookie, { name: 'x', parent_id: theirs.subject_id })).status).toBe(404)
    expect((await add(phone.cookie, { name: 'x', parent_id: 999_999 })).status).toBe(404)
    expect((await add(phone.cookie, { name: 'x', parent_id: '1' })).status).toBe(400)
  })

  it('refuses to put a subject under a child, since subjects nest one level', async () => {
    const phone = await newPhone()
    const math = (await add(phone.cookie, { name: '数学' })).body
    const one = (await add(phone.cookie, { name: '数I', parent_id: math.subject_id })).body
    expect((await add(phone.cookie, { name: 'x', parent_id: one.subject_id })).status).toBe(400)
  })

  it('is refused on a PC, which only views', async () => {
    const phone = await newPhone()
    const math = (await add(phone.cookie, { name: '数学' })).body
    const pc = await newPc(phone.cookie)
    expect((await add(pc, { name: 'x' })).status).toBe(403)
    expect((await patch(pc, math.subject_id, { name: 'x' })).status).toBe(403)
    expect((await order(pc, [math.subject_id])).status).toBe(403)
  })

  it("lists only the learner's own subjects", async () => {
    const phone = await newPhone()
    const other = await newPhone()
    await add(other.cookie, { name: 'theirs' })
    expect(await list(phone.cookie)).toEqual([])
  })
})

describe('rename and hide a subject (L9)', () => {
  it('renames a subject', async () => {
    const phone = await newPhone()
    const math = (await add(phone.cookie, { name: '数学' })).body
    const { status, body } = await patch(phone.cookie, math.subject_id, { name: 'さんすう' })
    expect(status).toBe(200)
    expect(body).toMatchObject({ subject_id: math.subject_id, name: 'さんすう', hidden: false })
  })

  it('hides a subject from the start buttons but keeps it in the subject list', async () => {
    const phone = await newPhone()
    const math = (await add(phone.cookie, { name: '数学' })).body
    await add(phone.cookie, { name: '数I', parent_id: math.subject_id })
    await add(phone.cookie, { name: '英語' })
    expect((await patch(phone.cookie, math.subject_id, { hidden: true })).body.hidden).toBe(true)

    const state = (await (await call('/api/state', { cookie: phone.cookie })).json()) as { subjects: Subject[] }
    expect(names(state.subjects)).toEqual(['英語'])
    expect((await list(phone.cookie)).map((s) => [s.name, s.hidden])).toEqual([['数学', true], ['数I', false], ['英語', false]])

    await patch(phone.cookie, math.subject_id, { hidden: false })
    const shown = (await (await call('/api/state', { cookie: phone.cookie })).json()) as { subjects: Subject[] }
    expect(names(shown.subjects)).toEqual(['数学', '数I', '英語'])
  })

  it('keeps the label of the running session after its subject or its parent is hidden', async () => {
    const phone = await newPhone()
    const math = (await add(phone.cookie, { name: '数学' })).body
    const one = (await add(phone.cookie, { name: '数I', parent_id: math.subject_id })).body
    await call('/api/sessions', { cookie: phone.cookie, body: { subject_id: one.subject_id } })
    const label = async () =>
      ((await (await call('/api/state', { cookie: phone.cookie })).json()) as { running_subject_path: string[] | null }).running_subject_path
    expect(await label()).toEqual(['数学', '数I'])
    await patch(phone.cookie, math.subject_id, { hidden: true })
    expect(await label()).toEqual(['数学', '数I'])
    await patch(phone.cookie, one.subject_id, { hidden: true })
    expect(await label()).toEqual(['数学', '数I'])
  })

  it('refuses a change with nothing to change or a bad value', async () => {
    const phone = await newPhone()
    const math = (await add(phone.cookie, { name: '数学' })).body
    expect((await patch(phone.cookie, math.subject_id, {})).status).toBe(400)
    expect((await patch(phone.cookie, math.subject_id, { hidden: 1 })).status).toBe(400)
    expect((await patch(phone.cookie, math.subject_id, { name: '' })).status).toBe(400)
  })

  it("answers 404 for another learner's subject", async () => {
    const phone = await newPhone()
    const other = await newPhone()
    const theirs = (await add(other.cookie, { name: 'theirs' })).body
    expect((await patch(phone.cookie, theirs.subject_id, { name: 'mine' })).status).toBe(404)
    expect(names(await list(other.cookie))).toEqual(['theirs'])
  })
})

describe('reorder subjects (L9)', () => {
  it('puts the subjects in the order sent', async () => {
    const phone = await newPhone()
    const a = (await add(phone.cookie, { name: 'a' })).body.subject_id
    const b = (await add(phone.cookie, { name: 'b' })).body.subject_id
    const c = (await add(phone.cookie, { name: 'c' })).body.subject_id
    const { status, body } = await order(phone.cookie, [c, a, b])
    expect(status).toBe(200)
    expect(names(body)).toEqual(['c', 'a', 'b'])
    expect(names(await list(phone.cookie))).toEqual(['c', 'a', 'b'])
  })

  it('accepts an empty list from a learner with no subjects', async () => {
    const phone = await newPhone()
    const { status, body } = await order(phone.cookie, [])
    expect(status).toBe(200)
    expect(body).toEqual([])
  })

  it('refuses a list that misses, repeats or borrows a subject', async () => {
    const phone = await newPhone()
    const other = await newPhone()
    const a = (await add(phone.cookie, { name: 'a' })).body.subject_id
    const b = (await add(phone.cookie, { name: 'b' })).body.subject_id
    const theirs = (await add(other.cookie, { name: 'theirs' })).body.subject_id
    expect((await order(phone.cookie, [a])).status).toBe(400)
    expect((await order(phone.cookie, [a, a])).status).toBe(400)
    expect((await order(phone.cookie, [a, b, theirs])).status).toBe(400)
    expect((await order(phone.cookie, [a, theirs])).status).toBe(400)
    expect((await order(phone.cookie, 'a,b')).status).toBe(400)
    expect(names(await list(phone.cookie))).toEqual(['a', 'b'])
  })
})

describe('duplicate names (L9)', () => {
  it('refuses a name already used by a sibling, counting width, case, spaces and hidden subjects', async () => {
    const phone = await newPhone()
    await add(phone.cookie, { name: 'Math' })
    const hidden = (await add(phone.cookie, { name: '国語' })).body
    expect((await patch(phone.cookie, hidden.subject_id, { hidden: true })).body.hidden).toBe(true)
    for (const name of ['math', 'ＭＡＴＨ', ' Math ', '国語']) {
      expect((await add(phone.cookie, { name })).status).toBe(409)
    }
    expect(names(await list(phone.cookie))).toEqual(['Math', '国語'])
  })

  it('lets only one of two adds of the same name through when they arrive together', async () => {
    const phone = await newPhone()
    const results = await Promise.all([add(phone.cookie, { name: 'Math' }), add(phone.cookie, { name: 'ＭＡＴＨ' })])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    expect(await list(phone.cookie)).toHaveLength(1)
  })

  it('compares names only within one learner', async () => {
    const phone = await newPhone()
    const other = await newPhone()
    expect((await add(phone.cookie, { name: '数学' })).status).toBe(200)
    expect((await add(other.cookie, { name: '数学' })).status).toBe(200)
  })

  it('allows the same name under different parents', async () => {
    const phone = await newPhone()
    const math = (await add(phone.cookie, { name: '数学' })).body
    const english = (await add(phone.cookie, { name: '英語' })).body
    expect((await add(phone.cookie, { name: '演習', parent_id: math.subject_id })).status).toBe(200)
    expect((await add(phone.cookie, { name: '演習', parent_id: english.subject_id })).status).toBe(200)
    expect((await add(phone.cookie, { name: '演習' })).status).toBe(200)
  })

  it('refuses a rename onto a sibling, but not keeping its own name', async () => {
    const phone = await newPhone()
    const a = (await add(phone.cookie, { name: 'a' })).body
    await add(phone.cookie, { name: 'b' })
    expect((await patch(phone.cookie, a.subject_id, { name: 'B' })).status).toBe(409)
    expect((await patch(phone.cookie, a.subject_id, { name: 'A' })).status).toBe(200)
  })
})

describe('delete a subject (L9)', () => {
  it('deletes a subject no record uses, so it leaves every list and its name is free again', async () => {
    const phone = await newPhone()
    const math = (await add(phone.cookie, { name: '数学' })).body
    await add(phone.cookie, { name: '英語' })
    const { status, body } = await remove(phone.cookie, math.subject_id)
    expect(status).toBe(200)
    expect(names(body)).toEqual(['英語'])
    expect(names(await list(phone.cookie))).toEqual(['英語'])
    expect(names((await state(phone.cookie)).subjects)).toEqual(['英語'])
    expect((await add(phone.cookie, { name: '数学' })).status).toBe(200)
  })

  it('refuses to delete a subject a running or ended record uses, and reports it as used', async () => {
    const phone = await newPhone()
    const math = (await add(phone.cookie, { name: '数学' })).body
    await add(phone.cookie, { name: '英語' })
    const session = await startWith(phone.cookie, math.subject_id)
    expect((await remove(phone.cookie, math.subject_id)).status).toBe(409)
    const stopped = await send<{ applied: boolean; session: { ended_at: number | null } }>(phone.cookie, `/api/sessions/${session}/stop`, { base_rev: 1 })
    expect(stopped.body.applied).toBe(true)
    expect(stopped.body.session.ended_at).not.toBeNull()
    expect((await remove(phone.cookie, math.subject_id)).status).toBe(409)
    expect((await list(phone.cookie)).map((s) => [s.name, s.used])).toEqual([['数学', true], ['英語', false]])
  })

  it('answers one of two deletes arriving together with 404, not 409', async () => {
    const phone = await newPhone()
    const math = (await add(phone.cookie, { name: '数学' })).body
    const results = await Promise.all([remove(phone.cookie, math.subject_id), remove(phone.cookie, math.subject_id)])
    expect(results.map((r) => r.status).sort()).toEqual([200, 404])
  })

  it('deletes a subject that only a corrected-away or deleted record ever pointed at', async () => {
    const phone = await newPhone()
    const wrong = (await add(phone.cookie, { name: '間違い' })).body
    const right = (await add(phone.cookie, { name: '正しい' })).body
    const gone = (await add(phone.cookie, { name: '消した記録' })).body
    const fixed = await startWith(phone.cookie, wrong.subject_id)
    await revise(fixed, right.subject_id, 0)
    const deleted = await startWith(phone.cookie, gone.subject_id)
    await revise(deleted, gone.subject_id, 1)

    expect((await list(phone.cookie)).map((s) => [s.name, s.used])).toEqual([['間違い', false], ['正しい', true], ['消した記録', false]])
    expect((await remove(phone.cookie, wrong.subject_id)).status).toBe(200)
    expect((await remove(phone.cookie, gone.subject_id)).status).toBe(200)
    // The history still points at the deleted subjects; nothing was rewritten.
    const kept = await env.DB.prepare('SELECT COUNT(*) AS n FROM session_revisions WHERE subject_id IN (?, ?)')
      .bind(wrong.subject_id, gone.subject_id)
      .first<{ n: number }>()
    expect(kept!.n).toBe(3)
  })

  it('refuses to delete a parent while it has children', async () => {
    const phone = await newPhone()
    const math = (await add(phone.cookie, { name: '数学' })).body
    const one = (await add(phone.cookie, { name: '数I', parent_id: math.subject_id })).body
    expect((await remove(phone.cookie, math.subject_id)).status).toBe(409)
    expect((await remove(phone.cookie, one.subject_id)).status).toBe(200)
    expect((await remove(phone.cookie, math.subject_id)).status).toBe(200)
  })

  it('treats a deleted subject as gone everywhere', async () => {
    const phone = await newPhone()
    const math = (await add(phone.cookie, { name: '数学' })).body
    const english = (await add(phone.cookie, { name: '英語' })).body
    await remove(phone.cookie, math.subject_id)
    expect((await remove(phone.cookie, math.subject_id)).status).toBe(404)
    expect((await patch(phone.cookie, math.subject_id, { name: 'x' })).status).toBe(404)
    expect((await add(phone.cookie, { name: 'x', parent_id: math.subject_id })).status).toBe(404)
    expect((await send(phone.cookie, '/api/sessions', { subject_id: math.subject_id })).status).toBe(404)
    const session = await startWith(phone.cookie, english.subject_id)
    const sw = await send(phone.cookie, `/api/sessions/${session}/switch`, { base_rev: 1, subject_id: math.subject_id })
    expect(sw.status).toBe(404)
    expect((await order(phone.cookie, [english.subject_id])).status).toBe(200)
  })

  it("answers 404 for another learner's subject and 403 on a PC", async () => {
    const phone = await newPhone()
    const other = await newPhone()
    const theirs = (await add(other.cookie, { name: 'theirs' })).body
    expect((await remove(phone.cookie, theirs.subject_id)).status).toBe(404)
    const mine = (await add(phone.cookie, { name: 'mine' })).body
    expect((await remove(await newPc(phone.cookie), mine.subject_id)).status).toBe(403)
    expect(names(await list(other.cookie))).toEqual(['theirs'])
  })
})
