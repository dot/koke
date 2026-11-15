# 3. Build the PWA with React, Tailwind CSS and shadcn/ui

- Status: Accepted
- Date: 2026-11-15
- Issue: #17

## Context

The PWA has seven state-driven screens (start, running, absence question, moss, record list and editor, subjects, PC pairing) and two forms with validation (L8, L9). It runs mainly as an iOS home-screen app, so sheets, dialogs and safe areas have to feel right on an iPhone, and the moss needs a calendar heatmap.

A clickable prototype in `spikes/ui-prototype/` (fake data, no API) was built with the candidate stack and reviewed from the home screen of a real iPhone. The review also changed the use cases (L2, L3, L7, L9): starting no longer needs a subject, subjects are grouped one level deep, and the moss switches between week, month and year.

## Decision

- **React 19 + Vite + TypeScript**, styled with **Tailwind CSS v4**.
- **shadcn/ui** components on Base UI, copied into the repo by the shadcn CLI: button, drawer (bottom sheet), alert-dialog, toggle-group, select, input, label, switch, input-otp, card, badge, separator.
- **Year view of the moss:** `CalendarHeatmap` from rutopio/shadcn-heatmap (MIT), copied into `src/components/heatmap/`, with one local change so the 53 weeks draw as one strip instead of one row per calendar year. Shades come from fixed minute steps (1, 30, 60, 120) through each block's `fill`, not from the component's relative levels.
- **Month and week views:** hand-written (a CSS grid calendar and plain bars). They need tappable, labelled cells, which the SVG heatmap does not give at that size.
- **53 weeks on a phone:** the year view fits the screen width (about 5px cells) and is an overview only; tapping it opens that month. Tapping a day happens in the month view, whose cells are large enough to aim at. Horizontal scrolling was tried and dropped: it showed about four months at once and still needed the month view for accurate taps.

## Why

| Requirement | How it is met |
|---|---|
| Many small state-driven screens and forms | React components with local state; no router or state library was needed in the prototype. |
| iPhone feel for sheets and dialogs | The shadcn drawer and alert-dialog behaved as expected on the device, including swipe-to-close and the home-bar inset. |
| Safe areas | `viewport-fit=cover` plus `env(safe-area-inset-*)` padding on the header, tab bar and sheets; reviewed on the device. |
| A heatmap that reads well and can be tapped | Year as an overview strip, month as a tappable calendar, both with the same fixed shades. |
| Size | JS 170 KB and CSS 13 KB (gzip) for the whole prototype. Most of the JS is react-dom and Base UI; date-fns is about 7%. Acceptable for an app that stays installed and is cached. |

### Alternatives considered

- **Preact with `preact/compat`.** It can run React components, so the same shadcn/Base UI components might work at a smaller size. Whether Base UI behaves the same under it on iOS was not tested. The size saving does not matter enough for a home-screen app used daily by a few learners to take on that check.
- **Plain HTML with a hand-written SVG heatmap.** Smallest, but every sheet, dialog, select and OTP input would be written and tuned for iOS by hand.
- **Tremor.** No calendar heatmap, and `@tremor/react` supports React 18 only.
- **Other heatmap components** (goodui, `@thilakbhat/heatmap-ui`). The first was a fallback that was not needed; the second was too new to depend on.

## Consequences

- Copied components (shadcn, the heatmap) are ours to maintain. Upstream fixes do not arrive by themselves; updating means re-running the CLI and re-applying the heatmap change.
- The heatmap wraps itself in padding by default. The year view turns it off, because the cell size is computed from the screen width and the padding would push the right end out of view.
- The heatmap thins month labels, so the rightmost month label can be missing in the year view. The year view is an overview, so this is accepted.
- date-fns is pulled in only by the heatmap. If size becomes a concern, the year view is the part to rewrite by hand.
- The screen behaviour is specified in `docs/screens.md`; #4, #5, #7 and #9 build against it.
