import { sha256, randomToken } from './crypto.ts'

// Responses whose URL carries a code: the code must not leak through Referer or a cache.
const CODE_HEADERS = { 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

async function invitationUsable(db: D1Database, code: string, now: number): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM invitations WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?')
    .bind(await sha256(code), now)
    .first()
  return row !== null
}

// GET /invite/:code. Read-only: opening the link (or a chat app's preview of it) spends nothing.
export async function invitePage(db: D1Database, code: string, now: number): Promise<Response> {
  const usable = await invitationUsable(db, code, now)
  const body = usable
    ? `<h1>koke をホーム画面に追加</h1>
<ol>
  <li>下の共有ボタン（四角から矢印が出ているアイコン）をタップ</li>
  <li>「ホーム画面に追加」をタップ</li>
  <li>ホーム画面にできた koke を開く</li>
</ol>
<p class="note">このページから追加してください。別のページから追加すると、koke が使えるようになりません。</p>`
    : `<h1>このリンクは使えません</h1>
<p>期限が切れたか、もう使われています。管理者に新しいリンクをもらってください。</p>`
  const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#f7f8f2">
<title>koke</title>
${usable ? `<link rel="manifest" href="/manifest/${esc(code)}">` : ''}
<link rel="apple-touch-icon" href="/icon-180.png">
<style>
  :root { color-scheme: light dark; --bg: #f7f8f2; --fg: #1f2a22; --muted: #5d6b60; }
  @media (prefers-color-scheme: dark) { :root { --bg: #151b17; --fg: #e8ece4; --muted: #9aa79c; } }
  body { margin: 0; padding: max(24px, env(safe-area-inset-top)) 20px 24px; background: var(--bg); color: var(--fg);
         font: 17px/1.6 -apple-system, system-ui, 'Hiragino Sans', sans-serif; }
  h1 { font-size: 20px; }
  ol { padding-left: 1.4em; }
  .note { color: var(--muted); font-size: 15px; }
</style>
</head>
<body>
${body}
</body>
</html>`
  return new Response(html, {
    status: usable ? 200 : 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...CODE_HEADERS },
  })
}

// GET /manifest/:code. The start_url carries the code into the PWA's first launch (ADR 2).
export function inviteManifest(code: string): Response {
  const manifest = {
    name: 'koke',
    short_name: 'koke',
    start_url: `/?handoff=${encodeURIComponent(code)}`,
    scope: '/',
    display: 'standalone',
    background_color: '#f7f8f2',
    theme_color: '#f7f8f2',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }
  return new Response(JSON.stringify(manifest), {
    headers: { 'Content-Type': 'application/manifest+json', ...CODE_HEADERS },
  })
}

// POST /api/handoff. Spends the invitation and issues a phone token in one batch,
// so a code can never yield two devices. Returns the new token, or null if the code is not usable.
export async function spendInvitation(db: D1Database, code: string, now: number): Promise<string | null> {
  const codeHash = await sha256(code)
  const token = randomToken(32)
  const tokenHash = await sha256(token)
  const [, inserted] = await db.batch([
    db
      .prepare('UPDATE invitations SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?')
      .bind(now, codeHash, now),
    // changes() is the UPDATE above: 0 when the code was unknown, used or expired.
    db
      .prepare(
        `INSERT INTO devices (user_id, kind, label, token_hash, created_at)
         SELECT user_id, 'phone', 'iPhone', ?, ? FROM invitations
         WHERE code_hash = ? AND used_at = ? AND changes() = 1`,
      )
      .bind(tokenHash, now, codeHash, now),
    db
      .prepare(
        `UPDATE invitations SET device_id = (SELECT device_id FROM devices WHERE token_hash = ?)
         WHERE code_hash = ? AND used_at = ? AND device_id IS NULL`,
      )
      .bind(tokenHash, codeHash, now),
  ])
  return inserted.meta.changes === 1 ? token : null
}
