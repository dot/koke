import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from '@/components/ui/input-otp'

// Phone side (L7): the code shown on the iPhone, valid for 5 minutes.
export function ShowPairingCode({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [left, setLeft] = useState(300)
  useEffect(() => {
    if (!open) return
    setLeft(300)
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(t)
  }, [open])

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>PC で見る</DrawerTitle>
          <DrawerDescription>PC のブラウザで koke を開いて、この番号を入れてください。</DrawerDescription>
        </DrawerHeader>
        <div className="flex flex-col items-center gap-2 px-4 pt-2 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          <span className="font-mono text-5xl tracking-[0.2em] tabular-nums">{left > 0 ? '482 913' : '--- ---'}</span>
          <span className="text-sm text-muted-foreground">
            {left > 0 ? `あと ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : '時間切れです。もう一度開いてください'}
          </span>
          <span className="mt-2 text-xs text-muted-foreground">PC では見るだけで、記録はできません。</span>
        </div>
      </DrawerContent>
    </Drawer>
  )
}

// PC side (L7): a browser without a valid cookie lands here.
export function PairPc({ onPaired }: { onPaired: () => void }) {
  const [code, setCode] = useState('')
  return (
    <div className="flex flex-col items-center gap-6 py-16 text-center">
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-medium">iPhone の番号を入れてください</h1>
        <p className="text-sm text-muted-foreground">iPhone の koke で「苔」→「PC で見る」を開くと、6 桁の番号が出ます。</p>
      </div>
      <InputOTP maxLength={6} value={code} onChange={setCode}>
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
      <Button disabled={code.length < 6} onClick={onPaired} className="w-40">
        つなぐ
      </Button>
    </div>
  )
}
