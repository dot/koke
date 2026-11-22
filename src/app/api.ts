export type ApiResult<T> = { ok: true; body: T } | { ok: false; status: number; body: { error: string; paused_until?: number } }

export async function api<T>(path: string, body?: unknown): Promise<ApiResult<T>> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  })
  const json = await res.json()
  return res.ok ? { ok: true, body: json as T } : { ok: false, status: res.status, body: json }
}

export type State = { read_only: boolean }
