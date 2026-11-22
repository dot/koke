// Fixed in v1 (ADR 2). Changing any of these means a deploy.
export const MINUTE = 60_000
export const INVITATION_TTL = 24 * 60 * MINUTE
export const PAIRING_CODE_TTL = 5 * MINUTE
export const PAIRING_MAX_FAILURES = 5
export const PAIRING_PAUSE = 15 * MINUTE
export const COOKIE_NAME = '__Host-koke'
export const COOKIE_MAX_AGE_SECONDS = 400 * 24 * 3600
