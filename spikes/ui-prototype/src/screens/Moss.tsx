import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ja } from 'date-fns/locale/ja'
import { Monitor } from 'lucide-react'
import {
  CalendarHeatmap,
  CalendarHeatmapBlock,
  CalendarHeatmapBody,
} from '@/components/heatmap/calendar-heatmap'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { dateKey, formatDay, formatMinutes, summarize, type Filter, type Session, type Subject } from '@/data'
import { ShowPairingCode } from '@/screens/Pairing'

export type MossLayout = 'fit' | 'scroll'

type Props = {
  sessions: Session[]
  subjects: Subject[]
  now: number
  layout: MossLayout
  readOnly?: boolean
}

// Fixed steps in minutes, so one long day does not fade every other day.
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

export function Moss({ sessions, subjects, now, layout, readOnly }: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  const [selected, setSelected] = useState<string | null>(null)
  const [pairing, setPairing] = useState(false)
  const [ref, width] = useWidth()
  const sum = summarize(sessions, filter, now)

  // The heatmap only fills days between the first and last entries, so pin both ends of the window.
  const data = [
    { date: dateKey(sum.from), value: sum.days.get(dateKey(sum.from)) ?? 0 },
    ...[...sum.days].map(([date, value]) => ({ date, value })),
    { date: dateKey(sum.today), value: sum.days.get(dateKey(sum.today)) ?? 0 },
  ]

  const fit = layout === 'fit'
  const margin = fit ? 1.5 : 3
  // 371 days starting mid-week span 54 Monday-to-Sunday columns.
  const columns = Math.ceil(((new Date(sum.from).getDay() + 6) % 7 + 371) / 7)
  const block = fit ? Math.max(2, (width - 8 + margin) / columns - margin) : 12

  useEffect(() => {
    const body = ref.current?.querySelector('[data-slot="calendar-heatmap-body"]')
    if (body) body.scrollLeft = fit ? 0 : body.scrollWidth
  }, [fit, width, filter, ref])

  const items = [
    { value: 'all', label: 'すべての教科' },
    ...subjects.map((s) => ({ value: String(s.id), label: s.hidden ? `${s.name}（非表示）` : s.name })),
  ]
  const selectedMinutes = selected ? (sum.days.get(selected) ?? 0) : 0

  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="flex items-center justify-between gap-2">
        <Select
          items={items}
          value={String(filter)}
          onValueChange={(v) => setFilter(v === 'all' || v === null ? 'all' : Number(v))}
        >
          <SelectTrigger className="w-44">
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

      <div ref={ref} className="-mx-1">
        {width > 0 && (
          <CalendarHeatmap
            data={data}
            weekStart={1}
            locale={ja}
            blockSize={block}
            blockMargin={margin}
            blockRadius={fit ? 1 : 2}
            fontSize={fit ? 10 : 12}
          >
            <CalendarHeatmapBody hideYearLabels hideWeekdayLabels={fit} className="py-1">
              {({ activity, dayIndex, weekIndex }) => (
                <CalendarHeatmapBlock
                  activity={activity}
                  dayIndex={dayIndex}
                  weekIndex={weekIndex}
                  style={{
                    fill: fill(activity.value),
                    stroke: activity.date === selected ? 'var(--color-foreground)' : undefined,
                    strokeWidth: activity.date === selected ? 1 : undefined,
                  }}
                  onCellClick={(a) => setSelected(a.date)}
                />
              )}
            </CalendarHeatmapBody>
          </CalendarHeatmap>
        )}
      </div>

      <div className="flex min-h-6 items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {selected ? (
            <>
              {formatDay(new Date(`${selected}T00:00`).getTime())}{' '}
              <span className="text-foreground">{selectedMinutes ? formatMinutes(selectedMinutes) : '勉強なし'}</span>
            </>
          ) : (
            '日をタップすると時間が出ます'
          )}
        </span>
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-secondary/60 px-3 py-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-base font-medium whitespace-nowrap tabular-nums">{value}</span>
    </div>
  )
}
