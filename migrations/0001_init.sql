-- koke schema v1. See docs/api.md for the revision semantics.
-- Times are UTC epoch milliseconds. Day attribution (JST) happens in queries.

CREATE TABLE users (
  user_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name TEXT    NOT NULL,
  created_at   INTEGER NOT NULL
);

-- Subjects are settings, not session data, so they are edited in place (L9).
-- parent_id groups subjects one level deep: a parent never has a parent itself.
CREATE TABLE subjects (
  subject_id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users (user_id),
  parent_id  INTEGER REFERENCES subjects (subject_id),
  name       TEXT    NOT NULL,
  position   INTEGER NOT NULL,
  hidden     INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  created_at INTEGER NOT NULL,
  CHECK (parent_id IS NOT subject_id)
);
CREATE INDEX subjects_by_user ON subjects (user_id, position);
CREATE INDEX subjects_by_parent ON subjects (parent_id);

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

-- Tied to the device that subscribed, so revoking a device (#13) can remove its subscriptions.
-- device_id refers to devices, which #13 creates (ADR 2).
CREATE TABLE push_subscriptions (
  endpoint   TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users (user_id),
  device_id  INTEGER NOT NULL,
  p256dh     TEXT    NOT NULL,
  auth       TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX push_subscriptions_by_user ON push_subscriptions (user_id);
CREATE INDEX push_subscriptions_by_device ON push_subscriptions (device_id);

-- Subjects nest one level so a filter on a parent is "the parent and its children", with no recursion.
-- A subject's id and owner never change and a row is never replaced: either would let a child
-- end up under another learner's subject, or two levels down, without its own row changing.
CREATE TRIGGER subjects_no_replace BEFORE INSERT ON subjects
BEGIN
  SELECT RAISE(ABORT, 'subjects cannot be replaced')
  WHERE EXISTS (SELECT 1 FROM subjects WHERE subject_id = NEW.subject_id);
END;
CREATE TRIGGER subjects_fixed_identity BEFORE UPDATE OF subject_id, user_id ON subjects
BEGIN
  SELECT RAISE(ABORT, 'subject id and owner cannot change')
  WHERE NEW.subject_id IS NOT OLD.subject_id OR NEW.user_id IS NOT OLD.user_id;
END;
CREATE TRIGGER subjects_parent_insert BEFORE INSERT ON subjects
WHEN NEW.parent_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'parent belongs to another user')
  WHERE NEW.user_id IS NOT (SELECT user_id FROM subjects WHERE subject_id = NEW.parent_id);
  SELECT RAISE(ABORT, 'subjects nest one level only')
  WHERE (SELECT parent_id FROM subjects WHERE subject_id = NEW.parent_id) IS NOT NULL;
END;
CREATE TRIGGER subjects_parent_update BEFORE UPDATE OF parent_id ON subjects
WHEN NEW.parent_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'parent belongs to another user')
  WHERE NEW.user_id IS NOT (SELECT user_id FROM subjects WHERE subject_id = NEW.parent_id);
  SELECT RAISE(ABORT, 'subjects nest one level only')
  WHERE (SELECT parent_id FROM subjects WHERE subject_id = NEW.parent_id) IS NOT NULL
     OR EXISTS (SELECT 1 FROM subjects WHERE parent_id = NEW.subject_id);
END;

-- Append-only, enforced here so no code path can rewrite history.
CREATE TRIGGER sessions_no_update BEFORE UPDATE ON sessions
BEGIN SELECT RAISE(ABORT, 'sessions are append-only'); END;
CREATE TRIGGER sessions_no_delete BEFORE DELETE ON sessions
BEGIN SELECT RAISE(ABORT, 'sessions are append-only'); END;
CREATE TRIGGER session_revisions_no_update BEFORE UPDATE ON session_revisions
BEGIN SELECT RAISE(ABORT, 'session revisions are append-only'); END;
CREATE TRIGGER session_revisions_no_delete BEFORE DELETE ON session_revisions
BEGIN SELECT RAISE(ABORT, 'session revisions are append-only'); END;

-- INSERT OR REPLACE would swap a row without firing the delete trigger above.
CREATE TRIGGER sessions_no_replace BEFORE INSERT ON sessions
WHEN EXISTS (SELECT 1 FROM sessions WHERE session_id = NEW.session_id)
BEGIN SELECT RAISE(ABORT, 'sessions are append-only'); END;

-- A learner's next session can only be created once their latest one has revisions and is
-- over. With rev 1 allowed only on the latest session and no reopening (below), the running
-- session, if any, is always the learner's highest session_id; the L6 job relies on this.
CREATE TRIGGER sessions_previous_over BEFORE INSERT ON sessions
WHEN EXISTS (SELECT 1 FROM sessions WHERE user_id = NEW.user_id)
 AND NOT EXISTS (
   SELECT 1 FROM session_revisions r
   WHERE r.session_id = (SELECT MAX(session_id) FROM sessions WHERE user_id = NEW.user_id)
     AND r.rev = (SELECT MAX(rev) FROM session_revisions WHERE session_id = r.session_id)
     AND (r.ended_at IS NOT NULL OR r.deleted = 1))
BEGIN SELECT RAISE(ABORT, 'the previous session is not over'); END;

-- One trigger so the checks run in this order: SQLite does not promise an order across
-- triggers, and a stale insert must be ignored before any check can fail it.
CREATE TRIGGER session_revisions_check BEFORE INSERT ON session_revisions
BEGIN
  -- A stale base_rev from a double-fired client is dropped silently rather than retried;
  -- the caller sees zero changes and reads the current head.
  SELECT RAISE(IGNORE)
  WHERE NEW.rev <> COALESCE((SELECT MAX(rev) FROM session_revisions WHERE session_id = NEW.session_id), 0) + 1;

  -- Ownership, so a bug in the API cannot write across learners.
  SELECT RAISE(ABORT, 'revision user does not own the session')
  WHERE NEW.user_id IS NOT (SELECT user_id FROM sessions WHERE session_id = NEW.session_id);
  SELECT RAISE(ABORT, 'revision user does not own the subject')
  WHERE NEW.subject_id IS NOT NULL
    AND NEW.user_id IS NOT (SELECT user_id FROM subjects WHERE subject_id = NEW.subject_id);

  SELECT RAISE(ABORT, 'only the latest session can start')
  WHERE NEW.rev = 1
    AND NEW.session_id IS NOT (SELECT MAX(session_id) FROM sessions WHERE user_id = NEW.user_id);

  SELECT RAISE(ABORT, 'an ended session cannot be reopened')
  WHERE NEW.rev > 1 AND NEW.ended_at IS NULL AND NEW.deleted = 0
    AND (SELECT ended_at IS NOT NULL OR deleted = 1 FROM session_revisions
         WHERE session_id = NEW.session_id AND rev = NEW.rev - 1);
END;

-- For reading by hand (A2). The API uses indexed per-session lookups instead, because this
-- view scans every revision.
CREATE VIEW sessions_current AS
SELECT r.*
FROM session_revisions r
WHERE r.rev = (SELECT MAX(rev) FROM session_revisions WHERE session_id = r.session_id)
  AND r.deleted = 0;
