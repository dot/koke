import { COOKIE_NAME } from './constants.ts'
import { sha256 } from './crypto.ts'
import { readCookie } from './http.ts'

export type Device = { device_id: number; user_id: number; kind: 'phone' | 'pc'; token: string }

// A device is valid only while neither it nor the phone it was paired from is revoked.
export async function currentDevice(req: Request, db: D1Database): Promise<Device | null> {
  const token = readCookie(req, COOKIE_NAME)
  if (!token) return null
  const row = await db
    .prepare(
      `SELECT d.device_id, d.user_id, d.kind
       FROM devices d LEFT JOIN devices p ON p.device_id = d.paired_from
       WHERE d.token_hash = ? AND d.revoked_at IS NULL
         AND (d.paired_from IS NULL OR p.revoked_at IS NULL)`,
    )
    .bind(await sha256(token))
    .first<Omit<Device, 'token'>>()
  return row ? { ...row, token } : null
}
