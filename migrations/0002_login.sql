-- Login tables (ADR 2, #13). Codes and tokens are stored only as SHA-256 hex digests.
-- These are login state, not session data, so rows are updated in place (revoked, spent, used).

CREATE TABLE devices (
  device_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users (user_id),
  kind        TEXT    NOT NULL CHECK (kind IN ('phone', 'pc')),
  -- The phone a PC was paired from. Revoking that phone also shuts out the PC.
  paired_from INTEGER REFERENCES devices (device_id),
  label       TEXT    NOT NULL,
  token_hash  TEXT    NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL,
  revoked_at  INTEGER,
  CHECK ((kind = 'pc') = (paired_from IS NOT NULL))
);
CREATE INDEX devices_by_user ON devices (user_id);
CREATE INDEX devices_by_paired_from ON devices (paired_from);

CREATE TABLE invitations (
  invitation_id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users (user_id),
  code_hash     TEXT    NOT NULL UNIQUE,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  used_at       INTEGER,
  device_id     INTEGER REFERENCES devices (device_id)
);
CREATE INDEX invitations_by_user ON invitations (user_id);

CREATE TABLE pairing_codes (
  pairing_code_id INTEGER PRIMARY KEY AUTOINCREMENT,
  code_hash       TEXT    NOT NULL,
  -- The phone that showed the code.
  device_id       INTEGER NOT NULL REFERENCES devices (device_id),
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL,
  spent_at        INTEGER
);
-- Codes in force never collide. Expired codes are marked spent before a new one is issued,
-- so this index only ever holds codes that can still be typed.
CREATE UNIQUE INDEX pairing_codes_in_force ON pairing_codes (code_hash) WHERE spent_at IS NULL;
CREATE INDEX pairing_codes_by_device ON pairing_codes (device_id);

-- One row. A wrong guess cannot be tied to any one code, so the limit is service-wide.
CREATE TABLE pairing_guard (
  guard_id     INTEGER PRIMARY KEY CHECK (guard_id = 1),
  failures     INTEGER NOT NULL,
  paused_until INTEGER NOT NULL
);
INSERT INTO pairing_guard (guard_id, failures, paused_until) VALUES (1, 0, 0);
