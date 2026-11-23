import { describe, expect, it } from 'vitest'
import { call, newPc, newPhone } from './helpers.ts'

type Subject = { subject_id: number; parent_id: number | null; name: string; hidden: boolean }

async function send<T>(cookie: string, path: string, body: unknown, method = 'POST'): Promise<{ status: number; body: T }> {
  const res = await call(path, { cookie, body, method })
  return { status: res.status, body: (await res.json()) as T }
}

const add = (cookie: string, body: unknown) => send<Subject>(cookie, '/api/subjects', body)
const patch = (cookie: string, id: number, body: unknown) => send<Subject>(cookie, `/api/subjects/${id}`, body, 'PATCH')
const order = (cookie: string, ids: unknown) => send<Subject[]>(cookie, '/api/subjects/order', { subject_ids: ids }, 'PUT')
const list = async (cookie: string) => (await (await call('/api/subjects', { cookie })).json()) as Subject[]
const names = (subjects: { name: string }[]) => subjects.map((s) => s.name)

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
