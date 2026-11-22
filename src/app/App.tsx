import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { api, type State } from './api.ts'
import { PairPc, ShowPairingCode } from './screens/Pairing.tsx'

type Boot =
  | { kind: 'loading' }
  | { kind: 'signed-in'; state: State }
  | { kind: 'pair' }
  | { kind: 'need-invitation'; spent: boolean }

// Without a cookie, the home-screen app can only be set up from a new invitation;
// a browser tab is a PC, which pairs from the phone (ADR 2).
const standalone = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

async function boot(): Promise<Boot> {
  const url = new URL(location.href)
  const handoff = url.searchParams.get('handoff')
  if (handoff !== null) {
    url.searchParams.delete('handoff')
    history.replaceState(null, '', url)
  }
  const state = await api<State>('/api/state')
  if (state.ok) return { kind: 'signed-in', state: state.body }
  if (handoff !== null) {
    // The server ignores the code when a valid cookie is present, so this never switches accounts.
    const spent = await api<State>('/api/handoff', { code: handoff })
    if (spent.ok) return { kind: 'signed-in', state: spent.body }
    return { kind: 'need-invitation', spent: true }
  }
  return standalone() ? { kind: 'need-invitation', spent: false } : { kind: 'pair' }
}

// Once per page load: boot() strips handoff from the URL and may spend it, so a second run
// (StrictMode runs effects twice in development) must reuse the first result.
let booting: Promise<Boot> | null = null

export default function App() {
  const [view, setView] = useState<Boot>({ kind: 'loading' })
  useEffect(() => {
    ;(booting ??= boot()).then(setView)
  }, [])

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <header className="flex items-baseline gap-2 py-3">
        <span className="text-lg font-medium">koke</span>
        {view.kind === 'signed-in' && view.state.read_only && <span className="text-sm text-muted-foreground">閲覧のみ</span>}
      </header>
      {view.kind === 'need-invitation' && <NeedInvitation spent={view.spent} />}
      {view.kind === 'pair' && <PairPc onPaired={(state) => setView({ kind: 'signed-in', state })} />}
      {view.kind === 'signed-in' && <Home state={view.state} />}
    </div>
  )
}

function NeedInvitation({ spent }: { spent: boolean }) {
  return (
    <div className="flex flex-col gap-2 py-16 text-center">
      <h1 className="text-xl font-medium">{spent ? 'この招待リンクは使えません' : 'このままでは使えません'}</h1>
      {spent && <p className="text-sm text-muted-foreground">期限が切れたか、もう使われています。</p>}
      <p className="text-sm text-muted-foreground">管理者に新しい招待リンクをもらって、そのページからホーム画面に追加してください。</p>
    </div>
  )
}

// The study and moss screens arrive with #4 and #5; until then this only offers PC pairing.
function Home({ state }: { state: State }) {
  const [pairing, setPairing] = useState(false)
  if (state.read_only) return <p className="py-16 text-center text-sm text-muted-foreground">苔はここに表示されます。</p>
  return (
    <div className="flex flex-col items-center gap-6 py-16">
      <p className="text-sm text-muted-foreground">この端末は koke につながっています。</p>
      <Button variant="outline" onClick={() => setPairing(true)}>
        PC で見る
      </Button>
      <ShowPairingCode open={pairing} onOpenChange={setPairing} />
    </div>
  )
}
