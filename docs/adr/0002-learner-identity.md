# 2. Identify learners by invitation link and device token

- Status: Accepted
- Date: 2026-11-15
- Issue: #8

## Context

koke needs to know which learner each request comes from, so that a learner sees only their own records. The requirements in #8:

- Learners are whoever the admin invites; no self-signup (A1, ground rules)
- The same account works on the iPhone PWA and in a PC browser, which is view-only (L7)
- A learner must not be able to see another learner's records
- Setup on the phone stays at: open the link, add to home screen, allow notifications (L1)
- No passwords to remember if we can avoid it

The candidates were passkeys, magic links by email, Sign in with Apple or Google, and an invitation link with a device token. The spike in `docs/spikes/ios-pwa-storage.md` checked the two iOS behaviours this choice depends on.

## Decision

Learners are identified by **device tokens issued through invitation links**. Sign in with Google may be added later as a second way in (#14); it is not part of v1.

### Accounts

- The admin creates a row in `users` (an internal `user_id` and a display name). Every session revision, subject and push subscription belongs to a `user_id`.
- Login methods only decide which `user_id` a request acts as. Adding another method later does not touch the records.

### Invitation (A1)

1. The admin creates an invitation for a `user_id` in D1: a random one-time code, stored hashed, valid for 24 hours. The admin then hands the learner `https://<koke origin>/invite/<code>` directly (in person or by direct message).
2. Opening the link in Safari shows the add-to-home-screen instructions. The page links a manifest generated for this invitation, whose `start_url` is `/?handoff=<code>`. Opening the page does not use up the code, so link previews in chat apps cannot spend it.
3. On the first launch from the home screen, the PWA sends the code to the server, which marks the invitation used and issues a device token.
4. If the code has expired or was already used, koke says so and asks the learner to get a new link from the admin. It does not offer self-service recovery.

### Device tokens

- A device token is 32 random bytes in an `HttpOnly; Secure; SameSite=Lax` cookie. D1 stores only its SHA-256 in `devices`, with `user_id`, `kind` (`phone` or `pc`), a label, and the issue and revoke times.
- Every API request resolves cookie → `devices` → `user_id`. All queries are scoped to that `user_id`.
- The cookie is re-issued on use, so an active device stays signed in.
- `pc` devices are read-only: the API rejects any write from them (L7: PC is view-only).
- The admin revokes a device by setting its revoke time in D1. This is the device table, not session data, so the append-only rule for sessions does not apply.

### PC browser (L7)

1. On the iPhone, the learner opens "use on a PC". koke shows a 6-digit pairing code that is valid for 5 minutes and single use.
2. The learner opens koke on the PC and types the code.
3. The server issues a `pc` device token for the same `user_id`.

No admin is involved, and nothing needs to be typed on the phone.

### New or lost phone

The admin revokes the old device and issues a new invitation for the same `user_id`. The records carry on under that `user_id`.

## Why

| Requirement | How it is met |
|---|---|
| Invitation only | The only way to get a device token is an invitation the admin created, or a pairing code from a device that already has one. |
| Same account on iPhone and PC | Both devices map to the same `user_id`; the PC pairs from the phone. |
| No access to other learners' records | Every query is scoped to the `user_id` from the device token; there is no endpoint that takes a `user_id` from the client. |
| L1 stays at three steps | The spike showed that a per-invitation `start_url` reaches the PWA's first launch, so no code needs to be typed. |
| No passwords | There are none. |

### Alternatives considered

- **Sign in with Google.** The spike showed the round trip through another origin lands back in the PWA with its cookie, so it works on iOS. It makes PC sign-in and phone replacement self-service. It also adds a sign-in step to L1, may need parent approval on supervised Family Link accounts, and needs an OAuth client in Google Cloud for the admin to set up and maintain. For a handful of invited learners, the admin handling replacements by hand costs less. Filed as #14 for later.
- **Passkeys.** These add a Face ID registration step to L1. On a Windows PC, signing in goes through a cross-device QR flow.
- **Magic links by email.** These need an email sender and a learner email address. The link opens in Safari, not in the home-screen PWA, so every sign-in would land in the wrong place on iOS.
- **Sign in with Apple.** This needs a paid Apple Developer Program membership.

## Consequences

- **A leaked invitation link lets someone else become that learner.** The link is single use and lasts 24 hours, and the admin hands it over directly. If it is used by the wrong person, the learner's own first launch fails with "already used", which makes the leak visible. The admin then revokes the device and reissues the invitation.
- **The handoff relies on the manifest `start_url`, not on iOS copying Safari's cookies.** The spike saw both work, but the cookie copy is undocumented iOS behaviour. If a learner adds koke to the home screen from a page other than the invitation, the PWA launches without a code and they need a new link.
- **Losing the phone means asking the admin.** This is acceptable at koke's scale; #14 would remove it.
- **Cookie lifetime over long idle periods is unverified.** A device that is not opened for many weeks may lose its cookie and need a new invitation. The implementation should check this on a real device.
- The tables (`users`, `invitations`, `devices`, `pairing_codes`) and endpoints are built in #13. #3 relies on the `user_id` they provide.
