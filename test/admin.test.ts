import { describe, expect, it } from 'vitest'
import { addSubjects } from '../src/admin/sql.ts'
import { call, newPhone, newUser, runAdminSql } from './helpers.ts'

describe('starting subjects from the admin (A1)', () => {
  it('creates the given subjects for a new learner, top-level and in the order given', async () => {
    const userId = await newUser()
    await runAdminSql(addSubjects(userId, ['国語', "it's", '英語'], Date.now()))
    const phone = await newPhone(userId)
    const subjects = (await (await call('/api/subjects', { cookie: phone.cookie })).json()) as { name: string; parent_id: number | null }[]
    expect(subjects.map((s) => [s.name, s.parent_id])).toEqual([['国語', null], ["it's", null], ['英語', null]])
  })
})
