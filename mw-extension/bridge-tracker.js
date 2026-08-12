// Relais côté page tracker (monde ISOLÉ → accès à chrome.storage).
// Reçoit les données de l'extension et les dépose dans le localStorage de la page tracker,
// puis prévient le tracker (événement) pour qu'il importe automatiquement.
(function () {
  'use strict';
  function deliver(v) {
    if (!v) return;
    try {
      localStorage.setItem('mw_spy_raw', v);
      window.dispatchEvent(new CustomEvent('mw-spy-updated'));
    } catch (e) {}
  }
  // au chargement : livre la dernière donnée connue
  try { chrome.storage.local.get(['mw_spy_data'], r => { if (r && r.mw_spy_data) deliver(r.mw_spy_data); }); } catch (e) {}
  // en continu : dès que GoMining pousse du neuf
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.mw_spy_data) deliver(changes.mw_spy_data.newValue);
    });
  } catch (e) {}
})();
