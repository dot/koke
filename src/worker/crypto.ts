// Shared by the Worker and scripts/admin.ts (Node), so only Web Crypto is used.

const hex = (bytes: ArrayBuffer | Uint8Array) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('')

export async function sha256(text: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
}

// URL-safe, no padding: used in invitation links and in the device cookie.
export function randomToken(bytes: number): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes))
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function randomPairingCode(): string {
  // Rejection sampling keeps the six digits uniform.
  const limit = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000
  for (;;) {
    const [n] = crypto.getRandomValues(new Uint32Array(1))
    if (n < limit) return String(n % 1_000_000).padStart(6, '0')
  }
}
