# Use cases

What koke is for, who uses it, and what each of them does with it. This is the reference for scoping issues; anything not listed here is out of scope until it is added.

## Actors

- **Learner**: someone who studies and wants to watch their own patch of moss grow. Several learners can share one deployment; each one sees only their own records.
- **Admin**: whoever runs the server. Invites learners and can read every record directly in the database. There is no admin screen in v1.

## Ground rules

- koke exists to motivate the learner, not to manage them. It never nags: no reminders to study, no prompts to fill in missing data.
- The learner's records are private to the learner within the app. The admin can read them as the operator of the database; the app makes no promise either way.
- Accounts are created by invitation from the admin; there is no self-signup.

## Learner use cases

### L1. Set up on the phone

The learner receives an invitation from the admin, opens the link on their iPhone, adds the page to the home screen, and allows notifications. Nothing else is required: no shortcuts, no NFC tags, no app install.

### L2. Start studying

The learner opens koke. Because no session is running, the screen shows one large "start" button, with the subject buttons below it. "Start" begins an uncategorized session; tapping a subject begins a session for that subject. The subject used last time is shown first. Starting never requires choosing a subject.

### L3. Pick or switch subject mid-session

While an uncategorized session is running, the learner can pick a subject for it. The subject applies to the whole session from its start; nothing is split. koke never asks the learner to pick one.

While a session is running, the learner taps "switch subject" and picks another subject. The current session ends at that moment and a new one starts for the new subject. No time is split retroactively.

### L4. End studying

While a session is running, the learner taps "stop". The session ends at that moment.

### L5. Come back after the phone was away

Locking the phone or switching to another app does not end a session. Studying on paper with the phone locked on the desk is the normal case, and the session simply keeps running.

What koke does is notice when the phone comes back. When the learner reopens koke after it was away longer than a fixed threshold, it asks "You were away for N minutes. Were you still studying?" The default is yes: answering "yes" (or dismissing the question) keeps the session running as if nothing happened. Only answering "no" ends the session, and then the end time is the moment the phone went away, so time spent elsewhere is not counted. Shorter absences are never asked about.

### L6. Forget to stop

The learner leaves a session running and never comes back. After a fixed interval, the server sends a push notification asking "still studying?". Tapping it opens koke and extends the session. If the learner does not respond, the session is ended at the time the notification was sent.

### L7. Look at the moss

The learner opens koke on the iPhone or in a browser on a PC (the first time on a PC, they type a short pairing code that koke shows on the iPhone) and sees:

- one view at a time, switched between three periods: **year** (a GitHub-style heatmap of 53 weeks, one cell per day; tapping it opens that month), **month** (the month as a calendar heatmap whose days can be tapped to show their minutes) and **week** (the seven days as bars with their minutes). Shades use the same fixed steps in every period.
- a subject filter (all subjects, a subject group, or a single subject) that changes what the view counts; choosing a group counts its sub-subjects too
- weekly and monthly totals, and the current run of consecutive study days, for the same filter

Uncategorized sessions count toward the "all subjects" view and the totals, but do not appear under any subject or group.

A session belongs to the day it started, even if it ran past midnight.

### L8. Fix a record

The learner opens a past session and changes its start time, end time or subject, or deletes it. This is done on the iPhone. Corrections are self-reported and accepted as given; koke never asks the learner to justify or revisit them.

### L9. Manage subjects

The learner adds subjects, reorders them and hides the ones they no longer use. Hidden subjects keep their past records. Each learner has their own subject list.

Subjects can be grouped one level deep: a subject may sit under a parent subject (for example Math > Math I). A session has exactly one subject, either a parent or a child.

## Admin use cases

### A1. Invite a learner

The admin creates an account for a learner and hands them a single-use invitation link directly. Opening it on the iPhone and adding koke to the home screen signs that phone in (ADR 2). When the learner replaces or loses the phone, the admin issues a new invitation for the same account and the records carry on.

### A2. Read the records

The admin reads sessions and their revision history directly in the database. There is no admin screen in v1.

## Fixed in v1

These are constants in the code, not settings. Changing them means a deploy.

- The absence threshold before koke asks "were you still studying?" (L5)
- The interval before the "still studying?" notification (L6), and how long to wait for a response

## Out of scope for v1

- Shortcuts automations, NFC tags, Focus mode triggers
- A native iOS app
- Starting or stopping sessions from a PC browser (PC is view-only)
- Scheduling or reserving study time
- An admin screen
- Per-learner settings for thresholds and intervals
- Sharing a heatmap with anyone

## Open decisions

None at the moment. Hosting is decided in ADR 1 and learner identity in ADR 2 (`docs/adr/`).
