import { useEffect, useRef, useState } from 'react'
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
import type { State } from '../api.ts'
import { SubjectPicker } from './SubjectPicker.tsx'

type Props = {
  state: State
  onStart: (subjectId: number | null) => void
  onStop: () => void
  onSwitch: (subjectId: number) => void
  onPickSubject: (subjectId: number) => void
  awayMinutes: number | null
  onAwayAnswer: (studying: boolean) => void
}

function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const p = (n: number) => String(n).padStart(2, '0')
  return `${Math.floor(s / 3600)}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })

function useTick(active: boolean): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  return now
}

// 勉強 (L2–L5), as docs/screens.md describes it.
export function Study({ state, onStart, onStop, onSwitch, onPickSubject, awayMinutes, onAwayAnswer }: Props) {
  const { running, subjects, last_subject_id } = state
  const [picking, setPicking] = useState(false)
  const studied = useRef<HTMLButtonElement>(null)
  const now = useTick(running !== null)
  // An uncategorized session gets its subject for the whole run; one with a subject is split at now (L3).
  const labeling = running?.subject_id === null

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
                {state.running_subject_path?.join(' › ')}
              </span>
            )}
            <span className="text-6xl font-extralight tabular-nums tracking-tight">
              {elapsed(now - running.started_at)}
            </span>
            <span className="text-sm text-muted-foreground">{clock(running.started_at)} から</span>
          </div>
          <div className="flex w-full flex-col gap-3">
            <Button size="lg" className="h-14 text-base" onClick={onStop}>
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
          <Button size="lg" className="h-28 rounded-2xl text-2xl" onClick={() => onStart(null)}>
            始める
          </Button>
          {subjects.length > 0 ? (
            <div className="flex flex-col gap-3">
              <span className="text-sm text-muted-foreground">教科を決めて始める</span>
              <SubjectPicker subjects={subjects} lastSubjectId={last_subject_id} onPick={(id) => onStart(id)} />
            </div>
          ) : (
            <p className="text-center text-sm text-muted-foreground">教科は「教科」タブで足せます。</p>
          )}
        </div>
      )}

      <Drawer open={picking} onOpenChange={setPicking}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{labeling ? '何を勉強してる？' : '何に切り替える？'}</DrawerTitle>
            <DrawerDescription>
              {labeling && running
                ? `${clock(running.started_at)} から、この教科として記録します`
                : 'いまの記録はここで区切り、新しく始めます'}
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <SubjectPicker
              subjects={subjects}
              lastSubjectId={last_subject_id}
              exclude={running?.subject_id}
              onPick={(id) => {
                if (labeling) onPickSubject(id)
                else onSwitch(id)
                setPicking(false)
              }}
            />
          </div>
        </DrawerContent>
      </Drawer>

      {/* L5: closing the dialog any other way counts as "yes". */}
      <AlertDialog open={awayMinutes !== null} onOpenChange={(open) => !open && onAwayAnswer(true)}>
        {/* "していた" is the default answer (L5), so it takes the focus. */}
        <AlertDialogContent initialFocus={studied}>
          <AlertDialogHeader>
            <AlertDialogTitle>{awayMinutes} 分離れていました</AlertDialogTitle>
            <AlertDialogDescription>その間も勉強していましたか？</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => onAwayAnswer(false)}>していなかった</AlertDialogCancel>
            <AlertDialogAction ref={studied} onClick={() => onAwayAnswer(true)}>
              していた
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
