# koke

- Language: English for everything checked in (README, docs, code comments, commit messages, issues). Japanese stays in chat only.
- Purpose: a self-motivation heatmap for each learner. Do not add management, sharing or nudging features without being asked.
- Data: sessions are append-only revision rows. Never add UPDATE/DELETE paths to session data.

## Keep design, use cases and issues consistent

`docs/use-cases.md` is the source of truth for what koke does; issues are the units of work derived from it. Every time a design or implementation step lands, run this check before reporting it done:

1. Name the use case(s) (L1–L9, A1–A2) the change serves. A change that serves none is out of scope: stop and ask.
2. Re-read those use cases and confirm the behaviour matches, including the ground rules (no nagging, learners see only their own records, invitation only, fixed constants in v1).
3. Re-read the issue being worked on and confirm the change stays inside its Scope / Behaviour / Done-when. If the work reveals the issue is wrong or incomplete, update the issue (or file a new one) before continuing; do not quietly widen it.
4. If the use case document itself turns out to be wrong, propose the edit to `docs/use-cases.md` and get it agreed before building against the new reading.
5. In the PR or commit message, state which use case and issue the change serves.
