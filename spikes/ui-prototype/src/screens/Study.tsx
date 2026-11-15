import { useState } from 'react'
import { Button } from '@/components/ui/button'
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
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { formatClock, type Session, type Subject } from '@/data'

type Props = {
  subjects: Subject[]
  sessions: Session[]
  running: Session | null
  now: number
  onStart: (subjectId: number | null) => void
  onStop: () => void
  onSwitch: (subjectId: number | null) => void
  awayMinutes: number | null
  onAwayAnswer: (studying: boolean) => void
}

// Visible subjects, the one used last first (L2).
function ordered(subjects: Subject[], sessions: Session[]): Subject[] {
  const visible = subjects.filter((s) => !s.hidden)
  const last = [...sessions].sort((a, b) => b.start - a.start).find((s) => s.subjectId !== null)
  const i = visible.findIndex((s) => s.id === last?.subjectId)
  return i <= 0 ? visible : [visible[i], ...visible.slice(0, i), ...visible.slice(i + 1)]
}

function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${h}:${p(m)}:${p(s % 60)}`
}

export function Study(props: Props) {
  const { subjects, sessions, running, now } = props
  const [switching, setSwitching] = useState(false)
  const list = ordered(subjects, sessions)
  const nameOf = (id: number | null) => subjects.find((s) => s.id === id)?.name ?? '未分類'

  return (
    <div className="flex min-h-full flex-col">
      {running ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-8 py-10">
          <div className="flex flex-col items-center gap-2">
            <span className="rounded-full bg-primary/10 px-3 py-1 text-sm text-primary">{nameOf(running.subjectId)}</span>
            <span className="text-6xl font-extralight tabular-nums tracking-tight">{elapsed(now - running.start)}</span>
            <span className="text-sm text-muted-foreground">{formatClock(running.start)} から</span>
          </div>
          <div className="flex w-full flex-col gap-3">
            <Button size="lg" className="h-14 text-base" onClick={props.onStop}>
              終わる
            </Button>
            <Button size="lg" variant="outline" className="h-12" onClick={() => setSwitching(true)}>
              教科を切り替える
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 py-6">
          <h1 className="text-xl font-medium">何を勉強する？</h1>
          <div className="grid grid-cols-2 gap-3">
            {list.map((s) => (
              <Button key={s.id} size="lg" variant="secondary" className="h-20 text-lg" onClick={() => props.onStart(s.id)}>
                {s.name}
              </Button>
            ))}
          </div>
          <Button size="lg" variant="outline" className="h-12" onClick={() => props.onStart(null)}>
            決めてない
          </Button>
        </div>
      )}

      <Drawer open={switching} onOpenChange={setSwitching}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>何に切り替える？</DrawerTitle>
          </DrawerHeader>
          <div className="grid grid-cols-2 gap-3 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            {list
              .filter((s) => s.id !== running?.subjectId)
              .map((s) => (
                <Button
                  key={s.id}
                  size="lg"
                  variant="secondary"
                  className="h-16 text-base"
                  onClick={() => {
                    props.onSwitch(s.id)
                    setSwitching(false)
                  }}
                >
                  {s.name}
                </Button>
              ))}
            {running?.subjectId !== null && (
              <Button
                size="lg"
                variant="outline"
                className="col-span-2 h-12"
                onClick={() => {
                  props.onSwitch(null)
                  setSwitching(false)
                }}
              >
                決めてない
              </Button>
            )}
          </div>
        </DrawerContent>
      </Drawer>

      {/* L5: closing the dialog any other way counts as "yes". */}
      <AlertDialog open={props.awayMinutes !== null} onOpenChange={(open) => !open && props.onAwayAnswer(true)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{props.awayMinutes} 分離れていました</AlertDialogTitle>
            <AlertDialogDescription>その間も勉強していましたか？</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => props.onAwayAnswer(false)}>していなかった</AlertDialogCancel>
            <AlertDialogAction onClick={() => props.onAwayAnswer(true)}>していた</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
