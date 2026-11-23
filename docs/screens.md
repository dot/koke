# Screens

What each screen of the PWA shows and when. The use cases in `docs/use-cases.md` decide what koke does; this document decides how it looks. The prototype in `spikes/ui-prototype/` is the visual reference. UI text is Japanese; the strings below are the ones the prototype uses.

## Layout

- Header: the name "koke". On a PC it adds "閲覧のみ" (view only).
- Tab bar at the bottom (iPhone only): 勉強 (study), 苔 (moss), 記録 (records), 教科 (subjects). koke opens on 勉強.
- A PC shows only the moss, without the tab bar (L7: PC is view-only).
- The header, tab bar and every bottom sheet pad by `env(safe-area-inset-*)`, so the notch and home bar never cover a control.
- Choices open as bottom sheets (drawer). Questions that need an answer, and delete confirmations, are alert dialogs.

## 勉強: start (L2)

Shown when no session is running.

- One large "始める" (start) button. It starts an uncategorized session.
- Below it, "教科を決めて始める" (start with a subject) and the subject buttons: one row per parent subject, with the parent first and its visible children after it, so any subject is one tap. The row holding the subject used last comes first. Hidden subjects are left out; hiding a parent hides its row.

## 勉強: running (L3, L4)

Shown while a session is running.

- Elapsed time (h:mm:ss) and the start time ("16:05 から").
- Above the time:
  - Uncategorized session: a dashed "＋教科" chip. Tapping it opens the subject sheet titled "何を勉強してる？" with "<start time> から、この教科として記録します". The chosen subject applies to the whole session from its start. Nothing prompts the learner to use it.
  - Session with a subject: the subject, as "数学 › 数I" for a child.
- "終わる" (stop): ends the session now.
- "教科を切り替える" (switch subject), only for a session with a subject: opens the subject sheet titled "何に切り替える？" with "いまの記録はここで区切り、新しく始めます". Picking a subject ends this session now and starts a new one. The current subject is left out of the sheet.

## Absence question (L5)

An alert dialog over the running screen, shown when koke comes back after being away for at least the fixed threshold.

- Title "N 分離れていました", text "その間も勉強していましたか？".
- "していた" (yes) keeps the session running. On the iPhone the two buttons are the only way to close the dialog (an alert dialog does not close on a tap outside it); closing it any other way, such as Escape on a keyboard, counts as yes.
- "していなかった" (no) ends the session at the moment koke went away.
- The question stays open until answered. If koke goes away again before the answer, the question keeps its first moment, since that is the earliest the learner may have stopped. If the session ends some other way meanwhile, the question goes away.

## Opened from the notification (L6)

Tapping the "still studying?" notification opens koke, which reads the current session first:

- Still running: koke extends it and shows the running screen with a short banner, "通知から開いたので、そのまま続けています", that fades after a few seconds. The absence question is not asked on this return; tapping the notification already answered it.
- Already ended because nobody answered in time: koke shows the start screen with a short banner, "通知の時刻で記録を終えています". Nothing else is asked; the learner can fix the end time in 記録 if they want to.

## 苔: moss (L7)

- Top: the subject filter (select) and, on the iPhone, "PC で見る".
  - Filter choices: "すべての教科"; each parent, labelled "数学（まとめて）" when it has children, which counts the parent and its children; each child as "数学 › 数I". Hidden subjects stay in the filter, since their records stay.
- A 週 / 月 / 年 (week / month / year) switch. The moss opens on 月.
- Days are JST calendar days, whatever the device's time zone, and a session counts on the day it started. A day's minutes are its sessions' durations added up first and then rounded down to whole minutes, as `/api/summary` does.
- **月 (month):** the month as a Monday-first calendar. Each day is a square cell shaded by its minutes, with the date inside. Tapping a day shows "11月10日（火） 1時間34分" (or "勉強なし") below the calendar, next to the month total. Arrows move one month at a time within the 53-week window. Days outside the window or in the future are faded and cannot be tapped. The oldest month is usually cut by the window; its total then says where it starts ("11/10 から 計 …").
- **週 (week):** Monday to Sunday as seven rows: the date and weekday, a bar, and the minutes. Bars are shaded like the heatmap and scaled to the longest day of the week, but never less than 3 hours, so a light week does not look full. Arrows move one week at a time. The week total sits below, with "… から" when the window cuts the week.
- **年 (year):** the last 53 weeks as one heatmap strip that fits the screen width, with month labels and no weekday labels. It is an overview: tapping anywhere opens that day's month in the 月 view.
- Shades are the same in every view: none, then from 1, 30, 60 and 120 minutes. A legend "少 … 多" sits below the view.
- Bottom: three tiles for this week's total, this month's total and the current streak ("12日"), for the same filter. They do not change with the view.
- Uncategorized sessions count only under "すべての教科".

## PC pairing (L7)

- iPhone: "PC で見る" opens a sheet with the 6-digit code, a countdown of how long it stays valid, and a note that the PC can only view.
- PC without a valid cookie: a code entry (six boxes). A correct code opens the moss.
- A wrong code says "番号が違います" and keeps the boxes for another try. An expired or used code says the same, since the PC cannot tell them apart from a wrong one.
- While pairing is paused after 5 wrong attempts across koke (ADR 2), the PC says "しばらくしてから、新しい番号でもう一度" and the boxes are disabled until the pause ends.
- On the iPhone, a code that ran out shows "時間切れです。もう一度開いてください"; closing and reopening the sheet asks for a new code. If pairing is paused when the sheet opens, it says the same as the PC instead of showing a code. A pause that starts while the sheet is open does not change it; the code shown has already been spent and simply no longer works.

## 記録: records (L8)

- Sessions grouped by day, newest first, each day headed by its date and total. Each row shows the subject ("教科なし" when uncategorized), the start and end times ("計測中" while running) and the minutes.
- The list starts with the last 14 days; "もっと前を見る" adds 14 more.
- Tapping a row opens "記録を直す" (fix a record) in a sheet:
  - 教科: a select with every subject (children as "数学 › 数I") and "教科なし".
  - 開始 and 終了: the iOS date-time pickers. 終了 may be empty only for the running session, where filling it in stops the session. An ended session cannot be reopened, so its 終了 cannot be cleared.
  - Errors shown inline, and "保存する" disabled while one shows: a time in the future, the end before the start, an empty end on an ended session, or a start more than 7 days from when the session was recorded (`recorded_at`, which never changes, so repeated fixes cannot walk a session further).
  - "この記録を消す" opens a confirmation ("この記録を消しますか？ 苔からもなくなります。") with "やめる" and "消す".

## 教科: subjects (L9)

- An add form: the name, and "上の教科なし" or "<parent> の下" to place it under a parent. Only top-level subjects can be parents.
- The list: each parent with its children indented below it. Each row has up and down arrows that move it among its siblings, and a switch that shows or hides it.
- A note under the list: hidden subjects leave the start buttons, hiding a parent hides its children too, and past records stay in the moss.

## Not in the prototype

- Behaviour when the network is down. #4 decides it, along with the service worker.
- Renaming a subject or moving it to another parent.
- The invitation pages (A1, ADR 2). #13 builds them.
