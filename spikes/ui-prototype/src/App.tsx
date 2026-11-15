import { useEffect, useState } from 'react'
import { BookOpen, CalendarDays, FlaskConical, ListOrdered, Sprout } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { fakeSessions, initialSubjects, type Session, type Subject } from '@/data'
import { Study } from '@/screens/Study'
import { Moss } from '@/screens/Moss'
import { Log } from '@/screens/Log'
import { Subjects } from '@/screens/Subjects'
import { PairPc } from '@/screens/Pairing'

type Tab = 'study' | 'moss' | 'log' | 'subjects'
type Device = 'phone' | 'pc'

const TABS: { id: Tab; label: string; icon: typeof BookOpen }[] = [
  { id: 'study', label: '勉強', icon: BookOpen },
  { id: 'moss', label: '苔', icon: Sprout },
  { id: 'log', label: '記録', icon: CalendarDays },
  { id: 'subjects', label: '教科', icon: ListOrdered },
]

export default function App() {
  const [now, setNow] = useState(() => Date.now())
  const [subjects, setSubjects] = useState<Subject[]>(initialSubjects)
  const [sessions, setSessions] = useState<Session[]>(() => fakeSessions(Date.now()))
  const [tab, setTab] = useState<Tab>('study')
  const [device, setDevice] = useState<Device>('phone')
  const [paired, setPaired] = useState(false)
  const [awayMinutes, setAwayMinutes] = useState<number | null>(null)
  const [banner, setBanner] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!banner) return
    const t = setTimeout(() => setBanner(null), 3000)
    return () => clearTimeout(t)
  }, [banner])

  const running = sessions.find((s) => s.end === null) ?? null

  const start = (subjectId: number | null) => {
    setSessions((ss) => [...ss, { id: Math.max(0, ...ss.map((s) => s.id)) + 1, subjectId, start: Date.now(), end: null }])
  }
  const stop = (end = Date.now()) => {
    setSessions((ss) => ss.map((s) => (s.end === null ? { ...s, end: Math.max(end, s.start) } : s)))
  }
  // L3: picking a subject for an uncategorized session relabels it from its start; nothing is split.
  const label = (subjectId: number) => {
    setSessions((ss) => ss.map((s) => (s.end === null ? { ...s, subjectId } : s)))
  }
  const switchTo = (subjectId: number) => {
    const t = Date.now()
    setSessions((ss) => [
      ...ss.map((s) => (s.end === null ? { ...s, end: t } : s)),
      { id: Math.max(0, ...ss.map((s) => s.id)) + 1, subjectId, start: t, end: null },
    ])
  }

  // Prototype-only: pretend the phone was away, with the session started 40 minutes earlier.
  const simulateAway = () => {
    setMenuOpen(false)
    if (!running) {
      const t = Date.now() - 40 * 60_000
      setSessions((ss) => [...ss, { id: Math.max(0, ...ss.map((s) => s.id)) + 1, subjectId: 1, start: t, end: null }])
    }
    setTab('study')
    setAwayMinutes(25)
  }

  const isPc = device === 'pc'

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col bg-background pt-[env(safe-area-inset-top)]">
      <header className="flex items-center justify-between px-4 pt-3 pb-1">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold tracking-wide text-primary">koke</span>
          {isPc && paired && <span className="text-xs text-muted-foreground">閲覧のみ</span>}
        </div>
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setMenuOpen(true)}>
          <FlaskConical /> 試作
        </Button>
      </header>

      {banner && (
        <div className="mx-4 mt-2 rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">{banner}</div>
      )}

      <main className="flex-1 overflow-y-auto px-4 pb-4">
        {isPc && !paired ? (
          <PairPc onPaired={() => setPaired(true)} />
        ) : isPc ? (
          <Moss sessions={sessions} subjects={subjects} now={now} readOnly />
        ) : tab === 'study' ? (
          <Study
            subjects={subjects}
            sessions={sessions}
            running={running}
            now={now}
            onStart={start}
            onStop={() => stop()}
            onSwitch={switchTo}
            onLabel={label}
            awayMinutes={awayMinutes}
            onAwayAnswer={(studying) => {
              if (!studying) stop(Date.now() - (awayMinutes ?? 0) * 60_000)
              setAwayMinutes(null)
            }}
          />
        ) : tab === 'moss' ? (
          <Moss sessions={sessions} subjects={subjects} now={now} />
        ) : tab === 'log' ? (
          <Log sessions={sessions} subjects={subjects} now={now} onChange={setSessions} />
        ) : (
          <Subjects subjects={subjects} onChange={setSubjects} />
        )}
      </main>

      {!isPc && (
        <nav className="sticky bottom-0 grid grid-cols-4 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                'flex flex-col items-center gap-0.5 py-2 text-xs',
                tab === id ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <Icon className="size-5" />
              {label}
            </button>
          ))}
        </nav>
      )}

      <Drawer open={menuOpen} onOpenChange={setMenuOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>試作メニュー</DrawerTitle>
          </DrawerHeader>
          <div className="flex flex-col gap-4 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <div className="flex flex-col gap-2">
              <span className="text-sm text-muted-foreground">場面を再現する</span>
              <Button variant="outline" disabled={isPc} onClick={simulateAway}>
                25 分離れて戻ってきた（L5）
              </Button>
              <Button
                variant="outline"
                disabled={isPc || !running}
                onClick={() => {
                  setMenuOpen(false)
                  setTab('study')
                  setBanner('通知から開いたので、そのまま続けています')
                }}
              >
                「まだ勉強中？」の通知から開いた（L6）
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-sm text-muted-foreground">端末</span>
              <ToggleGroup
                variant="outline"
                value={[device]}
                onValueChange={(v) => v[0] && setDevice(v[0] as Device)}
              >
                <ToggleGroupItem value="phone">iPhone</ToggleGroupItem>
                <ToggleGroupItem value="pc">PC</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <Button
              variant="ghost"
              onClick={() => {
                setSessions(fakeSessions(Date.now()))
                setSubjects(initialSubjects)
                setPaired(false)
                setMenuOpen(false)
              }}
            >
              データを最初に戻す
            </Button>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  )
}
