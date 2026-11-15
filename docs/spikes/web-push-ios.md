# Spike: Web Push on an iOS home-screen PWA

Issue: #1. Use case: L6 ("still studying?").
Date: 2026-11-15. Device: iPhone, iOS 27.2.1. Push service: `web.push.apple.com`.
Setup: the throwaway Worker in `spikes/web-push/` on Cloudflare Workers (workers.dev), added to the home screen from Safari.

## Question

Can the server reach a learner with a push notification when koke is installed as a home-screen PWA, and does tapping it bring the learner back into koke with our code running? L6 depends on both.

## Result

Yes. Every push sent while the phone was online arrived within 2 seconds, in every app state tried, including after 20 minutes locked. Tapping the notification opened koke and our page code ran every time.

| # | Situation | Arrived | Lag: server clock / phone clock | Tap opened koke |
|---|---|---|---|---|
| 1 | App in the foreground | yes | 0.4 s / 0.8 s | – |
| 2 | App in the background | yes | 0.9 s / 1.1 s | yes |
| 3 | Phone locked (30 s) | yes, screen woke | 0.9 s / 1.0 s | yes |
| 4 | App swiped away | yes | 1.0 s / 1.3 s | yes |
| 5a | Offline, `TTL: 60`, back online after 17 min | no (expired) | – | – |
| 5b | Offline, `TTL: 3600`, back online after 17 min | yes, on reconnect | 17 min | – |
| 6 | Phone locked for 20 min | yes, screen woke | 1.8 s / 1.8 s | – |

Two lag figures are given. *Server clock*: from the server logging the send (after the push service accepted it) to the server receiving the service worker's acknowledgement, so it includes the acknowledgement's upload. *Phone clock*: from the send time in the payload to the service worker's `push` handler, which compares two clocks that were not synchronised. Both stay under 2 seconds; neither is precise below a few hundred milliseconds.

## Observations that matter for #6

- **Focus modes hide the prompt.** During test 1 a Focus mode was on. The push arrived and sat in Notification Centre, but no banner appeared. A learner who studies with a Focus mode on may never see "still studying?", so the session ends at notification time as L6 already specifies. This is the expected outcome of the use case, not a bug, but the copy and the interval should assume the prompt can be missed.
- **Tapping after a swipe-away still finds a window.** In test 4 the service worker's `notificationclick` saw an existing client and focused it rather than calling `openWindow`. iOS appears to launch the PWA before dispatching the click (inferred, not verified). Either way our code ran. The extend action for L6 should therefore live in the service worker's `notificationclick`, which covers both launch paths.
- **TTL works as specified.** An expired push is dropped by Apple; one within its TTL is delivered on reconnect. For #6, set the TTL to roughly the response window so a stale "still studying?" is not shown long after the session was already closed, and decide what tapping a late notification does if the session has already ended.
- **Every push must show a notification.** iOS revokes subscriptions that receive silent pushes, so the service worker always calls `showNotification`.

## Notes for the hosting ADR (#2)

- Workers ran VAPID signing and aes128gcm encryption with WebCrypto alone; no `nodejs_compat` or npm dependency was needed. `src/webpush.ts` can move into the product.
- Workers KV `list` lagged writes by tens of seconds, which made the event log slow to read. KV is a poor fit for anything that is read back right after it is written; the session store should be D1 (or another SQL store), which matches the revision model in #3 anyway.
- A scheduled trigger was not tried here; #6 needs one.

## Not covered

- Behaviour after days without opening the app (subscription expiry).
- Older iOS versions and Android.
- Delivery while Low Power Mode is on.
