import { useLayoutEffect, useRef, useState } from 'react'
import { ja } from 'date-fns/locale/ja'
import { ChevronLeft, ChevronRight, Monitor } from 'lucide-react'
import {
  CalendarHeatmap,
  CalendarHeatmapBlock,
  CalendarHeatmapBody,
} from '@/components/heatmap/calendar-heatmap'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import {
  dateKey,
  formatDay,
  formatMinutes,
  summarize,
  tree,
  type Filter,
  type Session,
  type Subject,
} from '@/data'
import { ShowPairingCode } from '@/screens/Pairing'

type Period = 'week' | 'month' | 'year'

type Props = {
  sessions: Session[]
  subjects: Subject[]
  now: number
  readOnly?: boolean
}

const DAY = 86_400_000
const WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日']

// Fixed steps in minutes, shared by every period, so one long day does not fade every other day.
const STEPS = [1, 30, 60, 120]
function fill(minutes: number): string {
  const level = STEPS.filter((s) => minutes >= s).length
  if (level === 0) return 'var(--color-secondary)'
  return `color-mix(in oklch, var(--color-chart-1) ${[0, 30, 55, 78, 100][level]}%, transparent)`
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

const mondayOf = (t: number) => t - ((new Date(t).getDay() + 6) % 7) * DAY

export function Moss({ sessions, subjects, now, readOnly }: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  const [period, setPeriod] = useState<Period>('month')
  // First day of the shown month, or Monday of the shown week.
  const [anchor, setAnchor] = useState<number | null>(null)
  const [pairing, setPairing] = useState(false)
  const sum = summarize(sessions, subjects, filter, now)

  const firstOfMonth = (t: number) => {
    const d = new Date(t)
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
  }
  const shown = anchor ?? (period === 'week' ? mondayOf(sum.today) : firstOfMonth(sum.today))

  const items = [
    { value: 'all', label: 'すべての教科' },
    ...tree(subjects).flatMap(({ parent, children }) => [
      { value: String(parent.id), label: children.length ? `${parent.name}（まとめて）` : parent.name },
      ...children.map((c) => ({ value: String(c.id), label: `${parent.name} › ${c.name}` })),
    ]),
  ]

  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="flex items-center justify-between gap-2">
        <Select
          items={items}
          value={String(filter)}
          onValueChange={(v) => setFilter(v === 'all' || v === null ? 'all' : Number(v))}
        >
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {items.map((i) => (
              <SelectItem key={i.value} value={i.value}>
                {i.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!readOnly && (
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setPairing(true)}>
            <Monitor /> PC で見る
          </Button>
        )}
      </div>

      <ToggleGroup
        variant="outline"
        className="w-full"
        value={[period]}
        onValueChange={(v) => {
          if (!v[0]) return
          setPeriod(v[0] as Period)
          setAnchor(null)
        }}
      >
        <ToggleGroupItem value="week" className="flex-1">週</ToggleGroupItem>
        <ToggleGroupItem value="month" className="flex-1">月</ToggleGroupItem>
        <ToggleGroupItem value="year" className="flex-1">年</ToggleGroupItem>
      </ToggleGroup>

      {period === 'year' ? (
        <Year
          days={sum.days}
          from={sum.from}
          today={sum.today}
          onPickMonth={(t) => {
            setPeriod('month')
            setAnchor(firstOfMonth(t))
          }}
        />
      ) : period === 'month' ? (
        <Month key={shown} days={sum.days} first={shown} from={sum.from} today={sum.today} onMove={setAnchor} />
      ) : (
        <Week days={sum.days} monday={shown} from={sum.from} today={sum.today} onMove={setAnchor} />
      )}

      <div className="flex justify-end">
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          少
          {[0, 1, 30, 60, 120].map((m) => (
            <span key={m} className="inline-block size-2.5 rounded-[2px]" style={{ background: fill(m) }} />
          ))}
          多
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="今週" value={formatMinutes(sum.week)} />
        <Stat label="今月" value={formatMinutes(sum.month)} />
        <Stat label="連続" value={`${sum.streak}日`} />
      </div>

      {!readOnly && <ShowPairingCode open={pairing} onOpenChange={setPairing} />}
    </div>
  )
}

function Nav(props: { label: string; canPrev: boolean; canNext: boolean; onPrev: () => void; onNext: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <Button variant="ghost" size="icon" aria-label="前へ" disabled={!props.canPrev} onClick={props.onPrev}>
        <ChevronLeft />
      </Button>
      <span className="font-medium">{props.label}</span>
      <Button variant="ghost" size="icon" aria-label="次へ" disabled={!props.canNext} onClick={props.onNext}>
        <ChevronRight />
      </Button>
    </div>
  )
}

// L7 year: an overview only. Its cells are too small to aim at, so a tap opens that month instead.
function Year(props: { days: Map<string, number>; from: number; today: number; onPickMonth: (t: number) => void }) {
  const [ref, width] = useWidth()
  const { days, from, today } = props
  // The heatmap only fills days between the first and last entries, so pin both ends of the window.
  const data = [
    { date: dateKey(from), value: days.get(dateKey(from)) ?? 0 },
    ...[...days].map(([date, value]) => ({ date, value })),
    { date: dateKey(today), value: days.get(dateKey(today)) ?? 0 },
  ]
  const margin = 1.5
  // 371 days starting mid-week span 54 Monday-to-Sunday columns.
  const columns = Math.ceil((((new Date(from).getDay() + 6) % 7) + 371) / 7)
  const block = Math.max(2, (width - 8 + margin) / columns - margin)

  return (
    <div className="flex flex-col gap-2">
      <div ref={ref} className="-mx-1">
        {width > 0 && (
          <CalendarHeatmap data={data} weekStart={1} locale={ja} blockSize={block} blockMargin={margin} blockRadius={1} fontSize={10}>
            <CalendarHeatmapBody hideYearLabels hideWeekdayLabels className="py-1">
              {({ activity, dayIndex, weekIndex }) => (
                <CalendarHeatmapBlock
                  activity={activity}
                  dayIndex={dayIndex}
                  weekIndex={weekIndex}
                  style={{ fill: fill(activity.value) }}
                  onCellClick={(a) => props.onPickMonth(new Date(`${a.date}T00:00`).getTime())}
                />
              )}
            </CalendarHeatmapBody>
          </CalendarHeatmap>
        )}
      </div>
      <p className="text-sm text-muted-foreground">タップするとその月を開きます</p>
    </div>
  )
}

// L7 month: a calendar whose days are big enough to tap.
function Month(props: {
  days: Map<string, number>
  first: number
  from: number
  today: number
  onMove: (first: number) => void
}) {
  const { days, first, from, today } = props
  const [selected, setSelected] = useState<string | null>(null)
  const d = new Date(first)
  const y = d.getFullYear()
  const m = d.getMonth()
  const count = new Date(y, m + 1, 0).getDate()
  const lead = (d.getDay() + 6) % 7
  const cells: (number | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: count }, (_, i) => new Date(y, m, i + 1).getTime()),
  ]
  const total = cells.reduce<number>((n, t) => n + (t ? (days.get(dateKey(t)) ?? 0) : 0), 0)
  const minutes = selected ? (days.get(selected) ?? 0) : 0

  return (
    <div className="flex flex-col gap-2">
      <Nav
        label={`${y}年${m + 1}月`}
        canPrev={first > from}
        canNext={new Date(y, m + 1, 1).getTime() <= today}
        onPrev={() => props.onMove(new Date(y, m - 1, 1).getTime())}
        onNext={() => props.onMove(new Date(y, m + 1, 1).getTime())}
      />
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((w) => (
          <span key={w} className="text-xs text-muted-foreground">
            {w}
          </span>
        ))}
        {cells.map((t, i) => {
          if (t === null) return <span key={`x${i}`} />
          const k = dateKey(t)
          const outside = t < from || t > today
          const v = days.get(k) ?? 0
          return (
            <button
              key={k}
              type="button"
              disabled={outside}
              onClick={() => setSelected(k)}
              className={cn(
                'aspect-square rounded-md text-xs tabular-nums',
                v >= 60 ? 'text-primary-foreground' : 'text-muted-foreground',
                outside && 'opacity-30',
                k === selected && 'ring-2 ring-foreground',
              )}
              style={{ background: outside ? undefined : fill(v) }}
            >
              {new Date(t).getDate()}
            </button>
          )
        })}
      </div>
      <div className="flex min-h-6 justify-between text-sm">
        <span className="text-muted-foreground">
          {selected ? (
            <>
              {formatDay(new Date(`${selected}T00:00`).getTime())}{' '}
              <span className="text-foreground">{minutes ? formatMinutes(minutes) : '勉強なし'}</span>
            </>
          ) : (
            '日をタップすると時間が出ます'
          )}
        </span>
        <span className="text-muted-foreground">
          計 <span className="text-foreground">{formatMinutes(total)}</span>
        </span>
      </div>
    </div>
  )
}

// L7 week: seven days are too few for a heatmap to say much, so they are bars with minutes.
function Week(props: {
  days: Map<string, number>
  monday: number
  from: number
  today: number
  onMove: (monday: number) => void
}) {
  const { days, monday, from, today } = props
  const list = Array.from({ length: 7 }, (_, i) => {
    const t = new Date(monday + i * DAY + 12 * 3_600_000).setHours(0, 0, 0, 0)
    return { t, v: days.get(dateKey(t)) ?? 0 }
  })
  // A fixed floor keeps one short week from looking as full as a long one.
  const scale = Math.max(180, ...list.map((x) => x.v))
  const total = list.reduce((n, x) => n + x.v, 0)
  const sunday = list[6].t
  const md = (t: number) => `${new Date(t).getMonth() + 1}/${new Date(t).getDate()}`

  return (
    <div className="flex flex-col gap-2">
      <Nav
        label={`${md(monday)} – ${md(sunday)}`}
        canPrev={monday > from}
        canNext={sunday < today}
        onPrev={() => props.onMove(mondayOf(monday - DAY))}
        onNext={() => props.onMove(mondayOf(sunday + DAY))}
      />
      <div className="flex flex-col gap-1.5">
        {list.map(({ t, v }, i) => (
          <div key={t} className={cn('flex items-center gap-2 text-sm', t > today && 'opacity-30')}>
            <span className="w-16 shrink-0 whitespace-nowrap text-muted-foreground tabular-nums">
              {md(t)} {WEEKDAYS[i]}
            </span>
            <div className="h-6 flex-1 overflow-hidden rounded-md bg-secondary">
              <div className="h-full rounded-md" style={{ width: `${(v / scale) * 100}%`, background: fill(v) }} />
            </div>
            <span className="w-20 shrink-0 text-right tabular-nums">{v ? formatMinutes(v) : ''}</span>
          </div>
        ))}
      </div>
      <div className="flex justify-end text-sm text-muted-foreground">
        計 <span className="ml-1 text-foreground">{formatMinutes(total)}</span>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-secondary/60 px-3 py-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-base font-medium whitespace-nowrap tabular-nums">{value}</span>
    </div>
  )
}
