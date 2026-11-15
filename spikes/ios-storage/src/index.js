// Throwaway spike for #8. Shows what an iOS home-screen PWA can see after
// (B) an invitation opened in Safari, and (A) a round trip through another origin.
// Codes are random placeholders; nothing here authenticates anyone.

const YEAR = 400 * 24 * 3600;

function cookie(name, value) {
  return `${name}=${value}; Path=/; Max-Age=${YEAR}; HttpOnly; Secure; SameSite=Lax`;
}

function readCookies(req) {
  const out = {};
  for (const part of (req.headers.get("Cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k) out[k] = v.join("=");
  }
  return out;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const randomCode = () => crypto.randomUUID().slice(0, 8);

function page(title, body, { manifest = "/manifest/none", headers = {} } = {}) {
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="manifest" href="${esc(manifest)}">
<link rel="apple-touch-icon" href="/icon-192.png">
<style>
  :root { --bg: #f4f1e8; --fg: #222; --muted: #666; --accent: #3f6b3a; }
  @media (prefers-color-scheme: dark) { :root { --bg: #1b1d1a; --fg: #e8e8e2; --muted: #9a9a92; --accent: #8fbf7f; } }
  body { margin: 0; padding: 16px; font: 16px/1.5 -apple-system, system-ui, sans-serif; background: var(--bg); color: var(--fg); }
  h1 { font-size: 18px; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; }
  dt { color: var(--muted); }
  dd { margin: 0; font-family: ui-monospace, monospace; overflow-wrap: anywhere; }
  a.button { display: inline-block; padding: 10px 16px; border-radius: 8px; background: var(--accent); color: var(--bg); text-decoration: none; margin: 8px 8px 0 0; }
</style>
</head>
<body>
<h1>${esc(title)}</h1>
${body}
<script>
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  for (const el of document.querySelectorAll("[data-standalone]")) el.textContent = String(standalone);
  for (const el of document.querySelectorAll("[data-ls]")) {
    try { el.textContent = localStorage.getItem(el.dataset.ls) ?? "(none)"; } catch (e) { el.textContent = "error: " + e.message; }
  }
  document.querySelector("[data-now]") && (document.querySelector("[data-now]").textContent = new Date().toLocaleTimeString());
</script>
</body>
</html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...headers } },
  );
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const c = readCookies(req);
    const path = url.pathname;

    // (B) Invitation opened in Safari: plant the code in every place the PWA might inherit it from.
    const invite = path.match(/^\/invite\/([\w-]+)$/);
    if (invite) {
      const code = invite[1];
      return page(
        "koke auth spike: invitation",
        `<p>Invitation <b>${esc(code)}</b> stored as a cookie and in localStorage.</p>
<p>Now tap Share → <b>Add to Home Screen</b>, then open it from the home screen icon.</p>
<dl><dt>standalone</dt><dd data-standalone></dd></dl>
<script>localStorage.setItem("invite_ls", ${JSON.stringify(code)});</script>`,
        { manifest: `/manifest/${code}`, headers: { "Set-Cookie": cookie("invite_cookie", code) } },
      );
    }

    const manifest = path.match(/^\/manifest\/([\w-]+)$/);
    if (manifest) {
      return Response.json(
        {
          name: "koke auth spike",
          short_name: "koke auth",
          start_url: `/?handoff=${manifest[1]}`,
          scope: "/",
          display: "standalone",
          background_color: "#f4f1e8",
          theme_color: "#3f6b3a",
          icons: [
            { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          ],
        },
        { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "no-store" } },
      );
    }

    // (A) Fake identity provider, served from the second deployment's origin.
    if (path === "/idp/authorize") {
      const redirect = url.searchParams.get("redirect") ?? "";
      return page(
        "fake IdP: sign in",
        `<p>This page is on <b>${esc(url.host)}</b>, a different origin from the app.</p>
<dl><dt>standalone here</dt><dd data-standalone></dd></dl>
<a class="button" href="${esc(`${redirect}?code=${randomCode()}`)}">Allow</a>`,
      );
    }

    if (path === "/callback") {
      const code = url.searchParams.get("code") ?? "";
      return page(
        "koke auth spike: back from IdP",
        `<p>Returned with code <b>${esc(code)}</b>; cookie <code>idp_session</code> set.</p>
<dl><dt>standalone here</dt><dd data-standalone></dd></dl>
<a class="button" href="/">Go to home</a>`,
        { headers: { "Set-Cookie": cookie("idp_session", code) } },
      );
    }

    if (path === "/") {
      const handoff = url.searchParams.get("handoff");
      const headers = handoff ? { "Set-Cookie": cookie("handoff_cookie", handoff) } : {};
      const idpUrl = `${env.IDP_ORIGIN}/idp/authorize?redirect=${encodeURIComponent(`${url.origin}/callback`)}`;
      return page(
        "koke auth spike",
        `<dl>
<dt>loaded at</dt><dd data-now></dd>
<dt>standalone</dt><dd data-standalone></dd>
<dt>?handoff (start_url)</dt><dd>${esc(handoff ?? "(none)")}</dd>
<dt>invite_cookie</dt><dd>${esc(c.invite_cookie ?? "(none)")}</dd>
<dt>invite_ls</dt><dd data-ls="invite_ls"></dd>
<dt>handoff_cookie</dt><dd>${esc(c.handoff_cookie ?? "(none)")}</dd>
<dt>idp_session</dt><dd>${esc(c.idp_session ?? "(none)")}</dd>
</dl>
<a class="button" href="${esc(idpUrl)}">Sign in with fake IdP</a>
<a class="button" href="/">Reload</a>`,
        { headers },
      );
    }

    return env.ASSETS.fetch(req);
  },
};
