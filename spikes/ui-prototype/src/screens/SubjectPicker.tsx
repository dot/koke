import { Button } from '@/components/ui/button'
import { tree, type Session, type Subject } from '@/data'

type Props = {
  subjects: Subject[]
  sessions: Session[]
  exclude?: number | null
  onPick: (subjectId: number) => void
}

// One row per parent with its children beside it, so a sub-subject is still one tap.
// The group used last comes first (L2). Hidden subjects are left out; a hidden parent hides its row.
export function SubjectPicker({ subjects, sessions, exclude, onPick }: Props) {
  const rows = tree(subjects).filter((r) => !r.parent.hidden)
  const last = [...sessions].sort((a, b) => b.start - a.start).find((s) => s.subjectId !== null)?.subjectId
  const lastRow = rows.findIndex((r) => r.parent.id === last || r.children.some((c) => c.id === last))
  if (lastRow > 0) rows.unshift(...rows.splice(lastRow, 1))

  return (
    <div className="flex flex-col gap-2">
      {rows.map(({ parent, children }) => (
        <div key={parent.id} className="flex flex-wrap gap-2">
          {[parent, ...children.filter((c) => !c.hidden)]
            .filter((s) => s.id !== exclude)
            .map((s) => (
              <Button
                key={s.id}
                size="lg"
                variant={s.parentId === null ? 'secondary' : 'outline'}
                className="h-11 min-w-16 text-base"
                onClick={() => onPick(s.id)}
              >
                {s.name}
              </Button>
            ))}
        </div>
      ))}
    </div>
  )
}
