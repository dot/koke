# koke

A personal study-time heatmap that grows like moss (苔, *koke*).

It is not for showing anyone, and it is not a time manager. It is a patch of green on your own desk that slowly spreads as you study, and that is the whole point.

## What it does

- Records when a study session starts and ends, and shows daily totals as a GitHub-style contribution heatmap
- Filters the heatmap by subject or shows everything at once
- Lets you correct a record afterwards by self-report

## How it is built

- **Client**: a PWA added to the iPhone home screen. One screen that asks "start?" or "were you still going?" depending on the state it finds when opened
- **Server**: holds the records and serves the heatmap. Also sends a scheduled "still studying?" push notification to catch sessions you forgot to end. The hosting platform is not decided yet

Setting it up on a phone takes three actions: open the link, add to home screen, allow notifications. Shortcuts, NFC tags and other automation are optional add-ons, never a requirement.

## Data model

A session is a stack of immutable revision rows. Start, stop, adjust and delete are all expressed by appending a new row; existing rows are never updated. The heatmap reads only the latest revision of each session.
