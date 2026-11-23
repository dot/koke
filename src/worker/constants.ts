// Fixed in v1 (ADR 2). Changing any of these means a deploy.
export const MINUTE = 60_000
export const INVITATION_TTL = 24 * 60 * MINUTE
export const PAIRING_CODE_TTL = 5 * MINUTE
export const PAIRING_MAX_FAILURES = 5
export const PAIRING_PAUSE = 15 * MINUTE
export const COOKIE_NAME = '__Host-koke'
export const COOKIE_MAX_AGE_SECONDS = 400 * 24 * 3600
// L5. Sent to the PWA in GET /api/state rather than built into it, so #22 can make it per learner.
export const AWAY_THRESHOLD_MINUTES = 30
// L9. A bound on what the learner types; any real subject name fits.
export const SUBJECT_NAME_MAX = 40
