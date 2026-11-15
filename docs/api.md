# koke data model and HTTP API

This is the contract between the PWA (#4, #5, #7, #9), the scheduled job (#6) and the login (#13). The schema is `migrations/0001_init.sql`. Use cases are referred to by their ids in `docs/use-cases.md`.

## Data model

All times are UTC epoch milliseconds. Days are JST calendar days, worked out in queries.

| Table | Changes | Purpose |
|---|---|---|
| `users` | insert; `display_name` may change | One row per learner. Every other row hangs off `user_id`. |
| `subjects` | edited in place | A learner's subject list (L9): `name`, `position`, `hidden`. Hidden subjects keep their sessions. |
| `sessions` | **insert only** | Fixes a session's owner and the order sessions were created in. |
| `session_revisions` | **insert only** | The history of each session (below). |
| `push_subscriptions` | insert and delete | Where to send "still studying?" (L6). |

Login tables (`invitations`, `devices`, `pairing_codes`) are added by #13 (ADR 2).

### Revisions

A session is a stack of rows in `session_revisions` sharing a `session_id`. Each row is a full snapshot: `subject_id`, `started_at`, `ended_at`, `away_at`, `prompted_at`, `deleted`. The row with the highest `rev` is the session's current state. Nothing is ever updated or deleted; triggers in the schema refuse both.

| Event | New revision | `source` |
|---|---|---|
| Start (L2) | rev 1, `ended_at` null | `app` |
| Phone goes away (L5) | `away_at` = when the page was hidden | `away` |
| Stop (L4), or "not studying" after an absence (L5) | `ended_at` = now, or the `away_at` the learner confirmed | `app` |
| Switch subject (L3) | stop this session, start a new one | `app` |
| "Still studying?" sent (L6) | `prompted_at` = send time | `prompt` |
| Notification tapped (L6) | `prompted_at` cleared | `extend` |
| No answer in time (L6) | `ended_at` = `prompted_at` | `timeout` |
| Fix a record (L8) | changed `started_at` / `ended_at` / `subject_id`, or `deleted` = 1 | `manual` |

A session is **running** when its current revision has `ended_at` null and `deleted` = 0. It belongs to the JST day of its current `started_at`, even if it ran past midnight. A running session counts up to now.

### Rules the schema enforces

- A revision's `user_id` must own both the session and the subject. A bug in the API cannot write across learners.
- `rev` must be exactly one more than the current head. Otherwise the insert is **ignored, not failed**: a double-fired request from the client changes nothing, and the API reports `applied: false` with the current head. The API does not retry.
- An ended or deleted session cannot be reopened.
- **Only a learner's latest session can be running.** A new session cannot start while the previous one is running, and ended sessions stay ended, so the running session, if any, is always the learner's highest `session_id`. The L6 job relies on this (see "Query cost").
- `ended_at` ≥ `started_at`.

### Rules the API enforces

- `started_at` and `ended_at` are never in the future.
- A fix (L8) moves `started_at` at most 7 days away from the session's `sessions.created_at`. The summary query finds sessions by creation time, and this bound keeps it exact. A learner fixing a session normally moves it by minutes or hours.

## Requests and authorisation

- Every request is identified by the device cookie (ADR 2): cookie → device → `user_id`. The client never sends a `user_id`.
- Any `session_id` or `subject_id` in a request must belong to that `user_id`. Otherwise the answer is `404`, the same as for an id that does not exist.
- `pc` devices are read-only. Any request that changes state returns `403`.
- Requests that change state must carry an `Origin` header equal to koke's own origin; otherwise `403`.
- Bodies are JSON. `away` also accepts `text/plain` holding JSON, because `navigator.sendBeacon` cannot set a JSON content type without a preflight.
- Errors are `{"error": "<code>"}` with a matching status: `400 bad_request`, `401 not_signed_in`, `403 forbidden`, `404 not_found`, `409 conflict`.

A session in a response looks like:

```json
{ "session_id": 812, "rev": 3, "subject_id": 4, "started_at": 1794650000000,
  "ended_at": null, "away_at": 1794651200000, "prompted_at": null }
```

Write requests on an existing session send `base_rev`, the `rev` the client last saw, and get back:

```json
{ "applied": true, "session": { … current head … } }
```

`applied: false` means another request got there first; the client shows the returned head and moves on.

## Endpoints

### Screen state

`GET /api/state` → `{ "running": <session> | null, "subjects": [...] }`

The PWA calls this on open to pick its screen (#4). `subjects` are the visible ones, last used first, then in the learner's order.

### Sessions

| Request | Body | Notes |
|---|---|---|
| `POST /api/sessions` | `{ "subject_id": 4 }` or `{}` for "not decided" | L2. `409` if a session is running. Returns `{ "session": … }`. |
| `POST /api/sessions/:id/stop` | `{ "base_rev": 3, "ended_at"?: … }` | L4. `ended_at` defaults to now. For "not studying" after an absence (L5), it is the `away_at` the client recorded. |
| `POST /api/sessions/:id/away` | `{ "base_rev": 3, "away_at": … }` | L5, sent with `sendBeacon` when the page is hidden. Never ends the session. |
| `POST /api/sessions/:id/extend` | `{ "base_rev": 4 }` | L6, sent when the learner opens koke from the notification. Clears `prompted_at`. |
| `POST /api/sessions/:id/switch` | `{ "base_rev": 3, "subject_id": 5 }` | L3. Stops this session and starts a new one in one D1 batch. Returns `{ "applied": …, "session": <new> }`. |
| `POST /api/sessions/:id/adjust` | `{ "base_rev": 6, "started_at"?, "ended_at"?, "subject_id"?, "deleted"? }` | L8. Any subset. A running session can change its start or subject. Setting `ended_at` on it stops it. Cannot reopen. |
| `GET /api/sessions?from=&to=` | – | L8 list: current heads of non-deleted sessions started in the range, newest first. |

### Moss

`GET /api/summary?subject=all|<subject_id>` → 

```json
{ "days": [{ "date": "2026-11-14", "minutes": 135 }, …],
  "week_minutes": 410, "month_minutes": 1620, "streak_days": 6 }
```

- `days` covers the last 53 weeks. Days with no study are left out.
- `subject=all` includes uncategorised sessions. A single subject never does (L7).
- Weeks start on Monday (JST). `streak_days` counts back from today; if nothing has been studied yet today, it counts back from yesterday, so the streak does not break until the day is over.
- Hidden subjects still count under `all`.

### Subjects (L9)

| Request | Body |
|---|---|
| `GET /api/subjects` | – (all, including hidden, in order) |
| `POST /api/subjects` | `{ "name": "math" }` → appended at the end |
| `PATCH /api/subjects/:id` | `{ "name"?, "hidden"? }` |
| `PUT /api/subjects/order` | `{ "subject_ids": [3, 1, 2] }` (must list every subject of the learner) |

### Push (L1, L6)

`POST /api/push-subscriptions` with the `PushSubscription` JSON. Stored per `user_id`. Subscriptions that the push service answers with `404` or `410` are deleted.

## The L6 job

Every minute, a Cron Trigger:

1. Finds each learner's running session (query below).
2. If the latest revision of the session was created more than the fixed interval ago and `prompted_at` is null, it appends a `prompt` revision and sends "still studying?" with a TTL equal to the wait.
3. If `prompted_at` is older than the fixed wait, it appends a `timeout` revision ending the session at `prompted_at`.

Interval, wait and absence threshold are constants in code (use cases, "Fixed in v1"). #6 picks their values.

## Query cost

D1 bills rows scanned (ADR 1). The two hot queries were measured on synthetic histories built with `scripts/seed-synthetic.mjs`. The data was 5 learners, 5 sessions a day and about 8 revisions per session: 1 year was 72,823 revisions and 3 years was 218,434. Rows visited were counted with SQLite's scan statistics on the local D1 file. This approximates D1's `rows_read`; confirm on the remote database when #4 creates it.

| Query | Rows visited, 1 year | Rows visited, 3 years | Per day |
|---|---|---|---|
| L6 job: running session per learner | 30 | 30 | 1,440 runs ≈ 43,000 rows |
| L7 summary for one learner | ≈ 5,500 | ≈ 5,700 | about 870 views fit in the 5 million free rows |

The job's cost depends only on the number of learners. The summary's depends only on the sessions in its 53-week window. Neither grows with total history.

The L6 job query:

```sql
WITH latest AS (
  SELECT (SELECT MAX(session_id) FROM sessions s WHERE s.user_id = u.user_id) AS session_id
  FROM users u
), heads AS (
  SELECT session_id,
         (SELECT MAX(rev) FROM session_revisions x WHERE x.session_id = latest.session_id) AS rev
  FROM latest WHERE session_id IS NOT NULL
)
SELECT r.*
FROM heads JOIN session_revisions r ON r.session_id = heads.session_id AND r.rev = heads.rev
WHERE r.ended_at IS NULL AND r.deleted = 0;
```

The summary query (for `?now` and `?from` = now − 371 days):

```sql
WITH recent AS (
  SELECT s.session_id,
         (SELECT MAX(rev) FROM session_revisions x WHERE x.session_id = s.session_id) AS rev
  FROM sessions s
  WHERE s.user_id = ?user AND s.created_at >= ?from - 7 * 86400000
)
SELECT date((h.started_at + 9 * 3600000) / 1000, 'unixepoch') AS day,
       SUM(COALESCE(h.ended_at, ?now) - h.started_at) / 60000 AS minutes
FROM recent JOIN session_revisions h ON h.session_id = recent.session_id AND h.rev = recent.rev
WHERE h.deleted = 0 AND h.started_at >= ?from
  AND (?subject IS NULL OR h.subject_id = ?subject)
GROUP BY day ORDER BY day;
```

On the 3-year history its result matched a full scan of `sessions_current` for all 371 days.

Avoid `sessions_current` in the API: it scans every revision.

## Reading the records directly (A2)

The admin reads the production database with `wrangler d1 execute koke --remote --command "…"`.

Current sessions of one learner:

```sql
SELECT * FROM sessions_current WHERE user_id = 1 ORDER BY started_at DESC LIMIT 20;
```

The full history of one session, oldest first:

```sql
SELECT rev, source, datetime(created_at / 1000, 'unixepoch', '+9 hours') AS at_jst,
       subject_id, started_at, ended_at, away_at, prompted_at, deleted
FROM session_revisions WHERE session_id = 812 ORDER BY rev;
```

`sessions_current` scans every revision, which is fine for an occasional manual read but counts toward the daily free rows.
