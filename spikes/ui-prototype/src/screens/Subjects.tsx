import { useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import type { Subject } from '@/data'

type Props = { subjects: Subject[]; onChange: (update: (subjects: Subject[]) => Subject[]) => void }

// L9: add, reorder (up/down buttons, no drag library) and hide.
export function Subjects({ subjects, onChange }: Props) {
  const [name, setName] = useState('')
  const move = (i: number, d: -1 | 1) =>
    onChange((ss) => {
      const next = [...ss]
      ;[next[i], next[i + d]] = [next[i + d], next[i]]
      return next
    })

  return (
    <div className="flex flex-col gap-4 py-4">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const n = name.trim()
          if (!n) return
          onChange((ss) => [...ss, { id: Math.max(0, ...ss.map((s) => s.id)) + 1, name: n, hidden: false }])
          setName('')
        }}
      >
        <Input placeholder="新しい教科" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" disabled={!name.trim()}>
          足す
        </Button>
      </form>

      <div className="flex flex-col divide-y overflow-hidden rounded-xl border">
        {subjects.map((s, i) => (
          <div key={s.id} className="flex items-center gap-2 px-3 py-2">
            <span className={cn('flex-1', s.hidden && 'text-muted-foreground line-through')}>{s.name}</span>
            <Button variant="ghost" size="icon-sm" aria-label="上へ" disabled={i === 0} onClick={() => move(i, -1)}>
              <ArrowUp />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="下へ"
              disabled={i === subjects.length - 1}
              onClick={() => move(i, 1)}
            >
              <ArrowDown />
            </Button>
            <Switch
              aria-label="表示する"
              checked={!s.hidden}
              onCheckedChange={(on) => onChange((ss) => ss.map((x) => (x.id === s.id ? { ...x, hidden: !on } : x)))}
            />
          </div>
        ))}
      </div>
      <p className="px-1 text-xs text-muted-foreground">
        スイッチを切った教科はボタンに出なくなります。これまでの記録はそのまま苔に残ります。
      </p>
    </div>
  )
}
