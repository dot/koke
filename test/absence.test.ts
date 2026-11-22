import { describe, expect, it } from 'vitest'
import { absenceToAsk } from '../src/app/absence.ts'

const MIN = 60_000
const running = (away_at: number | null) => ({ away_at })

describe('absenceToAsk (L5)', () => {
  const now = 100 * MIN

  it('asks after an absence of at least the threshold, in whole minutes', () => {
    expect(absenceToAsk(running(now - 30 * MIN), null, now, 30)).toBe(30)
    expect(absenceToAsk(running(now - 47.9 * MIN), null, now, 30)).toBe(47)
  })

  it('never asks about a shorter absence', () => {
    expect(absenceToAsk(running(now - 29.9 * MIN), null, now, 30)).toBeNull()
  })

  it('judges each absence once, so reopening later does not ask about an old one', () => {
    const away = now - 10 * MIN
    expect(absenceToAsk(running(away), away, now + 60 * MIN, 30)).toBeNull()
  })

  it('asks nothing when no session is running or it never went away', () => {
    expect(absenceToAsk(null, null, now, 30)).toBeNull()
    expect(absenceToAsk(running(null), null, now, 30)).toBeNull()
  })
})
