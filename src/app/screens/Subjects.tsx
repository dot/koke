import { useCallback, useEffect, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { nameKey } from '../../shared/subject-name.ts'
import { api, type SubjectSetting } from '../api.ts'
import { write } from '../write.ts'

// What to show under a name that a sibling already has; the server refuses it with 409 as well.
function duplicateNote(subjects: SubjectSetting[], name: string, parentId: number | null, except: number | null): string | null {
  const key = nameKey(name)
  if (!key) return null
  const same = subjects.find((s) => s.parent_id === parentId && s.subject_id !== except && nameKey(s.name) === key)
  if (!same) return null
  return same.hidden ? '同じ名前の教科があります（隠しています）' : '同じ名前の教科があります'
}

type Props = {
  // The start buttons come from GET /api/state, so it is read again after every change.
  onChanged: () => void
  onOffline: () => void
}

// L9: add (optionally under a parent), rename, delete an unused one, reorder among siblings and hide.
export function Subjects({ onChanged, onOffline }: Props) {
  const [subjects, setSubjects] = useState<SubjectSetting[] | null>(null)
  const [name, setName] = useState('')
  const [parent, setParent] = useState('none')
  const [editing, setEditing] = useState<SubjectSetting | null>(null)
  const [newName, setNewName] = useState('')
  const [confirming, setConfirming] = useState(false)
  // One write at a time, so a second tap on a slow connection cannot send the same change twice.
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    void api<SubjectSetting[]>('/api/subjects')
      .then((r) => r.ok && setSubjects(r.body))
      .catch(onOffline)
  }, [onOffline])
  useEffect(load, [load])

  // Every answer carries the subject or list the server now holds. A refusal means this list is out
  // of date (another tab changed it), so it is read again rather than kept.
  async function change<T>(path: string, body: Record<string, unknown>, method: string, apply: (body: T) => void) {
    setBusy(true)
    try {
      const r = await write<T>(path, body, method)
      if (!r.ok && 'offline' in r) {
        onOffline()
        return false
      }
      if (r.ok) apply(r.body)
      else load()
      onChanged()
      return r.ok
    } finally {
      setBusy(false)
    }
  }
  const replace = (s: SubjectSetting) => setSubjects((ss) => ss && ss.map((x) => (x.subject_id === s.subject_id ? s : x)))

  if (subjects === null) return null

  const parents = subjects.filter((s) => s.parent_id === null)
  const parentId = parent === 'none' ? null : Number(parent)
  const addNote = duplicateNote(subjects, name, parentId, null)
  const editNote = editing && duplicateNote(subjects, newName, editing.parent_id, editing.subject_id)
  // Why the edit sheet cannot delete this subject, or null when it can.
  const keep =
    editing === null
      ? null
      : editing.used
        ? '記録があるので消せません。スイッチで隠せます'
        : subjects.some((c) => c.parent_id === editing.subject_id)
          ? '下に教科があるので消せません'
          : null
  const parentItems = [
    { value: 'none', label: '上の教科なし' },
    ...parents.map((s) => ({ value: String(s.subject_id), label: `${s.name} の下` })),
  ]

  const move = (s: SubjectSetting, d: -1 | 1) => {
    const sib = subjects.filter((x) => x.parent_id === s.parent_id)
    const other = sib[sib.indexOf(s) + d]
    const ids = subjects.map((x) => x.subject_id)
    const i = ids.indexOf(s.subject_id)
    const j = ids.indexOf(other.subject_id)
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    void change<SubjectSetting[]>('/api/subjects/order', { subject_ids: ids }, 'PUT', setSubjects)
  }

  const row = (s: SubjectSetting, child: boolean) => {
    const sib = subjects.filter((x) => x.parent_id === s.parent_id)
    const i = sib.indexOf(s)
    // Hiding a parent hides its children from the start buttons too, whatever their own switch says.
    const underHidden = child && parents.some((p) => p.subject_id === s.parent_id && p.hidden)
    return (
      <div key={s.subject_id} className={cn('flex items-center gap-2 py-2 pr-3', child ? 'pl-8' : 'pl-3')}>
        <button
          type="button"
          className={cn(
            'flex-1 text-left',
            child && 'text-sm',
            underHidden && 'text-muted-foreground',
            s.hidden && 'text-muted-foreground line-through',
          )}
          onClick={() => {
            setNewName(s.name)
            setEditing(s)
          }}
        >
          {s.name}
        </button>
        <Button variant="ghost" size="icon-sm" aria-label="上へ" disabled={busy || i === 0} onClick={() => move(s, -1)}>
          <ArrowUp />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="下へ" disabled={busy || i === sib.length - 1} onClick={() => move(s, 1)}>
          <ArrowDown />
        </Button>
        <Switch
          aria-label="表示する"
          checked={!s.hidden}
          disabled={busy}
          onCheckedChange={(on) => void change(`/api/subjects/${s.subject_id}`, { hidden: !on }, 'PATCH', replace)}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 py-4">
      <form
        className="flex flex-col gap-2"
        onSubmit={async (e) => {
          e.preventDefault()
          const n = name.trim()
          if (!n) return
          if (!n || addNote) return
          const body = parentId === null ? { name: n } : { name: n, parent_id: parentId }
          if (await change<SubjectSetting>('/api/subjects', body, 'POST', (s) => setSubjects((ss) => ss && [...ss, s]))) setName('')
        }}
      >
        <div className="flex gap-2">
          <Input placeholder="新しい教科" value={name} maxLength={40} aria-invalid={addNote !== null} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" disabled={busy || !name.trim() || addNote !== null}>
            足す
          </Button>
        </div>
        {addNote && <p className="px-1 text-xs text-destructive">{addNote}</p>}
        <Select items={parentItems} value={parent} onValueChange={(v) => v && setParent(v)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {parentItems.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </form>

      {subjects.length > 0 && (
        <div className="flex flex-col divide-y overflow-hidden rounded-xl border">
          {parents.map((p) => (
            <div key={p.subject_id} className="flex flex-col divide-y divide-dashed">
              {row(p, false)}
              {subjects.filter((c) => c.parent_id === p.subject_id).map((c) => row(c, true))}
            </div>
          ))}
        </div>
      )}
      <p className="px-1 text-xs text-muted-foreground">
        スイッチを切った教科はボタンに出なくなります。上の教科を切ると、その下の教科も出なくなります。これまでの記録はそのまま苔に残ります。
      </p>

      <Drawer open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>教科を編集</DrawerTitle>
          </DrawerHeader>
          <div className="flex flex-col gap-6 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <form
              className="flex flex-col gap-3"
              onSubmit={async (e) => {
                e.preventDefault()
                const n = newName.trim()
                if (!editing || !n || editNote) return
                if (await change(`/api/subjects/${editing.subject_id}`, { name: n }, 'PATCH', replace)) setEditing(null)
              }}
            >
              <Input value={newName} maxLength={40} aria-invalid={Boolean(editNote)} onChange={(e) => setNewName(e.target.value)} />
              {editNote && <p className="px-1 text-xs text-destructive">{editNote}</p>}
              <Button type="submit" size="lg" disabled={busy || !newName.trim() || Boolean(editNote) || newName.trim() === editing?.name}>
                保存する
              </Button>
            </form>
            <div className="flex flex-col gap-1">
              <Button variant="ghost" className="text-destructive" disabled={busy || keep !== null} onClick={() => setConfirming(true)}>
                この教科を消す
              </Button>
              {keep && <p className="text-center text-xs text-muted-foreground">{keep}</p>}
            </div>
          </div>
        </DrawerContent>
      </Drawer>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>「{editing?.name}」を消しますか？</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>やめる</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                setConfirming(false)
                if (!editing) return
                if (await change<SubjectSetting[]>(`/api/subjects/${editing.subject_id}`, {}, 'DELETE', setSubjects)) setEditing(null)
              }}
            >
              消す
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
