import { useCallback, useEffect, useRef, useState } from 'react'
import { BookOpen, CalendarDays, ListOrdered, Sprout } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { absenceToAsk } from './absence.ts'
import { api, type Session, type State } from './api.ts'
import { ShowPairingCode } from './screens/Pairing.tsx'
import { Study } from './screens/Study.tsx'
import { write } from './write.ts'

type Tab = 'study' | 'moss' | 'log' | 'subjects'

const TABS: { id: Tab; label: string; icon: typeof BookOpen }[] = [
  { id: 'study', label: '勉強', icon: BookOpen },
  { id: 'moss', label: '苔', icon: Sprout },
  { id: 'log', label: '記録', icon: CalendarDays },
  { id: 'subjects', label: '教科', icon: ListOrdered },
]

// Device-local notes for L5. The server's away_at is the record; these only cover a lost beacon
// and remember which away_at has already been judged.
const HIDDEN_AT = 'koke.hiddenAt'
const HANDLED_AWAY_AT = 'koke.handledAwayAt'

function load(key: string): number | null {
  try {
    const v = localStorage.getItem(key)
    return v === null ? null : Number(v)
  } catch {
    return null
  }
}
function save(key: string, value: number | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, String(value))
  } catch {
    // Private mode or storage cleared: L5 falls back to the server's away_at alone.
  }
}

type Write = { applied: boolean; session: Session }

export function Phone({ initial }: { initial: State }) {
  const [state, setState] = useState(initial)
  const [tab, setTab] = useState<Tab>('study')
  const [awayMinutes, setAwayMinutes] = useState<number | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pairing, setPairing] = useState(false)
  // The visibility handler reads the latest session without re-subscribing on every change.
  const running = useRef(state.running)
  useEffect(() => {
    running.current = state.running
  }, [state.running])

  const refresh = useCallback(async (): Promise<State | null> => {
    const r = await api<State>('/api/state').catch(() => null)
    if (r === null) return null
    // Signed out (revoked): start over from the sign-in check.
    if (!r.ok) {
      location.reload()
      return null
    }
    setState(r.body)
    return r.body
  }, [])

  const send = useCallback(
    async (path: string, body: Record<string, unknown>) => {
      const r = await write<Write>(path, body)
      if (!r.ok && 'offline' in r) {
        setNotice('つながらないので記録できませんでした')
        setTimeout(() => setNotice(null), 4000)
        return
      }
      // Whatever the answer (applied, stale, conflict), show what the server now holds.
      await refresh()
    },
    [refresh],
  )

  // L5: on every return to the foreground, read the state and ask about a long absence.
  const onReturn = useCallback(async () => {
    let current = await refresh()
    if (!current) return
    const hiddenAt = load(HIDDEN_AT)
    save(HIDDEN_AT, null)
    const s = current.running
    // The beacon did not arrive: record the absence now, before judging it.
    if (s && hiddenAt !== null && hiddenAt >= s.started_at && (s.away_at === null || s.away_at < hiddenAt)) {
      const r = await write<Write>(`/api/sessions/${s.session_id}/away`, { base_rev: s.rev, away_at: hiddenAt })
      if (r.ok) current = (await refresh()) ?? current
    }
    const minutes = absenceToAsk(current.running, load(HANDLED_AWAY_AT), Date.now(), current.away_threshold_minutes)
    if (current.running?.away_at != null) save(HANDLED_AWAY_AT, current.running.away_at)
    // Only the learner's answer closes the question; a later return that finds nothing new leaves it open.
    if (minutes !== null) setAwayMinutes(minutes)
  }, [refresh])

  useEffect(() => {
    void onReturn()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') return void onReturn()
      // Going away never ends a session (L5): it only records the moment.
      const s = running.current
      if (!s) return
      const now = Date.now()
      save(HIDDEN_AT, now)
      navigator.sendBeacon(
        `/api/sessions/${s.session_id}/away`,
        new Blob([JSON.stringify({ base_rev: s.rev, away_at: now })], { type: 'text/plain' }),
      )
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [onReturn])

  const s = state.running
  return (
    <>
      <main className="flex-1">
        {notice && <p className="rounded-lg bg-muted px-3 py-2 text-center text-sm">{notice}</p>}
        {tab === 'study' && (
          <Study
            state={state}
            onStart={(subjectId) => send('/api/sessions', subjectId === null ? {} : { subject_id: subjectId })}
            onStop={() => s && send(`/api/sessions/${s.session_id}/stop`, { base_rev: s.rev })}
            onSwitch={(id) => s && send(`/api/sessions/${s.session_id}/switch`, { base_rev: s.rev, subject_id: id })}
            onPickSubject={(id) => s && send(`/api/sessions/${s.session_id}/subject`, { base_rev: s.rev, subject_id: id })}
            awayMinutes={awayMinutes}
            onAwayAnswer={(studying) => {
              setAwayMinutes(null)
              // "Not studying": the session ends at the moment koke went away.
              if (!studying && s?.away_at != null) {
                void send(`/api/sessions/${s.session_id}/stop`, { base_rev: s.rev, ended_at: s.away_at })
              }
            }}
          />
        )}
        {tab === 'moss' && (
          <div className="flex flex-col items-center gap-6 py-16">
            <p className="text-sm text-muted-foreground">苔はここに表示されます。</p>
            <Button variant="outline" onClick={() => setPairing(true)}>
              PC で見る
            </Button>
            <ShowPairingCode open={pairing} onOpenChange={setPairing} />
          </div>
        )}
        {(tab === 'log' || tab === 'subjects') && (
          <p className="py-16 text-center text-sm text-muted-foreground">ここはまだ準備中です。</p>
        )}
      </main>
      <nav className="sticky bottom-0 -mx-4 grid grid-cols-4 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn('flex flex-col items-center gap-0.5 py-2 text-xs', tab === id ? 'text-primary' : 'text-muted-foreground')}
          >
            <Icon className="size-5" />
            {label}
          </button>
        ))}
      </nav>
    </>
  )
}
