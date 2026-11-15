// Fake data for the prototype. Nothing here talks to a server.

// parentId groups subjects one level deep (L9); a parent never has a parent itself.
export type Subject = { id: number; name: string; hidden: boolean; parentId: number | null }
// recorded is when the session was created; it never changes and bounds how far L8 may move the start.
export type Session = { id: number; subjectId: number | null; start: number; end: number | null; recorded: number }

const MIN = 60_000
const DAY = 24 * 60 * MIN

export const initialSubjects: Subject[] = [
  { id: 1, name: '数学', hidden: false, parentId: null },
  { id: 7, name: '数I', hidden: false, parentId: 1 },
  { id: 8, name: '数II', hidden: false, parentId: 1 },
  { id: 2, name: '英語', hidden: false, parentId: null },
  { id: 3, name: '国語', hidden: false, parentId: null },
  { id: 4, name: '理科', hidden: false, parentId: null },
  { id: 9, name: '物理', hidden: false, parentId: 4 },
  { id: 10, name: '化学', hidden: false, parentId: 4 },
  { id: 5, name: '社会', hidden: false, parentId: null },
  { id: 6, name: '漢検', hidden: true, parentId: null },
]

// Parents in list order, each followed by its children in list order.
export function tree(subjects: Subject[]): { parent: Subject; children: Subject[] }[] {
  return subjects
    .filter((s) => s.parentId === null)
    .map((parent) => ({ parent, children: subjects.filter((s) => s.parentId === parent.id) }))
}

export function subjectName(subjects: Subject[], id: number | null): string {
  return subjects.find((s) => s.id === id)?.name ?? '教科なし'
}

// "数学 › 数I" where the short name alone could be ambiguous out of context.
export function subjectPath(subjects: Subject[], id: number): string {
  const s = subjects.find((x) => x.id === id)
  const parent = subjects.find((x) => x.id === s?.parentId)
  return parent ? `${parent.name} › ${s?.name}` : (s?.name ?? '')
}

export function startOfDay(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// About a year of history: some days off, a current run of 12 days, busier near exams.
export function fakeSessions(now: number): Session[] {
  let seed = 7
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
  const out: Session[] = []
  const today = startOfDay(now)
  let id = 1
  for (let i = 370; i >= 1; i--) {
    const day = today - i * DAY
    const inStreak = i <= 11
    if (!inStreak && rand() < 0.3) continue
    if (i === 12) continue
    const n = 1 + Math.floor(rand() * 3)
    let t = day + (16 * 60 + Math.floor(rand() * 90)) * MIN
    for (let s = 0; s < n; s++) {
      const len = (15 + Math.floor(rand() * 75)) * MIN
      const subjectId = rand() < 0.1 ? null : 1 + Math.floor(rand() * 10)
      out.push({ id: id++, subjectId, start: t, end: t + len, recorded: t })
      t += len + (5 + Math.floor(rand() * 30)) * MIN
    }
  }
  return out
}

export function minutesOf(s: Session, now: number): number {
  return Math.floor(((s.end ?? now) - s.start) / MIN)
}

export function dateKey(t: number): string {
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function formatMinutes(m: number): string {
  if (m < 60) return `${m}分`
  const h = Math.floor(m / 60)
  return m % 60 === 0 ? `${h}時間` : `${h}時間${m % 60}分`
}

export function formatClock(t: number): string {
  const d = new Date(t)
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']
export function formatDay(t: number): string {
  const d = new Date(t)
  return `${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAYS[d.getDay()]}）`
}

export type Filter = 'all' | number

// A parent filter counts its children; uncategorized sessions only count under 'all' (L7).
function matcher(subjects: Subject[], filter: Filter) {
  return (s: Session) =>
    filter === 'all' ||
    s.subjectId === filter ||
    subjects.find((x) => x.id === s.subjectId)?.parentId === filter
}

// What /api/summary would return: minutes per day for the last 53 weeks, totals and the streak.
export function summarize(sessions: Session[], subjects: Subject[], filter: Filter, now: number) {
  const match = matcher(subjects, filter)
  const today = startOfDay(now)
  const from = today - 370 * DAY
  const days = new Map<string, number>()
  for (const s of sessions) {
    if (s.start < from) continue
    if (!match(s)) continue
    const k = dateKey(s.start)
    days.set(k, (days.get(k) ?? 0) + minutesOf(s, now))
  }
  const monday = today - ((new Date(today).getDay() + 6) % 7) * DAY
  const firstOfMonth = new Date(today)
  firstOfMonth.setDate(1)
  let week = 0
  let month = 0
  for (const s of sessions) {
    if (!match(s)) continue
    if (s.start >= monday) week += minutesOf(s, now)
    if (s.start >= firstOfMonth.getTime()) month += minutesOf(s, now)
  }
  let streak = 0
  let d = days.has(dateKey(today)) ? today : today - DAY
  while (days.has(dateKey(d))) {
    streak++
    d -= DAY
  }
  return { from, today, days, week, month, streak }
}
