# koke data model and HTTP API

This is the contract between the PWA (#4, #5, #7, #9), the scheduled job (#6) and the login (#13). The schema is `migrations/0001_init.sql`, with the login tables in `migrations/0002_login.sql`. Use cases are referred to by their ids in `docs/use-cases.md`.

## Data model

All times are UTC epoch milliseconds. Days are JST calendar days, worked out in queries.

| Table | Changes | Purpose |
|---|---|---|
| `users` | insert; `display_name` may change | One row per learner. Every other row hangs off `user_id`. |
| `subjects` | edited in place | A learner's subject list (L9): `name`, `position`, `hidden`, and `parent_id` for a subject grouped under another. Hidden subjects keep their sessions. |
| `sessions` | **insert only** | Fixes a session's owner and the order sessions were created in. Always inserted in the same D1 batch as the session's rev 1. |
| `session_revisions` | **insert only** | The history of each session (below). |
| `push_subscriptions` | insert and delete | Where to send "still studying?" (L6). One per subscribing device. |

Login tables (ADR 2, #13) are login state, not session data, so their rows are updated in place:

| Table | Changes | Purpose |
|---|---|---|
| `devices` | insert; `revoked_at` set | One row per signed-in phone or PC. Holds the SHA-256 of the device token, never the token. A `pc` row names the phone it was paired from. |
| `invitations` | insert; `used_at`, `device_id` set | Single-use invitation codes (hashed), valid for 24 hours. |
| `pairing_codes` | insert; `spent_at` set | 6-digit codes (hashed) a phone shows for pairing a PC, valid for 5 minutes. A partial unique index keeps codes in force from colliding. |
| `pairing_guard` | one row, updated | The service-wide count of wrong pairing attempts and the pause that follows. |

### Revisions

A session is a stack of rows in `session_revisions` sharing a `session_id`. Each row is a full snapshot: `subject_id`, `started_at`, `ended_at`, `away_at`, `prompted_at`, `deleted`. The row with the highest `rev` is the session's current state. Nothing is ever updated or deleted; triggers in the schema refuse both.

| Event | New revision | `source` |
|---|---|---|
| Start (L2) | rev 1, `ended_at` null | `app` |
| Phone goes away (L5) | `away_at` = when the page was hidden | `away` |
| Stop (L4), or "not studying" after an absence (L5) | `ended_at` = now, or the `away_at` the learner confirmed | `app` |
| Pick a subject for an uncategorized running session (L3) | `subject_id` set; nothing else changes, so it applies from the start | `app` |
| Switch subject (L3) | stop this session, start a new one | `app` |
| "Still studying?" sent (L6) | `prompted_at` = send time | `prompt` |
| Notification tapped (L6) | `prompted_at` cleared | `extend` |
| No answer in time (L6) | `ended_at` = `prompted_at` | `timeout` |
| Fix a record (L8) | changed `started_at` / `ended_at` / `subject_id`, or `deleted` = 1 | `manual` |

A session is **running** when its current revision has `ended_at` null and `deleted` = 0. It belongs to the JST day of its current `started_at`, even if it ran past midnight. A running session counts up to now.

### Rules the schema enforces

- A revision's `user_id` must own both the session and the subject. A bug in the API cannot write across learners.
- `rev` must be exactly one more than the current head. Otherwise the insert is **ignored, not failed**: a double-fired request from the client changes nothing, and the API reports `applied: false` with the current head. The API does not retry.
- Checks run in a fixed order inside one trigger, so a stale insert is always ignored, never failed by a later check.
- An ended or deleted session cannot be reopened.
- **Only a learner's latest session can be running.** A `sessions` row can be inserted only when the learner's latest session has revisions and is ended or deleted; rev 1 can be written only to the learner's latest session; ended sessions stay ended. So the running session, if any, is always the learner's highest `session_id`. The L6 job relies on this (see "Query cost"). A `sessions` row without rev 1 would block the learner's next start, which is why the two are always inserted in one batch.
- `INSERT OR REPLACE` cannot rewrite a `sessions` row.
- `ended_at` ≥ `started_at`.
- Subjects nest one level deep: a parent never has a parent, a subject with children never gets one, and a parent belongs to the same learner. A subject's id and owner never change, and `INSERT OR REPLACE` cannot rewrite one.

### Rules the API enforces

- `started_at` and `ended_at` are never in the future.
- When an end time comes from a recorded moment rather than from the learner (`away_at` for "not studying" in L5, `prompted_at` for a timeout in L6), it is raised to `started_at` if it is earlier. This happens when a fix moved the start after that moment. An `ended_at` the learner typed in L8 that is before `started_at` is refused with `400`.
- A fix (L8) moves `started_at` at most 7 days away from the session's `sessions.created_at`. The summary query finds sessions by creation time, and this bound keeps it exact. A learner fixing a session normally moves it by minutes or hours.

## Requests and authorisation

- Every request is identified by the device cookie (ADR 2): cookie → device → `user_id`. The client never sends a `user_id`.
- Any `session_id`, `subject_id` or `parent_id` in a request must belong to that `user_id`. Otherwise the answer is `404`, the same as for an id that does not exist.
- `pc` devices are read-only. Any request that changes state returns `403`.
- Requests that change state must carry an `Origin` header equal to koke's own origin; otherwise `403`.
- Bodies are JSON. `away` also accepts `text/plain` holding JSON, because `navigator.sendBeacon` cannot set a JSON content type without a preflight.
- Errors are `{"error": "<code>"}` with a matching status: `400 bad_request`, `401 not_signed_in`, `403 forbidden`, `404 not_found`, `409 conflict`, and `429 too_many_attempts` for pairing while it is paused (with `paused_until`).
- Every response to a signed-in device re-issues its cookie with a fresh `Max-Age`, so a device in use stays signed in.

A session in a response looks like:

```json
{ "session_id": 812, "rev": 3, "subject_id": 4, "recorded_at": 1794650000000,
  "started_at": 1794650000000, "ended_at": null, "away_at": 1794651200000, "prompted_at": null }
```

`recorded_at` is `sessions.created_at` and never changes. The L8 editor uses it to show the 7-day limit on moving the start before saving.

Write requests on an existing session send `base_rev`, the `rev` the client last saw, and get back:

```json
{ "applied": true, "session": { … current head … } }
```

`applied: false` means another request got there first; the client shows the returned head and moves on.

## Endpoints

### Login (A1, L1, L7)

These follow ADR 2. The two ways in work without a cookie; both still check `Origin`.

| Request | Body | Notes |
|---|---|---|
| `GET /invite/:code` | – | HTML with the add-to-home-screen steps, linking `/manifest/:code`. Changes nothing. A used, expired or unknown code shows "ask the admin for a new link" with `404`. Sends `Referrer-Policy: no-referrer` and `Cache-Control: no-store`. |
| `GET /manifest/:code` | – | The invitation's manifest, with `start_url` `/?handoff=<code>`. Changes nothing. Same headers. Other pages use the static `/manifest.webmanifest` (`start_url` `/`). |
| `POST /api/handoff` | `{ "code": "…" }` | Sent by the PWA on launch when it has no valid cookie. Spends the invitation and issues a `phone` device in one D1 batch, and sets the cookie. With a valid cookie it changes nothing and answers for that device: koke never switches accounts. A used, expired or unknown code is `404`. |
| `POST /api/pairing-codes` | `{}` | Phone only. `{ "code": "482913", "expires_at": … }`. Spends any code this phone showed before. While pairing is paused, `429`. |
| `POST /api/pair` | `{ "code": "482913" }` | From a PC without a cookie. If the code is in force and its phone is valid, issues a `pc` device paired from that phone, spends the code and sets the cookie. A wrong, used or expired code is `404` and counts as a wrong attempt. The fifth wrong attempt across koke spends every code in force and pauses pairing for 15 minutes; during the pause every attempt is `429`. |

`/api/handoff` and `/api/pair` answer `{ "read_only": … }`, like `GET /api/state`.

The launch URL `/?handoff=` is served as a static file and never reaches the Worker, so it cannot change state. Its `Referrer-Policy` and `Cache-Control` come from `public/_headers`.

### Screen state

`GET /api/state` → `{ "read_only": false, "running": <session> | null, "subjects": [...], "last_subject_id": 5 | null }`

Without a valid cookie it is `401`; the PWA then exchanges a `handoff` code if it has one, and otherwise asks for a new invitation (home-screen app) or shows PC pairing (browser tab). Until #4 lands it answers only `read_only`.

The PWA calls this on open to pick its screen (#4). `read_only` is true for a `pc` device, which shows only the moss (L7); the cookie is `HttpOnly`, so the page cannot tell by itself. `subjects` are the visible ones in the learner's order, each with its `parent_id`, plus `last_subject_id` so the PWA can put that group first. A child of a hidden parent is left out.

### Sessions

| Request | Body | Notes |
|---|---|---|
| `POST /api/sessions` | `{}` for "start", or `{ "subject_id": 4 }` | L2. Inserts the `sessions` row and rev 1 in one D1 batch. `409` if a session is running (the schema refuses the `sessions` row). Returns `{ "session": … }`. |
| `POST /api/sessions/:id/stop` | `{ "base_rev": 3, "ended_at"?: … }` | L4. `ended_at` defaults to now. For "not studying" after an absence (L5), it is the `away_at` the client recorded. |
| `POST /api/sessions/:id/away` | `{ "base_rev": 3, "away_at": … }` | L5, sent with `sendBeacon` when the page is hidden. Never ends the session. |
| `POST /api/sessions/:id/extend` | `{ "base_rev": 4 }` | L6, sent when the learner opens koke from the notification. Clears `prompted_at`. |
| `POST /api/sessions/:id/subject` | `{ "base_rev": 3, "subject_id": 5 }` | L3, picking a subject for an uncategorized running session. A stale `base_rev` is checked first and answers `applied: false` like any other write, so a double-fired request is not a conflict. Only when `base_rev` is the head and that head has ended or already has a subject is the answer `409`; those go through switch or adjust. |
| `POST /api/sessions/:id/switch` | `{ "base_rev": 3, "subject_id": 5 }` | L3. Stops this session and starts a new one in one D1 batch (below). Returns `{ "applied": …, "session": <new, or the current head if not applied> }`. |
| `POST /api/sessions/:id/adjust` | `{ "base_rev": 6, "started_at"?, "ended_at"?, "subject_id"?, "deleted"? }` | L8. Any subset. A running session can change its start or subject. Setting `ended_at` on it stops it. Cannot reopen. |
| `GET /api/sessions?from=&to=` | – | L8 list: current heads of non-deleted sessions started in the range, newest first. |

The switch batch has three statements. The second and third are `INSERT … SELECT … WHERE`, so they insert nothing when the stop was ignored:

1. The stop revision at `base_rev + 1`, with `ended_at` and `created_at` = now.
2. The new `sessions` row, only if statement 1 was applied: `WHERE changes() = 1`. An ignored insert reports 0 changes. Comparing the revision at `base_rev + 1` with the stop's values would not do: a `/stop` with the same `base_rev` in the same millisecond writes an identical row, and the switch would start a session although its own stop was ignored.
3. Rev 1 of the new session, only if the learner's latest session was created at now and has no revisions yet.

`POST /api/sessions` uses statements 2 and 3 without the condition on a stop.

### Moss

`GET /api/summary?subject=all|<subject_id>` → 

```json
{ "days": [{ "date": "2026-11-14", "minutes": 135 }, …],
  "week_minutes": 410, "month_minutes": 1620, "streak_days": 6 }
```

- `days` covers the last 53 weeks: from JST 00:00 of the day 370 days before today, through today. Days with no study are left out.
- `subject=all` includes uncategorised sessions. A subject never does (L7).
- A parent subject counts itself and its children; a child counts only itself.
- Weeks start on Monday (JST). `streak_days` counts back from today; if nothing has been studied yet today, it counts back from yesterday, so the streak does not break until the day is over. If every day back to the start of the 53 weeks was studied, the API reads the 53 weeks before that with the same query, and so on until it finds a day without study. Only a streak longer than a year costs a second read.
- Hidden subjects still count under `all`.

### Subjects (L9)

| Request | Body |
|---|---|
| `GET /api/subjects` | – (all, including hidden, in order) |
| `POST /api/subjects` | `{ "name": "math", "parent_id"?: 3 }` → appended at the end |
| `PATCH /api/subjects/:id` | `{ "name"?, "hidden"? }` |
| `PUT /api/subjects/order` | `{ "subject_ids": [3, 1, 2] }` (must list every subject of the learner; children are shown in this order under their parent) |

### Push (L1, L6)

`POST /api/push-subscriptions` with the `PushSubscription` JSON. Stored with the `user_id` and the `device_id` of the phone that sent it. Revoking a device deletes its subscriptions (#13), so a lost phone stops receiving pushes. Subscriptions that the push service answers with `404` or `410` are deleted.

## The L6 job

Every minute, a Cron Trigger:

1. Finds each learner's running session (query below).
2. If the latest revision of the session was created more than the fixed interval ago and `prompted_at` is null, it appends a `prompt` revision. Only if that insert was applied (`RETURNING` gives a row) does it send "still studying?", with a TTL equal to the wait. An ignored insert means the learner acted at the same moment, and nothing is sent.
3. If `prompted_at` is older than the fixed wait, it appends a `timeout` revision ending the session at `prompted_at` (raised to `started_at` if earlier, see "Rules the API enforces").

Interval, wait and absence threshold are constants in code (use cases, "Fixed in v1"). #6 picks their values.

## Query cost

D1 bills rows scanned (ADR 1). The two hot queries were measured on synthetic histories built with `scripts/seed-synthetic.mjs`. The data was 5 learners, 5 sessions a day and about 8 revisions per session: 1 year was 72,823 revisions and 3 years was 218,434.

The 1-year history was loaded into a temporary remote D1 database, and `rows_read` was taken from the query results' metadata. Both 1- and 3-year histories were also measured locally with SQLite's scan statistics, which show whether the cost grows with history. For the summary, D1 reported about 1,800 rows more than the local count, close to the number of sessions in the window; the likely source is the `GROUP BY` sort, which the local count leaves out. Plan with D1's figure.

| Query | D1 `rows_read`, 1 year | Rows visited locally, 1 year / 3 years | Per day |
|---|---|---|---|
| L6 job: running session per learner | 30 | 30 / 30 | 1,440 runs ≈ 43,000 rows |
| L7 summary for one learner | 7,301 | ≈ 5,500 / ≈ 5,700 | about 680 views fit in the 5 million free rows |

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

The summary query (for `?now`, and `?from` = JST 00:00 of the day 370 days before today):

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
  AND (?subject IS NULL OR h.subject_id IN (
        SELECT subject_id FROM subjects WHERE subject_id = ?subject OR parent_id = ?subject))
GROUP BY day ORDER BY day;
```

On the 3-year history its result matched a full scan of `sessions_current` for every day in the window. Filtering by a parent adds two index lookups on `subjects` and was checked the same way.

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

## Inviting and revoking (A1)

`scripts/admin.ts` wraps `wrangler d1 execute`. Add `--remote` for production; without it, it acts on the local database that `npm run dev` uses. The SQL it runs is in `src/admin/sql.ts`.

```sh
npm run admin -- --remote user add "Hanako"          # prints the new user_id
KOKE_ORIGIN=https://<koke origin> npm run admin -- --remote invite 1
npm run admin -- --remote devices 1                  # device_id, kind, paired_from, times (JST)
npm run admin -- --remote revoke-device 3
npm run admin -- --remote revoke-user 1
```

- `invite` prints the invitation URL once and stores only its hash. Hand the URL to the learner directly; it is single use and lasts 24 hours.
- `revoke-device` shuts out one device, every PC paired from it and the pairing codes it showed, and deletes its push subscriptions.
- `revoke-user` does that for every device of the learner and also cancels invitations not yet used.

**New or lost phone, or a leaked link:** `revoke-user`, then `invite` again for the same `user_id`. The records carry on.

**The learner added koke to the home screen from the wrong page** (the app says it cannot be used and asks for a new link): delete the home-screen icon, `invite` again, and have the learner add koke from the new invitation page. This is the fix ADR 2 expects; it has not yet been tried on a real iPhone (#13).
