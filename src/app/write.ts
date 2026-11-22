import { api, type ApiResult } from './api.ts'

export type WriteResult<T> = ApiResult<T> | { ok: false; offline: true }

// Every change the learner makes goes through here. Today a tap without a connection is only
// reported; #23 puts a queue behind this function that sends it later with the tap time.
export async function write<T>(path: string, body: Record<string, unknown>): Promise<WriteResult<T>> {
  try {
    return await api<T>(path, body)
  } catch {
    // fetch rejects only when the request never got an answer.
    return { ok: false, offline: true }
  }
}
