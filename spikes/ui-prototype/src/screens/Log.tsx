import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  dateKey,
  formatClock,
  formatDay,
  formatMinutes,
  minutesOf,
  startOfDay,
  subjectName,
  tree,
  type Session,
  type Subject,
} from '@/data'

type Props = {
  sessions: Session[]
  subjects: Subject[]
  now: number
  onChange: (update: (sessions: Session[]) => Session[]) => void
}

const DAY = 86_400_000

const toInput = (t: number) => {
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${dateKey(t)}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export function Log({ sessions, subjects, now, onChange }: Props) {
  const [days, setDays] = useState(14)
  const [editing, setEditing] = useState<Session | null>(null)

  const from = startOfDay(now) - (days - 1) * DAY
  const groups = new Map<number, Session[]>()
  for (const s of [...sessions].sort((a, b) => b.start - a.start)) {
    if (s.start < from) break
    const d = startOfDay(s.start)
    groups.set(d, [...(groups.get(d) ?? []), s])
  }

  return (
    <div className="flex flex-col gap-5 py-4">
      {[...groups].map(([day, list]) => (
        <section key={day} className="flex flex-col gap-1">
          <h2 className="flex justify-between px-1 text-sm text-muted-foreground">
            <span>{formatDay(day)}</span>
            <span>{formatMinutes(list.reduce((m, s) => m + minutesOf(s, now), 0))}</span>
          </h2>
          <div className="flex flex-col divide-y overflow-hidden rounded-xl border">
            {list.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setEditing(s)}
                className="flex items-center gap-3 px-3 py-3 text-left active:bg-secondary"
              >
                <span className="w-16 shrink-0 truncate font-medium">{subjectName(subjects, s.subjectId)}</span>
                <span className="flex-1 text-sm text-muted-foreground tabular-nums">
                  {formatClock(s.start)} – {s.end ? formatClock(s.end) : '計測中'}
                </span>
                <span className="text-sm tabular-nums">{formatMinutes(minutesOf(s, now))}</span>
                <ChevronRight className="size-4 text-muted-foreground" />
              </button>
            ))}
          </div>
        </section>
      ))}
      <Button variant="ghost" onClick={() => setDays((d) => d + 14)}>
        もっと前を見る
      </Button>

      {editing && (
        <EditSession
          key={editing.id}
          session={editing}
          subjects={subjects}
          now={now}
          onClose={() => setEditing(null)}
          onSave={(next) => onChange((ss) => ss.map((s) => (s.id === next.id ? next : s)))}
          onDelete={() => onChange((ss) => ss.filter((s) => s.id !== editing.id))}
        />
      )}
    </div>
  )
}

function EditSession(props: {
  session: Session
  subjects: Subject[]
  now: number
  onClose: () => void
  onSave: (s: Session) => void
  onDelete: () => void
}) {
  const { session } = props
  const [open, setOpen] = useState(true)
  const [subject, setSubject] = useState(session.subjectId === null ? 'none' : String(session.subjectId))
  const [start, setStart] = useState(toInput(session.start))
  const [end, setEnd] = useState(session.end ? toInput(session.end) : '')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const startT = new Date(start).getTime()
  const endT = end ? new Date(end).getTime() : null
  // Rules from docs/api.md: no future times, end after start, start within 7 days of the original.
  const error =
    Number.isNaN(startT) ? '開始時刻を入れてください'
    : startT > props.now || (endT !== null && endT > props.now) ? '未来の時刻にはできません'
    : endT !== null && endT < startT ? '終了が開始より前になっています'
    : Math.abs(startT - session.start) > 7 * DAY ? '開始は記録した日から 7 日以内でしか動かせません'
    : null

  const close = () => {
    setOpen(false)
    setTimeout(props.onClose, 300)
  }
  const items = [
    ...tree(props.subjects).flatMap(({ parent, children }) => [
      { value: String(parent.id), label: parent.name },
      ...children.map((c) => ({ value: String(c.id), label: `${parent.name} › ${c.name}` })),
    ]),
    { value: 'none', label: '教科なし' },
  ]

  return (
    <>
      <Drawer open={open} onOpenChange={(o) => !o && close()}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>記録を直す</DrawerTitle>
          </DrawerHeader>
          <div className="flex flex-col gap-4 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <div className="flex flex-col gap-2">
              <Label>教科</Label>
              <Select items={items} value={subject} onValueChange={(v) => v && setSubject(v)}>
                <SelectTrigger className="w-full">
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
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="start">開始</Label>
              <Input id="start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="end">終了</Label>
              <Input id="end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
              {session.end === null && !end && (
                <span className="text-xs text-muted-foreground">計測中です。終了を入れると、そこで終わります。</span>
              )}
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button
              size="lg"
              disabled={error !== null}
              onClick={() => {
                props.onSave({
                  ...session,
                  subjectId: subject === 'none' ? null : Number(subject),
                  start: startT,
                  end: endT,
                })
                close()
              }}
            >
              保存する
            </Button>
            <Button variant="ghost" className="text-destructive" onClick={() => setConfirmDelete(true)}>
              この記録を消す
            </Button>
          </div>
        </DrawerContent>
      </Drawer>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>この記録を消しますか？</AlertDialogTitle>
            <AlertDialogDescription>苔からもなくなります。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>やめる</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                props.onDelete()
                setConfirmDelete(false)
                close()
              }}
            >
              消す
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
