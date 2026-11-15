// Fake data for the prototype. Nothing here talks to a server.

export type Subject = { id: number; name: string; hidden: boolean }
export type Session = { id: number; subjectId: number | null; start: number; end: number | null }

const MIN = 60_000
const DAY = 24 * 60 * MIN

export const initialSubjects: Subject[] = [
  { id: 1, name: '数学', hidden: false },
  { id: 2, name: '英語', hidden: false },
  { id: 3, name: '国語', hidden: false },
  { id: 4, name: '理科', hidden: false },
  { id: 5, name: '社会', hidden: false },
  { id: 6, name: '漢検', hidden: true },
]

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
      const subjectId = rand() < 0.1 ? null : 1 + Math.floor(rand() * 6)
      out.push({ id: id++, subjectId, start: t, end: t + len })
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

// What /api/summary would return: minutes per day for the last 53 weeks, totals and the streak.
export function summarize(sessions: Session[], filter: Filter, now: number) {
  const today = startOfDay(now)
  const from = today - 370 * DAY
  const days = new Map<string, number>()
  for (const s of sessions) {
    if (s.start < from) continue
    if (filter !== 'all' && s.subjectId !== filter) continue
    const k = dateKey(s.start)
    days.set(k, (days.get(k) ?? 0) + minutesOf(s, now))
  }
  const monday = today - ((new Date(today).getDay() + 6) % 7) * DAY
  const firstOfMonth = new Date(today)
  firstOfMonth.setDate(1)
  let week = 0
  let month = 0
  for (const s of sessions) {
    if (filter !== 'all' && s.subjectId !== filter) continue
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
