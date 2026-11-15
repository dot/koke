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

1. The admin creates an invitation for a `user_id` in D1: a one-time code of at least 128 random bits, stored hashed, valid for 24 hours. The admin then hands the learner `https://<koke origin>/invite/<code>` directly (in person or by direct message).
2. Opening the link in Safari shows the add-to-home-screen instructions. The page links a manifest generated for this invitation, whose `start_url` is `/?handoff=<code>`. No GET request changes login state: not the invitation page, not the manifest, not the launch URL. Ordinary link previews in chat apps therefore cannot spend the code. A scanner that runs the page's JavaScript could, and the leak consequence below covers that.
3. When the PWA launches, it first checks for a valid device cookie. If there is one, it is signed in and the `handoff` code is ignored, even if the code is spent or belongs to another account; koke never switches accounts implicitly. Only without a valid cookie does the page `POST` the code to the server, which marks the invitation used and issues a device token in the same transaction. The page then removes `handoff` from the address with `history.replaceState`.
4. If there is no valid cookie and the code has expired or was already used, koke says so and asks the learner to get a new link from the admin. It does not offer self-service recovery.
5. Responses that carry a code in the URL send `Referrer-Policy: no-referrer` and `Cache-Control: no-store`, and codes are never written to logs.

### Device tokens

- A device token is 32 random bytes in a cookie named `__Host-koke` with `Path=/; Max-Age=34560000` (400 days); `HttpOnly; Secure; SameSite=Lax`, and no `Domain`. D1 stores only its SHA-256 in `devices`, with `user_id`, `kind` (`phone` or `pc`), the device it was paired from (for `pc`), a label, and the issue and revoke times.
- Every API request resolves cookie → `devices` → `user_id`. A device counts as valid only if neither it nor the device it was paired from has been revoked.
- Authorisation is more than adding `user_id` to queries. Any `session_id`, `subject_id` or other ID the client sends must belong to that `user_id`, a session's revisions must all share one `user_id`, and views such as `sessions_current` must not mix users. #3 defines these rules.
- Requests that change state check the `Origin` header against koke's own origin.
- The cookie is re-issued on use with a fresh `Max-Age`, so an active device stays signed in.
- `pc` devices are read-only: the API rejects any write from them (L7: PC is view-only).
- The admin revokes a device by setting its revoke time in D1. This is the device table, not session data, so the append-only rule for sessions does not apply.

### PC browser (L7)

1. On the iPhone, the learner opens "use on a PC". koke shows a 6-digit pairing code from a cryptographic random source, valid for 5 minutes and single use. Codes in force at the same time never collide. The code records which phone issued it.
2. The learner opens koke on the PC. Without a valid cookie, a PC browser goes to the pairing page, not the "ask for an invitation" message, and the learner types the code there.
3. The server checks that the issuing phone is still valid, then issues a `pc` device token for the same `user_id` and spends the code in the same transaction.

Guessing is limited by fixed constants. A wrong guess cannot be tied to any one code, so the limit is service-wide: after 5 wrong attempts in total, every unused pairing code is spent and pairing stops for 15 minutes. While a code is in force, an attacker therefore gets at most 5 guesses at it, a 1 in 200,000 chance. A learner who mistypes simply shows a new code once the pause ends.

No admin is involved, and nothing needs to be typed on the phone.

### New or lost phone, or a leaked link

The admin revokes every device of that `user_id`. This also invalidates any PC paired from them and any unused pairing code. The admin then issues a new invitation for the same `user_id`, and the records carry on under it.

## Why

| Requirement | How it is met |
|---|---|
| Invitation only | The only way to get a device token is an invitation the admin created, or a pairing code from a device that already has one. |
| Same account on iPhone and PC | Both devices map to the same `user_id`; the PC pairs from the phone. |
| No access to other learners' records | Every query is scoped to the `user_id` from the device token; there is no endpoint that takes a `user_id` from the client. |
| L1 stays at three steps | The spike showed that a per-invitation `start_url` reaches the PWA's first launch, so no code needs to be typed. |
| No passwords | There are none. |

### Alternatives considered

- **Sign in with Google.** In the spike, leaving the PWA for another origin and following a link back into the PWA's scope returned to the PWA with its cookie, so iOS does not rule it out. An HTTP redirect back (as OAuth uses) and Google's own acceptance of that browser sheet were not tested; #14 checks both. It makes PC sign-in and phone replacement self-service. It also adds a sign-in step to L1, may need parent approval on supervised Family Link accounts, and needs an OAuth client in Google Cloud for the admin to set up and maintain. For a handful of invited learners, the admin handling replacements by hand costs less. Filed as #14 for later.
- **Passkeys.** These add a Face ID registration step to L1. On a Windows PC, signing in goes through a cross-device QR flow.
- **Magic links by email.** These need an email sender and a learner email address. The link opens in Safari, not in the home-screen PWA, so every sign-in would land in the wrong place on iOS.
- **Sign in with Apple.** This needs a paid Apple Developer Program membership.

## Consequences

- **A leaked invitation link lets someone else become that learner.** The link is single use and lasts 24 hours, and the admin hands it over directly. If it is used by the wrong person, the learner's own first launch fails with "already used", which makes the leak visible. The admin then revokes every device of that learner and reissues the invitation.
- **The handoff relies on the manifest `start_url`, not on iOS copying Safari's cookies.** The spike saw both work, but the cookie copy is undocumented iOS behaviour. If a learner adds koke to the home screen from a page other than the invitation, the PWA launches without a code. The likely fix is to delete the icon and add it again from a new invitation page; #13 confirms this on a real device and writes down the steps.
- **Losing the phone means asking the admin.** This is acceptable at koke's scale; #14 would remove it.
- **Cookie lifetime over long idle periods is unverified.** A device that is not opened for many weeks may lose its cookie and need a new invitation. The implementation should check this on a real device.
- The tables (`users`, `invitations`, `devices`, `pairing_codes`) and endpoints are built in #13. #3 relies on the `user_id` they provide.
