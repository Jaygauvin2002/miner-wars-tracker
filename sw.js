/* Service worker minimal pour Miner Wars Tracker.
   Stratégie : "network falling back to cache" pour la coquille de l'app,
   afin que l'appli fonctionne hors-ligne une fois installée sur l'iPhone. */

const CACHE = "mw-cache-v1";

// Fichiers à mettre en cache lors de l'installation (la coquille).
const SHELL = [
  "./",
  "./index.html",
  "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js",
];

// Installation : on précharge la coquille.
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

// Activation : on supprime les vieux caches.
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Récupération : on essaie le réseau, sinon on retombe sur le cache.
// Les appels à l'API de prix (CoinGecko) ne sont jamais mis en cache ici :
// le cache des prix est géré dans localStorage côté app.
self.addEventListener("fetch", (e) => {
  const url = e.request.url;
  if (url.includes("api.coingecko.com")) return; // laisser passer au réseau

  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        // On met en cache les ressources GET réussies de la coquille.
        if (e.request.method === "GET" && resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return resp;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("./index.html")))
  );
});
