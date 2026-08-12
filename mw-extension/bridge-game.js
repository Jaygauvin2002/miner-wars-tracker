// Relais côté GoMining (monde ISOLÉ → accès à chrome.storage).
// Lit les données captées par content.js (localStorage de la page) et les pousse dans
// chrome.storage.local, la mémoire PRIVÉE de l'extension partagée avec la page tracker.
(function () {
  'use strict';
  let last = '';
  function push() {
    try {
      const v = localStorage.getItem('mw_spy_v6');
      if (v && v !== last) {
        last = v;
        chrome.storage.local.set({ mw_spy_data: v, mw_spy_at: Date.now() });
      }
    } catch (e) {}
  }
  setInterval(push, 2500); // pousse toute nouveauté toutes les 2,5 s
  push();
})();
