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

type Head = { session_id: number; rev: number; ended_at: number | null }
type Stop = (baseRev: number) => Promise<{ applied: boolean; session: Head } | null>

// "Not studying" ends the session at the moment koke went away. It is the learner's answer, not a
// tap that may have fired twice, so a stale stop (a late beacon, another tab) is sent once more on
// the head that came back, as long as that is still the same running session. null means the stop
// never got an answer (offline), which is reported elsewhere.
export async function stopAtAbsence(q: AwayQuestion, running: Head | null, stop: Stop): Promise<void> {
  let s = running
  for (let attempt = 0; attempt < 2 && s?.session_id === q.sessionId && s.ended_at === null; attempt++) {
    const r = await stop(s.rev)
    if (!r || r.applied) return
    s = r.session
  }
}
