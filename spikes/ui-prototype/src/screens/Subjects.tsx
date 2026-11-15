import { useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { tree, type Subject } from '@/data'

type Props = { subjects: Subject[]; onChange: (update: (subjects: Subject[]) => Subject[]) => void }

// L9: add (optionally under a parent), reorder among siblings (up/down buttons, no drag library) and hide.
export function Subjects({ subjects, onChange }: Props) {
  const [name, setName] = useState('')
  const [parent, setParent] = useState('none')

  const siblings = (s: Subject) => subjects.filter((x) => x.parentId === s.parentId)
  const move = (s: Subject, d: -1 | 1) =>
    onChange((ss) => {
      const sib = ss.filter((x) => x.parentId === s.parentId)
      const other = sib[sib.findIndex((x) => x.id === s.id) + d]
      const i = ss.indexOf(ss.find((x) => x.id === s.id)!)
      const j = ss.indexOf(other)
      const next = [...ss]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  const parents = [
    { value: 'none', label: '上の教科なし' },
    ...subjects.filter((s) => s.parentId === null).map((s) => ({ value: String(s.id), label: `${s.name} の下` })),
  ]

  const row = (s: Subject, child: boolean) => {
    const sib = siblings(s)
    const i = sib.indexOf(s)
    return (
      <div key={s.id} className={cn('flex items-center gap-2 py-2 pr-3', child ? 'pl-8' : 'pl-3')}>
        <span
          className={cn(
            'flex-1',
            child && 'text-sm',
            s.hidden && 'text-muted-foreground line-through',
          )}
        >
          {s.name}
        </span>
        <Button variant="ghost" size="icon-sm" aria-label="上へ" disabled={i === 0} onClick={() => move(s, -1)}>
          <ArrowUp />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="下へ" disabled={i === sib.length - 1} onClick={() => move(s, 1)}>
          <ArrowDown />
        </Button>
        <Switch
          aria-label="表示する"
          checked={!s.hidden}
          onCheckedChange={(on) => onChange((ss) => ss.map((x) => (x.id === s.id ? { ...x, hidden: !on } : x)))}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 py-4">
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const n = name.trim()
          if (!n) return
          onChange((ss) => [
            ...ss,
            { id: Math.max(0, ...ss.map((s) => s.id)) + 1, name: n, hidden: false, parentId: parent === 'none' ? null : Number(parent) },
          ])
          setName('')
        }}
      >
        <div className="flex gap-2">
          <Input placeholder="新しい教科" value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" disabled={!name.trim()}>
            足す
          </Button>
        </div>
        <Select items={parents} value={parent} onValueChange={(v) => v && setParent(v)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {parents.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </form>

      <div className="flex flex-col divide-y overflow-hidden rounded-xl border">
        {tree(subjects).map(({ parent: p, children }) => (
          <div key={p.id} className="flex flex-col divide-y divide-dashed">
            {row(p, false)}
            {children.map((c) => row(c, true))}
          </div>
        ))}
      </div>
      <p className="px-1 text-xs text-muted-foreground">
        スイッチを切った教科はボタンに出なくなります。上の教科を切ると、その下の教科も出なくなります。これまでの記録はそのまま苔に残ります。
      </p>
    </div>
  )
}
