# Web Push spike (#1)

Throwaway Worker that checks whether Web Push reaches koke as an iOS home-screen PWA, which use case L6 ("still studying?") depends on. Not part of the product; only `src/webpush.ts` is meant to be carried over to #6.

## Endpoints

| Route | Purpose |
|---|---|
| `GET /` | Test page: permission, subscription state, event log |
| `GET /vapid-public-key` | Public key for `pushManager.subscribe` |
| `POST /subscribe` | Store a subscription (one per endpoint) |
| `POST /send?ttl=60&urgency=high&note=…` | Push to every stored subscription. Needs `Authorization: Bearer $SEND_TOKEN` |
| `POST /ack` | Service worker reports `received` / `clicked`; the page reports `opened` |
| `GET /log` | Timeline of sent / received / clicked / opened events |

## Run locally

```sh
npm install
npm run icons     # only if public/icon-*.png are missing
npm run secrets   # writes .dev.vars (VAPID key + send token), prints nothing secret
npm run dev
```

Open http://localhost:8787 in desktop Chrome, tap "Enable notifications", then:

```sh
T=$(sed -n "s/^SEND_TOKEN='\(.*\)'$/\1/p" .dev.vars)
curl -X POST -H "Authorization: Bearer $T" 'http://localhost:8787/send?note=hello'
```

## Deploy

```sh
npx wrangler login
npx wrangler deploy                      # provisions the KV namespace
npx wrangler secret bulk .dev.vars       # same VAPID key and token as local
```

iOS only allows push for a page added to the home screen, so open the workers.dev URL in Safari, Share → Add to Home Screen, launch it from the icon, then tap "Enable notifications".

## What to observe on the iPhone

Send one push per situation and read `/log`:

1. App in the foreground
2. App in the background (another app open)
3. Phone locked
4. App swiped away from the app switcher
5. Tap the notification: does the PWA open, and does an `opened` event follow `clicked`?
6. Airplane mode, send with `ttl=60` and `ttl=3600`, wait 10 minutes, reconnect: which arrive?

Results go in `docs/spikes/web-push-ios.md`.
