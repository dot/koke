// SQL for the admin steps (A1, ADR 2). scripts/admin.ts runs it with `wrangler d1 execute`,
// which takes no bound parameters, so every value is a checked integer or an escaped string.

const int = (n: number) => {
  if (!Number.isSafeInteger(n)) throw new Error(`not an integer: ${n}`)
  return String(n)
}
const str = (s: string) => `'${s.replace(/'/g, "''")}'`

export function addUser(name: string, now: number): string {
  return `INSERT INTO users (display_name, created_at) VALUES (${str(name)}, ${int(now)}) RETURNING user_id;`
}

export function addInvitation(userId: number, codeHash: string, now: number, ttl: number): string {
  return `INSERT INTO invitations (user_id, code_hash, created_at, expires_at)
SELECT user_id, ${str(codeHash)}, ${int(now)}, ${int(now + ttl)} FROM users WHERE user_id = ${int(userId)}
RETURNING invitation_id;`
}

export function listDevices(userId: number): string {
  return `SELECT device_id, kind, paired_from, label,
  datetime(created_at / 1000, 'unixepoch', '+9 hours') AS created_jst,
  datetime(revoked_at / 1000, 'unixepoch', '+9 hours') AS revoked_jst
FROM devices WHERE user_id = ${int(userId)} ORDER BY device_id;`
}

// PCs paired from this phone stop working through the paired_from check; nothing else to touch.
export function revokeDevice(deviceId: number, now: number): string {
  return `UPDATE devices SET revoked_at = ${int(now)} WHERE device_id = ${int(deviceId)} AND revoked_at IS NULL;
DELETE FROM push_subscriptions WHERE device_id = ${int(deviceId)};
UPDATE pairing_codes SET spent_at = ${int(now)} WHERE device_id = ${int(deviceId)} AND spent_at IS NULL;`
}

// New or lost phone, or a leaked link: shut every way in, including invitations not yet used.
// Unused invitations expire at 0, not now: a handoff that took its time before this ran must still fail.
export function revokeUser(userId: number, now: number): string {
  const u = int(userId)
  return `UPDATE devices SET revoked_at = ${int(now)} WHERE user_id = ${u} AND revoked_at IS NULL;
DELETE FROM push_subscriptions WHERE device_id IN (SELECT device_id FROM devices WHERE user_id = ${u});
UPDATE pairing_codes SET spent_at = ${int(now)}
  WHERE spent_at IS NULL AND device_id IN (SELECT device_id FROM devices WHERE user_id = ${u});
UPDATE invitations SET expires_at = 0 WHERE user_id = ${u} AND used_at IS NULL;`
}
