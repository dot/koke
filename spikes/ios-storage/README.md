# iOS PWA storage spike (#8)

Throwaway Worker that shows what an iOS home-screen PWA can see, to choose how learners are identified (#8). Codes are random placeholders; nothing here authenticates anyone or stores data.

- **(B) Invitation link**: `/invite/<code>` opened in Safari sets a cookie, writes localStorage and links a manifest whose `start_url` is `/?handoff=<code>`. After Add to Home Screen, `/` in the PWA shows which of the three survived.
- **(A) Round trip through another origin** (what Sign in with Google does): the same code is deployed a second time as the fake identity provider. `/idp/authorize` on that origin sends the browser back to `/callback` on the app's origin, which sets a cookie. Each page shows whether it is rendered inside the PWA (`standalone`).

## Deploy

```sh
npm install
npx wrangler deploy --name koke-idp-spike
npx wrangler deploy --var IDP_ORIGIN:https://koke-idp-spike.<subdomain>.workers.dev
```

Results go in `docs/spikes/ios-pwa-storage.md`.
