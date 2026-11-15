import { useState } from 'react'
import { Plus } from 'lucide-react'
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
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { formatClock, subjectPath, type Session, type Subject } from '@/data'
import { SubjectPicker } from '@/screens/SubjectPicker'

type Props = {
  subjects: Subject[]
  sessions: Session[]
  running: Session | null
  now: number
  onStart: (subjectId: number | null) => void
  onStop: () => void
  onSwitch: (subjectId: number) => void
  onLabel: (subjectId: number) => void
  awayMinutes: number | null
  onAwayAnswer: (studying: boolean) => void
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
  const [picking, setPicking] = useState(false)
  // L3: an uncategorized session gets its subject for the whole run; a categorized one is split at "now".
  const labeling = running?.subjectId === null

  return (
    <div className="flex min-h-full flex-col">
      {running ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-8 py-10">
          <div className="flex flex-col items-center gap-2">
            {labeling ? (
              <button
                type="button"
                onClick={() => setPicking(true)}
                className="flex items-center gap-1 rounded-full border border-dashed px-3 py-1 text-sm text-muted-foreground"
              >
                <Plus className="size-3.5" /> 教科
              </button>
            ) : (
              <span className="rounded-full bg-primary/10 px-3 py-1 text-sm text-primary">
                {subjectPath(subjects, running.subjectId!)}
              </span>
            )}
            <span className="text-6xl font-extralight tabular-nums tracking-tight">{elapsed(now - running.start)}</span>
            <span className="text-sm text-muted-foreground">{formatClock(running.start)} から</span>
          </div>
          <div className="flex w-full flex-col gap-3">
            <Button size="lg" className="h-14 text-base" onClick={props.onStop}>
              終わる
            </Button>
            {!labeling && (
              <Button size="lg" variant="outline" className="h-12" onClick={() => setPicking(true)}>
                教科を切り替える
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-8 py-6">
          <Button size="lg" className="h-28 rounded-2xl text-2xl" onClick={() => props.onStart(null)}>
            始める
          </Button>
          <div className="flex flex-col gap-3">
            <span className="text-sm text-muted-foreground">教科を決めて始める</span>
            <SubjectPicker subjects={subjects} sessions={sessions} onPick={(id) => props.onStart(id)} />
          </div>
        </div>
      )}

      <Drawer open={picking} onOpenChange={setPicking}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{labeling ? '何を勉強してる？' : '何に切り替える？'}</DrawerTitle>
            <DrawerDescription>
              {labeling && running
                ? `${formatClock(running.start)} から、この教科として記録します`
                : 'いまの記録はここで区切り、新しく始めます'}
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <SubjectPicker
              subjects={subjects}
              sessions={sessions}
              exclude={running?.subjectId}
              onPick={(id) => {
                if (labeling) props.onLabel(id)
                else props.onSwitch(id)
                setPicking(false)
              }}
            />
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
