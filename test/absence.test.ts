import { describe, expect, it } from 'vitest'
import { absenceToAsk, nextQuestion, stopAtAbsence } from '../src/app/absence.ts'

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

describe('stopAtAbsence (L5)', () => {
  const q = { sessionId: 1, awayAt: 5000, minutes: 40 }
  const head = (rev: number, ended_at: number | null = null, session_id = 1) => ({ session_id, rev, ended_at })
  // Records each base_rev sent and answers with the given replies in turn.
  function stopper(...replies: ({ applied: boolean; session: ReturnType<typeof head> } | null)[]) {
    const sent: number[] = []
    return { sent, stop: async (baseRev: number) => (sent.push(baseRev), replies.shift() ?? null) }
  }

  it('sends the stop once when it applies', async () => {
    const s = stopper({ applied: true, session: head(3, 5000) })
    await stopAtAbsence(q, head(2), s.stop)
    expect(s.sent).toEqual([2])
  })

  it('sends it once more on the returned head when a stale write got there first', async () => {
    const s = stopper({ applied: false, session: head(3) }, { applied: true, session: head(4, 5000) })
    await stopAtAbsence(q, head(2), s.stop)
    expect(s.sent).toEqual([2, 3])
  })

  it('gives up after the second try', async () => {
    const s = stopper({ applied: false, session: head(3) }, { applied: false, session: head(4) }, { applied: true, session: head(5, 5000) })
    await stopAtAbsence(q, head(2), s.stop)
    expect(s.sent).toEqual([2, 3])
  })

  it('does not retry once the returned session has ended, or when the stop got no answer', async () => {
    const ended = stopper({ applied: false, session: head(3, 9000) })
    await stopAtAbsence(q, head(2), ended.stop)
    expect(ended.sent).toEqual([2])
    const offline = stopper(null)
    await stopAtAbsence(q, head(2), offline.stop)
    expect(offline.sent).toEqual([2])
  })

  it('sends nothing when the running session is another one or already over', async () => {
    const s = stopper()
    await stopAtAbsence(q, head(2, null, 7), s.stop)
    await stopAtAbsence(q, head(2, 4000), s.stop)
    await stopAtAbsence(q, null, s.stop)
    expect(s.sent).toEqual([])
  })
})
