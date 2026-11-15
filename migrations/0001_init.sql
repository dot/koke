-- koke schema v1. See docs/api.md for the revision semantics.
-- Times are UTC epoch milliseconds. Day attribution (JST) happens in queries.

CREATE TABLE users (
  user_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name TEXT    NOT NULL,
  created_at   INTEGER NOT NULL
);

-- Subjects are settings, not session data, so they are edited in place (L9).
CREATE TABLE subjects (
  subject_id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users (user_id),
  name       TEXT    NOT NULL,
  position   INTEGER NOT NULL,
  hidden     INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  created_at INTEGER NOT NULL
);
CREATE INDEX subjects_by_user ON subjects (user_id, position);

-- One row per session, never changed: fixes the session's owner and its order of creation.
CREATE TABLE sessions (
  session_id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users (user_id),
  created_at INTEGER NOT NULL
);
CREATE INDEX sessions_by_user ON sessions (user_id, session_id);
CREATE INDEX sessions_by_user_created ON sessions (user_id, created_at);

-- Each row is a full snapshot of a session; the row with the highest rev is the current state.
CREATE TABLE session_revisions (
  session_id  INTEGER NOT NULL REFERENCES sessions (session_id),
  rev         INTEGER NOT NULL CHECK (rev >= 1),
  user_id     INTEGER NOT NULL REFERENCES users (user_id),
  subject_id  INTEGER REFERENCES subjects (subject_id),
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER CHECK (ended_at IS NULL OR ended_at >= started_at),
  away_at     INTEGER,
  prompted_at INTEGER,
  deleted     INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  source      TEXT    NOT NULL CHECK (source IN ('app', 'away', 'extend', 'prompt', 'timeout', 'manual')),
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (session_id, rev)
) WITHOUT ROWID;

CREATE TABLE push_subscriptions (
  endpoint   TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users (user_id),
  p256dh     TEXT    NOT NULL,
  auth       TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX push_subscriptions_by_user ON push_subscriptions (user_id);

-- Append-only, enforced here so no code path can rewrite history.
CREATE TRIGGER sessions_no_update BEFORE UPDATE ON sessions
BEGIN SELECT RAISE(ABORT, 'sessions are append-only'); END;
CREATE TRIGGER sessions_no_delete BEFORE DELETE ON sessions
BEGIN SELECT RAISE(ABORT, 'sessions are append-only'); END;
CREATE TRIGGER session_revisions_no_update BEFORE UPDATE ON session_revisions
BEGIN SELECT RAISE(ABORT, 'session revisions are append-only'); END;
CREATE TRIGGER session_revisions_no_delete BEFORE DELETE ON session_revisions
BEGIN SELECT RAISE(ABORT, 'session revisions are append-only'); END;

-- A stale base_rev from a double-fired client is dropped silently rather than retried;
-- the caller sees zero changes and reads the current head.
CREATE TRIGGER session_revisions_next_rev BEFORE INSERT ON session_revisions
WHEN NEW.rev <> COALESCE((SELECT MAX(rev) FROM session_revisions WHERE session_id = NEW.session_id), 0) + 1
BEGIN SELECT RAISE(IGNORE); END;

-- Ownership checks, so a bug in the API cannot write across learners.
CREATE TRIGGER session_revisions_owner BEFORE INSERT ON session_revisions
WHEN NEW.user_id IS NOT (SELECT user_id FROM sessions WHERE session_id = NEW.session_id)
BEGIN SELECT RAISE(ABORT, 'revision user does not own the session'); END;

CREATE TRIGGER session_revisions_subject_owner BEFORE INSERT ON session_revisions
WHEN NEW.subject_id IS NOT NULL
 AND NEW.user_id IS NOT (SELECT user_id FROM subjects WHERE subject_id = NEW.subject_id)
BEGIN SELECT RAISE(ABORT, 'revision user does not own the subject'); END;

-- An ended session stays ended. Together with the next trigger this keeps the invariant
-- the L6 cron job relies on: only a learner's latest session can be running.
CREATE TRIGGER session_revisions_no_reopen BEFORE INSERT ON session_revisions
WHEN NEW.rev > 1 AND NEW.ended_at IS NULL AND NEW.deleted = 0
 AND (SELECT ended_at IS NOT NULL OR deleted = 1 FROM session_revisions
      WHERE session_id = NEW.session_id AND rev = NEW.rev - 1)
BEGIN SELECT RAISE(ABORT, 'an ended session cannot be reopened'); END;

CREATE TRIGGER session_revisions_one_running BEFORE INSERT ON session_revisions
WHEN NEW.rev = 1 AND NEW.ended_at IS NULL AND EXISTS (
  SELECT 1 FROM session_revisions r
  WHERE r.session_id = (SELECT MAX(session_id) FROM sessions
                        WHERE user_id = NEW.user_id AND session_id < NEW.session_id)
    AND r.rev = (SELECT MAX(rev) FROM session_revisions WHERE session_id = r.session_id)
    AND r.ended_at IS NULL AND r.deleted = 0)
BEGIN SELECT RAISE(ABORT, 'another session is still running'); END;

-- For reading by hand (A2). The API uses indexed per-session lookups instead, because this
-- view scans every revision.
CREATE VIEW sessions_current AS
SELECT r.*
FROM session_revisions r
WHERE r.rev = (SELECT MAX(rev) FROM session_revisions WHERE session_id = r.session_id)
  AND r.deleted = 0;
