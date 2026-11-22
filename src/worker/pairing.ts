import { PAIRING_CODE_TTL, PAIRING_MAX_FAILURES, PAIRING_PAUSE } from './constants.ts'
import { randomPairingCode, randomToken, sha256 } from './crypto.ts'

export type Paused = { paused_until: number }

async function pausedUntil(db: D1Database, now: number): Promise<number | null> {
  const row = await db.prepare('SELECT paused_until FROM pairing_guard WHERE guard_id = 1').first<Paused>()
  return row && row.paused_until > now ? row.paused_until : null
}

// POST /api/pairing-codes, from a phone. A new code replaces any the phone showed before.
export async function issuePairingCode(
  db: D1Database,
  phoneId: number,
  now: number,
): Promise<{ code: string; expires_at: number } | Paused> {
  const paused = await pausedUntil(db, now)
  if (paused) return { paused_until: paused }
  const expires = now + PAIRING_CODE_TTL
  for (;;) {
    const code = randomPairingCode()
    const [, , inserted] = await db.batch([
      // Expired codes leave the in-force index, so their digits can be issued again.
      db.prepare('UPDATE pairing_codes SET spent_at = ? WHERE spent_at IS NULL AND expires_at <= ?').bind(now, now),
      db.prepare('UPDATE pairing_codes SET spent_at = ? WHERE spent_at IS NULL AND device_id = ?').bind(now, phoneId),
      db
        .prepare(
          `INSERT INTO pairing_codes (code_hash, device_id, created_at, expires_at) VALUES (?, ?, ?, ?)
           ON CONFLICT DO NOTHING`,
        )
        .bind(await sha256(code), phoneId, now, expires),
    ])
    // Another phone holds the same digits right now: draw again.
    if (inserted.meta.changes === 1) return { code, expires_at: expires }
  }
}

// POST /api/pair, from a PC. Returns a pc token, null for a wrong code, or the pause.
// The pause check, the guess and the failure count are one batch: D1 runs batches one at a time,
// so guesses sent in parallel still each see the count left by the ones before (ADR 2: 5 per code).
export async function pairWithCode(db: D1Database, code: string, now: number): Promise<string | null | Paused> {
  const codeHash = await sha256(code)
  const token = randomToken(32)
  const tokenHash = await sha256(token)
  const open = '(SELECT paused_until FROM pairing_guard WHERE guard_id = 1) <= ?'
  const [, inserted, , , , guard] = await db.batch([
    // Only a code from a phone that is still valid can be spent.
    db
      .prepare(
        `UPDATE pairing_codes SET spent_at = ?
         WHERE code_hash = ? AND spent_at IS NULL AND expires_at > ? AND ${open}
           AND device_id IN (SELECT device_id FROM devices WHERE kind = 'phone' AND revoked_at IS NULL)`,
      )
      .bind(now, codeHash, now, now),
    db
      .prepare(
        `INSERT INTO devices (user_id, kind, paired_from, label, token_hash, created_at)
         SELECT d.user_id, 'pc', d.device_id, 'PC', ?, ?
         FROM pairing_codes c JOIN devices d ON d.device_id = c.device_id
         WHERE c.code_hash = ? AND c.spent_at = ? AND changes() = 1`,
      )
      .bind(tokenHash, now, codeHash, now),
    // A wrong guess outside a pause counts. After the limit, every code in force is spent and pairing pauses.
    db
      .prepare(
        `UPDATE pairing_guard SET failures = failures + 1
         WHERE guard_id = 1 AND paused_until <= ? AND NOT EXISTS (SELECT 1 FROM devices WHERE token_hash = ?)`,
      )
      .bind(now, tokenHash),
    db
      .prepare(
        `UPDATE pairing_codes SET spent_at = ?
         WHERE spent_at IS NULL AND (SELECT failures FROM pairing_guard WHERE guard_id = 1) >= ?`,
      )
      .bind(now, PAIRING_MAX_FAILURES),
    db
      .prepare('UPDATE pairing_guard SET failures = 0, paused_until = ? WHERE guard_id = 1 AND failures >= ?')
      .bind(now + PAIRING_PAUSE, PAIRING_MAX_FAILURES),
    db.prepare('SELECT paused_until FROM pairing_guard WHERE guard_id = 1'),
  ])
  if (inserted.meta.changes === 1) return token
  const pausedUntilAfter = (guard.results[0] as Paused).paused_until
  return pausedUntilAfter > now ? { paused_until: pausedUntilAfter } : null
}
