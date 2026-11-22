import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from '@/components/ui/input-otp'
import { api } from '../api.ts'

const PAUSED = 'しばらくしてから、新しい番号でもう一度'

// Ticks every second while active. refresh() catches up at once, for a value read right after
// a pause in ticking (the sheet was closed).
function useNow(active: boolean): [number, () => void] {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  const refresh = useCallback(() => setNow(Date.now()), [])
  return [now, refresh]
}

type Shown = { kind: 'loading' } | { kind: 'code'; code: string; expires_at: number } | { kind: 'paused' }

// Phone side (L7). Each opening of the sheet asks for a new code.
export function ShowPairingCode({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [shown, setShown] = useState<Shown>({ kind: 'loading' })
  const [now, refreshNow] = useNow(open)
  useEffect(() => {
    if (!open) return
    // A reply that lands after the sheet closed belongs to a code the next opening already replaced.
    let current = true
    api<{ code: string; expires_at: number }>('/api/pairing-codes', {}).then((r) => {
      if (!current) return
      if (r.ok) {
        refreshNow()
        setShown({ kind: 'code', ...r.body })
      } else if (r.status === 429) {
        setShown({ kind: 'paused' })
      } else {
        // This phone is no longer signed in (revoked): start over from the sign-in check.
        location.reload()
      }
    })
    return () => {
      current = false
    }
  }, [open, refreshNow])

  const left = shown.kind === 'code' ? Math.max(0, Math.ceil((shown.expires_at - now) / 1000)) : 0
  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) setShown({ kind: 'loading' })
        onOpenChange(next)
      }}
    >
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>PC で見る</DrawerTitle>
          <DrawerDescription>PC のブラウザで koke を開いて、この番号を入れてください。</DrawerDescription>
        </DrawerHeader>
        <div className="flex flex-col items-center gap-2 px-4 pt-2 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          {shown.kind === 'paused' ? (
            <span className="py-4 text-sm text-muted-foreground">{PAUSED}</span>
          ) : (
            <>
              <span className="font-mono text-5xl tracking-[0.2em] tabular-nums">
                {shown.kind === 'code' && left > 0 ? `${shown.code.slice(0, 3)} ${shown.code.slice(3)}` : '--- ---'}
              </span>
              <span className="text-sm text-muted-foreground">
                {shown.kind === 'loading'
                  ? ' '
                  : left > 0
                    ? `あと ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
                    : '時間切れです。もう一度開いてください'}
              </span>
            </>
          )}
          <span className="mt-2 text-xs text-muted-foreground">PC では見るだけで、記録はできません。</span>
        </div>
      </DrawerContent>
    </Drawer>
  )
}

// PC side (L7): a browser without a valid cookie lands here.
export function PairPc({ onPaired }: { onPaired: () => void }) {
  const [code, setCode] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [pausedUntil, setPausedUntil] = useState(0)
  const [now] = useNow(pausedUntil > 0)
  const paused = now < pausedUntil

  async function submit() {
    const r = await api('/api/pair', { code })
    if (r.ok) return onPaired()
    if (r.body.paused_until) {
      setPausedUntil(r.body.paused_until)
      setMessage(PAUSED)
    } else {
      // Expired and used codes look the same as wrong ones from here.
      setMessage('番号が違います')
    }
  }

  return (
    <div className="flex flex-col items-center gap-6 py-16 text-center">
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-medium">iPhone の番号を入れてください</h1>
        <p className="text-sm text-muted-foreground">iPhone の koke で「PC で見る」を開くと、6 桁の番号が出ます。</p>
      </div>
      <InputOTP maxLength={6} value={code} onChange={setCode} disabled={paused} inputMode="numeric" pattern="[0-9]*">
        <InputOTPGroup>
          <InputOTPSlot index={0} />
          <InputOTPSlot index={1} />
          <InputOTPSlot index={2} />
        </InputOTPGroup>
        <InputOTPSeparator />
        <InputOTPGroup>
          <InputOTPSlot index={3} />
          <InputOTPSlot index={4} />
          <InputOTPSlot index={5} />
        </InputOTPGroup>
      </InputOTP>
      {message && <p className="text-sm text-destructive">{message}</p>}
      <Button disabled={paused || code.length < 6} onClick={submit} className="w-40">
        つなぐ
      </Button>
    </div>
  )
}
