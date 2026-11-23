-- A learner can delete a subject that no current record uses. Old revisions still point at
-- it and D1 enforces foreign keys, so the row stays as a tombstone with deleted_at set.
ALTER TABLE subjects ADD COLUMN deleted_at INTEGER;

-- Names are unique among a learner's live siblings. The API compares nameKey() (NFKC, trimmed,
-- lower case) and stores it here, so two requests racing past that check still cannot both write.
-- SQLite has no NFKC; existing rows get the closest it offers, which matches for the names in use.
-- COALESCE because a unique index treats NULL parents as distinct.
ALTER TABLE subjects ADD COLUMN name_key TEXT;
UPDATE subjects SET name_key = lower(trim(name));
CREATE UNIQUE INDEX subjects_unique_name ON subjects (user_id, COALESCE(parent_id, 0), name_key)
  WHERE deleted_at IS NULL;

-- A child can only be added under a live parent, even when the parent is deleted meanwhile.
CREATE TRIGGER subjects_parent_live BEFORE INSERT ON subjects
WHEN NEW.parent_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'parent is deleted')
  WHERE (SELECT deleted_at FROM subjects WHERE subject_id = NEW.parent_id) IS NOT NULL;
END;

-- "Is this subject used?" reads only the revisions that point at it, not everyone's history.
CREATE INDEX session_revisions_by_subject ON session_revisions (subject_id);

-- Recreated, not joined by a second trigger: SQLite does not promise an order across triggers,
-- and the stale-revision ignore must still run before any check can fail an insert.
DROP TRIGGER session_revisions_check;
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

  -- A deleted subject is a tombstone kept for history; nothing new may point at it.
  SELECT RAISE(ABORT, 'subject is deleted')
  WHERE NEW.subject_id IS NOT NULL
    AND (SELECT deleted_at FROM subjects WHERE subject_id = NEW.subject_id) IS NOT NULL;

  SELECT RAISE(ABORT, 'only the latest session can start')
  WHERE NEW.rev = 1
    AND NEW.session_id IS NOT (SELECT MAX(session_id) FROM sessions WHERE user_id = NEW.user_id);

  SELECT RAISE(ABORT, 'an ended session cannot be reopened')
  WHERE NEW.rev > 1 AND NEW.ended_at IS NULL AND NEW.deleted = 0
    AND (SELECT ended_at IS NOT NULL OR deleted = 1 FROM session_revisions
         WHERE session_id = NEW.session_id AND rev = NEW.rev - 1);
END;
