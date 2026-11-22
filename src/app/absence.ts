// L5: how many minutes to ask about, or null to ask nothing. Each away_at is judged once,
// on the return that follows it; `handledAwayAt` is the last one judged, so reopening koke
// later without going away again does not turn an old short absence into a question.
export function absenceToAsk(
  running: { away_at: number | null } | null,
  handledAwayAt: number | null,
  now: number,
  thresholdMinutes: number,
): number | null {
  if (!running || running.away_at === null || running.away_at === handledAwayAt) return null
  const minutes = Math.floor((now - running.away_at) / 60_000)
  return minutes >= thresholdMinutes ? minutes : null
}
