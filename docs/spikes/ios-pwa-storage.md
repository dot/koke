# Spike: getting a login into an iOS home-screen PWA

Issue: #8. Use cases: A1, L1, L7.
Date: 2026-11-15. Device: iPhone, iOS 27.2.1.
Setup: the throwaway Worker in `spikes/ios-storage/`, deployed twice on Cloudflare Workers (workers.dev): once as the app and once as a fake identity provider on a second origin.

## Question

A learner opens an invitation in Safari and then adds koke to the home screen (L1). iOS keeps home-screen web apps' storage apart from Safari's, so it was not clear whether anything the invitation stores would reach the PWA. Separately, Sign in with Google leaves the app's origin and comes back, and in a standalone PWA that round trip might end up in a browser view instead of the app. Either problem would rule out one of the candidates in #8.

## Result

| Check | Result |
|---|---|
| A cookie set by the server while the invitation was open in Safari is visible in the PWA | yes |
| localStorage written in Safari is visible in the PWA | no |
| The manifest's `start_url` (`/?handoff=<code>`), served per invitation, is used when launching from the home screen | yes |
| A cookie set inside the PWA is still there after swiping the app away and relaunching | yes |
| Leaving the PWA for another origin and redirecting back keeps the login in the PWA | yes |

Details of the round trip (A):

- Navigating to the other origin opened an in-app browser sheet on top of the PWA.
- Inside that sheet, `matchMedia("(display-mode: standalone)")` still reported `true`, so display mode cannot tell the sheet from the app.
- Redirecting back to a URL inside the PWA's scope closed the sheet and loaded the page in the PWA itself. The cookie set by that response was then visible to the PWA.

## What this means for #8

- **Invitation link + device token works without adding a step to L1.** The per-invitation `start_url` carries a one-time code into the PWA's first launch, where it can be exchanged for a device token. This path relies on the standard manifest `start_url`. The cookie copy from Safari also worked, but it is undocumented iOS behaviour, so it should not be the only path.
- **Sign in with Google is not ruled out by iOS.** The round trip lands back in the PWA with its cookie. This used a fake identity provider; Google's own policies (for example on supervised Family Link accounts) were not tested.

## Not covered

- How long cookies survive in the PWA over weeks without use.
- Real Google sign-in.
- Adding to the home screen from a page that is not the invitation (the `start_url` would then carry no code).
