import { Button } from '@/components/ui/button'
import type { Subject } from '../api.ts'
import { subjectRows } from '../subjects.ts'

type Props = {
  subjects: Subject[]
  lastSubjectId: number | null
  exclude?: number | null
  onPick: (subjectId: number) => void
}

// One row per parent with its children beside it, so a sub-subject is still one tap (L2).
export function SubjectPicker({ subjects, lastSubjectId, exclude, onPick }: Props) {
  return (
    <div className="flex flex-col gap-2">
      {subjectRows(subjects, lastSubjectId).map(({ parent, children }) => (
        <div key={parent.subject_id} className="flex flex-wrap gap-2">
          {[parent, ...children]
            .filter((s) => s.subject_id !== exclude)
            .map((s) => (
              <Button
                key={s.subject_id}
                size="lg"
                variant={s.parent_id === null ? 'secondary' : 'outline'}
                className="h-11 min-w-16 text-base"
                onClick={() => onPick(s.subject_id)}
              >
                {s.name}
              </Button>
            ))}
        </div>
      ))}
    </div>
  )
}
