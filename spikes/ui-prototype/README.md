# UI prototype (#17)

A clickable prototype of koke's screens for L2–L9, with fake data and no API. It exists to review the screens on a real iPhone and to judge React + shadcn/ui as the frontend stack (ADR 3). It is not the app; #4 builds that.

- `npm run dev` serves it on the local network.
- `npm run build && npx wrangler deploy` publishes it as the temporary Worker `koke-ui-prototype`.
- The "試作" button opens a menu that reproduces situations that are hard to trigger by hand: coming back after an absence (L5), opening from the "still studying?" notification (L6), and viewing on a PC (L7).

`src/components/heatmap/calendar-heatmap.tsx` is copied from rutopio/shadcn-heatmap (MIT) through the shadcn CLI, with one change: the continuous layout draws one strip instead of one row per calendar year.
