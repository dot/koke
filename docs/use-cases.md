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

The learner opens koke. Because no session is running, the screen shows the subject buttons. Tapping a subject starts a session for that subject. There is also a "not decided" button that starts an uncategorized session. The subject used last time is shown first.

### L3. Switch subject mid-session

While a session is running, the learner taps "switch subject" and picks another subject. The current session ends at that moment and a new one starts for the new subject. No time is split retroactively.

### L4. End studying

While a session is running, the learner taps "stop". The session ends at that moment.

### L5. Come back after the phone was away

Locking the phone or switching to another app does not end a session. Studying on paper with the phone locked on the desk is the normal case, and the session simply keeps running.

What koke does is notice when the phone comes back. When the learner reopens koke after it was away longer than a fixed threshold, it asks "You were away for N minutes. Were you still studying?" The default is yes: answering "yes" (or dismissing the question) keeps the session running as if nothing happened. Only answering "no" ends the session, and then the end time is the moment the phone went away, so time spent elsewhere is not counted. Shorter absences are never asked about.

### L6. Forget to stop

The learner leaves a session running and never comes back. After a fixed interval, the server sends a push notification asking "still studying?". Tapping it opens koke and extends the session. If the learner does not respond, the session is ended at the time the notification was sent.

### L7. Look at the moss

The learner opens koke on the iPhone or in a browser on a PC and sees:

- one GitHub-style heatmap where each cell is one day and its shade is the total minutes studied that day
- a subject filter next to it (all subjects, or a chosen subject) that changes what the heatmap counts; there is only ever one heatmap on screen
- weekly and monthly totals, and the current run of consecutive study days, for the same filter

Uncategorized sessions count toward the "all subjects" view and the totals, but do not appear under any single subject.

A session belongs to the day it started, even if it ran past midnight.

### L8. Fix a record

The learner opens a past session and changes its start time, end time or subject, or deletes it. This is done on the iPhone. Corrections are self-reported and accepted as given; koke never asks the learner to justify or revisit them.

### L9. Manage subjects

The learner adds subjects, reorders them and hides the ones they no longer use. Hidden subjects keep their past records. Each learner has their own subject list.

## Admin use cases

### A1. Invite a learner

The admin creates an account for a learner and hands them an invitation. How identity and authentication work is not decided yet (see the open decisions).

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

- How learners are identified and authenticated (passkey, magic link, Sign in with Apple/Google, or invitation link plus device token), and how the same account is used on both the iPhone and a PC browser
- Hosting platform for the server
