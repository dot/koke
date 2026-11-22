// L5: the question "you were away N minutes", tied to the absence it asks about. The answer
// "not studying" ends the session at that absence's away_at, not at whatever away_at is newest.
export type AwayQuestion = { sessionId: number; awayAt: number; minutes: number }

type Running = { session_id: number; away_at: number | null } | null

// What to ask after an absence, or null. Each away_at is judged once, on the return that follows
// it; `handledAwayAt` is the last one judged, so reopening koke later without going away again
// does not turn an old short absence into a question.
export function absenceToAsk(running: Running, handledAwayAt: number | null, now: number, thresholdMinutes: number): AwayQuestion | null {
  if (!running || running.away_at === null || running.away_at === handledAwayAt) return null
  const minutes = Math.floor((now - running.away_at) / 60_000)
  return minutes >= thresholdMinutes ? { sessionId: running.session_id, awayAt: running.away_at, minutes } : null
}

// An open question stays until answered, even across later absences: its away_at is the earliest
// moment the learner may have stopped. It goes once its session is no longer running.
export function nextQuestion(
  open: AwayQuestion | null,
  running: Running,
  handledAwayAt: number | null,
  now: number,
  thresholdMinutes: number,
): AwayQuestion | null {
  if (open) return running?.session_id === open.sessionId ? open : null
  return absenceToAsk(running, handledAwayAt, now, thresholdMinutes)
}
