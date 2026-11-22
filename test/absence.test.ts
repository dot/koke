import { describe, expect, it } from 'vitest'
import { absenceToAsk, nextQuestion } from '../src/app/absence.ts'

const MIN = 60_000
const running = (away_at: number | null, session_id = 1) => ({ session_id, away_at })

describe('absenceToAsk (L5)', () => {
  const now = 100 * MIN

  it('asks after an absence of at least the threshold, in whole minutes, about that moment', () => {
    expect(absenceToAsk(running(now - 30 * MIN), null, now, 30)).toEqual({ sessionId: 1, awayAt: now - 30 * MIN, minutes: 30 })
    expect(absenceToAsk(running(now - 47.9 * MIN), null, now, 30)?.minutes).toBe(47)
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

describe('nextQuestion (L5)', () => {
  const now = 100 * MIN
  const open = { sessionId: 1, awayAt: now - 40 * MIN, minutes: 40 }

  it('keeps an unanswered question about its first absence when koke goes away again', () => {
    expect(nextQuestion(open, running(now - 1 * MIN), now - 40 * MIN, now, 30)).toBe(open)
    expect(nextQuestion(open, running(now - 35 * MIN), now - 40 * MIN, now, 30)).toBe(open)
  })

  it('drops the question once its session is no longer running', () => {
    expect(nextQuestion(open, null, null, now, 30)).toBeNull()
    expect(nextQuestion(open, running(null, 2), null, now, 30)).toBeNull()
  })

  it('asks about a new long absence when nothing is open', () => {
    expect(nextQuestion(null, running(now - 30 * MIN), null, now, 30)?.minutes).toBe(30)
  })
})
