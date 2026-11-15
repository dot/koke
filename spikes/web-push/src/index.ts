import { b64urlEncode, sendPush, vapidPublicKey, type PushOptions, type PushSubscriptionJSON } from "./webpush";

interface Env {
  ASSETS: Fetcher;
  SPIKE: KVNamespace;
  VAPID_PRIVATE_JWK: string;
  SEND_TOKEN: string;
}

interface StoredSub {
  label: string;
  subscription: PushSubscriptionJSON;
}

const URGENCIES = ["very-low", "low", "normal", "high"] as const;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function sha256Hex(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function log(env: Env, entry: Record<string, unknown>): Promise<void> {
  const at = new Date().toISOString();
  // Keys sort by time; the suffix avoids collisions between events in the same millisecond.
  await env.SPIKE.put(`log:${at}:${crypto.randomUUID().slice(0, 8)}`, JSON.stringify({ at, ...entry }));
}

async function handleSend(req: Request, env: Env, url: URL): Promise<Response> {
  // An unset secret would otherwise compare equal to the literal header "Bearer undefined".
  if (!env.SEND_TOKEN || req.headers.get("Authorization") !== `Bearer ${env.SEND_TOKEN}`) {
    return json({ error: "unauthorized" }, 401);
  }
  const ttl = Number(url.searchParams.get("ttl") ?? "60");
  const urgency = (url.searchParams.get("urgency") ?? "high") as PushOptions["urgency"];
  if (!Number.isInteger(ttl) || ttl < 0 || !URGENCIES.includes(urgency)) {
    return json({ error: "bad ttl or urgency" }, 400);
  }
  const note = url.searchParams.get("note") ?? "";
  const jwk = JSON.parse(env.VAPID_PRIVATE_JWK) as JsonWebKey;

  const listed = await env.SPIKE.list({ prefix: "sub:" });
  const results = [];
  for (const { name } of listed.keys) {
    const stored = await env.SPIKE.get<StoredSub>(name, "json");
    if (!stored) continue;
    const id = crypto.randomUUID().slice(0, 8);
    const sentAt = new Date().toISOString();
    const payload = JSON.stringify({ id, sentAt, title: "koke spike", body: `push ${id} ${note}`.trim() });
    let status = 0;
    let detail = "";
    try {
      const res = await sendPush(stored.subscription, payload, jwk, { ttl, urgency, subject: url.origin });
      status = res.status;
      if (!res.ok) detail = (await res.text()).slice(0, 300);
    } catch (e) {
      detail = String(e);
    }
    // 404/410 mean the browser dropped the subscription; keeping it would only produce noise.
    if (status === 404 || status === 410) await env.SPIKE.delete(name);
    const result = { kind: "sent", id, label: stored.label, status, ttl, urgency, note, detail };
    await log(env, result);
    results.push(result);
  }
  return json(results);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const route = `${req.method} ${url.pathname}`;

    switch (route) {
      case "GET /vapid-public-key":
        return json({ key: b64urlEncode(vapidPublicKey(JSON.parse(env.VAPID_PRIVATE_JWK))) });

      case "POST /subscribe": {
        const { label, subscription } = (await req.json()) as StoredSub;
        if (!subscription?.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
          return json({ error: "bad subscription" }, 400);
        }
        await env.SPIKE.put(`sub:${await sha256Hex(subscription.endpoint)}`, JSON.stringify({ label, subscription }));
        await log(env, { kind: "subscribed", label, pushService: new URL(subscription.endpoint).host });
        return json({ ok: true });
      }

      case "POST /send":
        return handleSend(req, env, url);

      case "POST /ack": {
        const { id, kind, detail } = (await req.json()) as { id?: string; kind?: string; detail?: string };
        if (!["received", "clicked", "opened"].includes(kind ?? "")) return json({ error: "bad kind" }, 400);
        await log(env, { kind, id, detail });
        return json({ ok: true });
      }

      case "GET /log": {
        const listed = await env.SPIKE.list({ prefix: "log:" });
        const entries = await Promise.all(listed.keys.map((k) => env.SPIKE.get(k.name, "json")));
        return json(entries.filter(Boolean));
      }

      default:
        return env.ASSETS.fetch(req);
    }
  },
} satisfies ExportedHandler<Env>;
