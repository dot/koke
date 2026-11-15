# 1. Host the server on Cloudflare Workers with D1

- Status: Accepted
- Date: 2026-11-15
- Issue: #2

## Context

koke needs a server that stores session revisions, serves the PWA and the heatmap, and sends the "still studying?" push (L6). The criteria in #2:

- The free tier covers a handful of learners indefinitely
- Scheduled execution for the "still studying?" check (#6)
- Can send Web Push (VAPID) from the server
- SQL storage that fits the append-only revision model (#3)
- Simple deploy from this repo

Two further needs come from the use cases: the admin reads records and revision history directly in the database (A2), and PC browsers get a read-only view (L7), so the server is public on the internet rather than on a home network.

The Web Push spike (#1, `docs/spikes/web-push-ios.md`) already ran on Cloudflare Workers and delivered to an iOS home-screen PWA within 2 seconds in every app state tried.

## Decision

Run the server as one Cloudflare Worker on the Free plan:

- **Workers** serves the PWA's static files and the HTTP API from the same origin.
- **D1** (SQLite) stores session revisions, subjects and push subscriptions.
- **Cron Triggers** run the L6 check on a fixed schedule.
- **Web Push** is sent with the WebCrypto implementation from the spike (`spikes/web-push/src/webpush.ts`), with no npm dependency and no `nodejs_compat`.
- Deploy with `wrangler deploy` from this repo. Secrets (VAPID private key and any auth secrets from #8) are set with `wrangler secret`.

## Why

| Criterion | How Workers + D1 meets it |
|---|---|
| Free for a handful of learners | Workers Free: 100,000 requests/day. D1 Free: 5 million rows read and 100,000 rows written per day, 500 MB per database. A few learners use a tiny fraction of this. |
| Scheduled execution | Cron Triggers, up to 5 per account on Free. #6 needs one. |
| Web Push from the server | Shown by #1: VAPID and aes128gcm run on WebCrypto in a Worker, and Apple's push service accepted the requests. |
| SQL for append-only revisions | D1 is SQLite: plain `INSERT`s into `session_revisions` and a `sessions_current` view, as #3 describes. |
| Simple deploy | One `wrangler deploy`; the spike went from nothing to a public HTTPS URL in one command, with the KV store provisioned automatically. |
| A2: admin reads the database directly | `wrangler d1 execute <db> --remote --command "SELECT …"` from the admin's machine; no admin screen needed. |

HTTPS is required for service workers and Web Push; `workers.dev` provides it with no certificate or domain work.

### Alternatives considered

- **A small always-on VM or home server.** Gives full control and any database, but brings OS patching, TLS certificates, process supervision and backups, all for a handful of users. A home server would also need to be exposed to the internet so the PWA can reach it from mobile networks.
- **A backend-as-a-service with a hosted Postgres.** Fits the SQL model, but adds a second platform alongside whatever serves the PWA, and the spike gave no evidence about sending Web Push from it.

Neither has an advantage that matters at this scale, and Workers already has a working push path.

## Consequences

- **Use D1, not KV, for anything read back after a write.** In the spike, KV `list` lagged writes by tens of seconds. KV is not used for sessions or subscriptions.
- **CPU budget per invocation is 10 ms on Free**, for both HTTP requests and Cron Triggers. Waiting on the network does not count. Each push costs one ECDH, one ECDSA signature and one AES-GCM encryption, which is well inside this for a few learners. If a cron run ever needs to push to many subscriptions, check its CPU time; the cron run is also limited to 50 subrequests, so 50 pushes per run.
- **Day boundaries are UTC.** Free-plan daily limits reset at 00:00 UTC (09:00 JST). This affects quota only; session day attribution stays JST as #3 specifies.
- **Backups.** D1 Time Travel keeps 7 days of point-in-time history on Free. That covers mistakes, not loss of the account. A periodic `wrangler d1 export` kept outside Cloudflare is still needed; it is tracked in #11 rather than in this decision.
- **Hitting a daily limit stops D1 queries until 00:00 UTC.** At koke's scale this is not expected; upgrading to Workers Paid lifts it.
- **Lock-in is moderate.** The data is SQLite and exports as SQL. The Worker code depends on Workers bindings (`env.DB`, `scheduled`), which would need a thin rewrite elsewhere.
- **Domain.** v1 uses the `workers.dev` hostname. A custom domain can be added later without code changes; push subscriptions are tied to the origin, so learners would need to re-add the app to the home screen if the origin changes.
- The spike Worker stays deployed for trying Cron Triggers in #6 and is deleted afterwards.

Limits quoted from the Cloudflare Workers and D1 documentation as of 2026-11-15.
