export type ApiResult<T> = { ok: true; body: T } | { ok: false; status: number; body: { error: string; paused_until?: number } }

export async function api<T>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<ApiResult<T>> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  })
  const json = await res.json()
  return res.ok ? { ok: true, body: json as T } : { ok: false, status: res.status, body: json }
}

export type Session = {
  session_id: number
  rev: number
  subject_id: number | null
  recorded_at: number
  started_at: number
  ended_at: number | null
  away_at: number | null
  prompted_at: number | null
}

export type Subject = { subject_id: number; parent_id: number | null; name: string }

// GET /api/subjects: every subject, hidden ones included, for the subjects tab (L9).
export type SubjectSetting = Subject & { hidden: boolean; used: boolean }

export type State = {
  read_only: boolean
  running: Session | null
  // [parent, child] or [subject]; kept even when the subject is hidden.
  running_subject_path: string[] | null
  subjects: Subject[]
  last_subject_id: number | null
  away_threshold_minutes: number
}
