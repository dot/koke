import { describe, expect, it } from 'vitest'
import { nameKey } from '../src/shared/subject-name.ts'

describe('subject name key (L9)', () => {
  it('treats spaces, full- and half-width forms and letter case as the same name', () => {
    expect(nameKey(' Math ')).toBe(nameKey('math'))
    expect(nameKey('ＭＡＴＨ')).toBe(nameKey('math'))
    expect(nameKey('ｽｳｶﾞｸ')).toBe(nameKey('スウガク'))
    expect(nameKey('数学１')).toBe(nameKey('数学1'))
  })

  it('keeps different names apart', () => {
    expect(nameKey('数学')).not.toBe(nameKey('数学I'))
    expect(nameKey('すうがく')).not.toBe(nameKey('スウガク'))
  })
})
