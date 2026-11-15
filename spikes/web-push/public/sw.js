// Every push must show a notification: iOS revokes the subscription after silent pushes.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function ack(id, kind, detail) {
  return fetch("/ack", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, kind, detail }),
  }).catch(() => {});
}

self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : { id: "?", title: "koke spike", body: "(no payload)" };
  const lagMs = data.sentAt ? Date.now() - Date.parse(data.sentAt) : null;
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title, {
        body: data.body,
        tag: data.id,
        data: { id: data.id },
        icon: "/icon-192.png",
      }),
      ack(data.id, "received", lagMs === null ? "" : `lag ${lagMs}ms`),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const id = event.notification.data?.id ?? "?";
  // Open the app without waiting on the network: focus/openWindow are only allowed shortly after the tap.
  const show = (async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (wins.length > 0) {
      await wins[0].focus();
      wins[0].postMessage({ clicked: id });
    } else {
      await self.clients.openWindow(`/?clicked=${encodeURIComponent(id)}`);
    }
  })();
  event.waitUntil(Promise.all([show, ack(id, "clicked")]));
});
