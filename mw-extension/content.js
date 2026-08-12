// Miner Wars — Espion (CAPTEUR seul). world:MAIN → hooke fetch/Response du jeu.
// Toute l'ANALYSE est sur la page tracker. Ici : capter + scanner + stocker (envoyé auto au tracker).
(function () {
  'use strict';
  const LS = 'mw_spy_v6';
  const BIG_LIMIT = 100;   // rounds par requête (au lieu de 10) → ~8× moins de requêtes = beaucoup plus rapide
  try { localStorage.removeItem('mw_spy_v5'); } catch (e) {}
  let S = {
    clan: null, botGmt: null, botCfg: null, total: null, pos: null, gmtPrice: null,
    abil: {}, clanNames: {}, agg: {},
    byMultLg: {}, spLg: {}, durLg: {}, lgMax: {}, clanCyc: {},
    seen: {}, cyc: {}, nSeen: 0, nowCy: null, roster: null, recipe: null, updated: null
  };
  try { const o = JSON.parse(localStorage.getItem(LS) || 'null'); if (o) S = Object.assign(S, o); } catch (e) {}
  if (S.sv6 !== 7) { S.agg = {}; S.byMultLg = {}; S.spLg = {}; S.durLg = {}; S.lgMax = {}; S.clanCyc = {}; S.seen = {}; S.cyc = {}; S.nSeen = 0; S.sv6 = 7; try { localStorage.setItem(LS, JSON.stringify(S)); } catch (e) {} } // remise à zéro demandée
  const save = () => { try { localStorage.setItem(LS, JSON.stringify(S)); } catch (e) {} };
  const g = (o, ...p) => p.reduce((a, k) => (a == null ? a : a[k]), o);
  const dow = t => { try { const d = new Date(t); const n = (d.getDay() + 6) % 7; return isNaN(n) ? null : n; } catch (e) { return null; } };
  const abils = arr => (Array.isArray(arr) ? arr : []).map(a => ({ id: a.nftGameAbilityId || a.abilityId || a.id, count: a.count || 1 })).filter(a => a.id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const extractRounds = d => (Array.isArray(d) ? d : ((d && d.array) || []));

  function aggRound(r) {
    if (!r || r.id == null || r.winnerClanId == null) return 0;
    const lg = r.leagueId, m = r.multiplier, wc = r.winnerClanId, cy = r.cycleId;
    if (lg == null || m == null) return 0;
    S.lgMax[lg] = Math.max(S.lgMax[lg] || 0, m);   // classe le tier (Dune ≤ x32 ; au-dessus = Eclipse/Horizon/Odyssey)
    if (m > 32) return 0;
    const cw = r.clanWinner || {};
    if (cw.clan && cw.clan.id && cw.clan.name) S.clanNames[cw.clan.id] = cw.clan.name;
    const a = S.agg[wc] || (S.agg[wc] = { w: 0, ev: 0, m: {}, d: [0, 0, 0, 0, 0, 0, 0], sp: {}, cm: {}, lg: {} });
    a.w++; a.lg[lg] = 1; if (cy != null) { S.cyc[cy] = 1; (S.clanCyc[wc] = S.clanCyc[wc] || {})[cy] = lg; }
    const bl = S.byMultLg[lg] || (S.byMultLg[lg] = {}); const bm = bl[m] || (bl[m] = [0, 0]); bm[0]++;
    if (r.startedAt && r.endedAt) { const du = (new Date(r.endedAt) - new Date(r.startedAt)) / 60000; if (du > 0 && du < 300) { const dl = S.durLg[lg] || (S.durLg[lg] = {}); const D = dl[m] || (dl[m] = [0, 0, 0]); D[0] += du; D[1]++; if (du > 5) D[2]++; } }
    const spells = abils(cw.usedAbilities);
    if (spells.length) {
      a.ev++; a.m[m] = (a.m[m] || 0) + 1;
      const dw = dow(r.endedAt || r.startedAt); if (dw != null) a.d[dw]++;
      a.cm[m] = a.cm[m] || {};
      const sl = S.spLg[lg] || (S.spLg[lg] = {}); const sm = sl[m] || (sl[m] = {});
      spells.forEach(x => { const nm = (S.abil[x.id] || x.id).replace(' Boost', ''); a.sp[nm] = (a.sp[nm] || 0) + 1; a.cm[m][nm] = (a.cm[m][nm] || 0) + x.count; sm[nm] = (sm[nm] || 0) + 1; });
      bm[1]++;
    }
    S.nSeen++;
    return 1;
  }

  function handle(url, obj) {
    try {
      if (!obj) return; const d = obj.data !== undefined ? obj.data : obj;
      if (url.includes('nft-game-ability/find-all')) { (Array.isArray(d) ? d : (d.array || [])).forEach(a => { if (a && a.id) S.abil[a.id] = a.name; }); }
      else if (url.includes('nft-game/clan/get-my')) { S.clan = d; if (d && d.id && d.name) S.clanNames[d.id] = d.name; }
      else if (url.includes('nft-game-bot-balance/get-my')) S.botGmt = (+g(d, 'valueNumeric') || 0) / 1e18;
      else if (url.includes('nft-game-bot/index')) S.botCfg = Array.isArray(d) ? d : (d.array || d);
      else if (url.includes('nft-game/get-total-reward-by-user')) S.total = d;
      else if (url.includes('nft-game/league/get-user-positions-data')) S.pos = d;
      else if (url.includes('exchanges/getTokenPrice')) S.gmtPrice = g(d, 'value');
      else if (url.includes('nft-game/round/find-by-cycleId')) {
        let n = 0;
        extractRounds(d).forEach(r => { if (r && r.winnerClanId != null) { n++; const cw = r.clanWinner || {}; if (cw.clan && cw.clan.id && cw.clan.name) S.clanNames[cw.clan.id] = cw.clan.name; } });
        save(); render(); return n;
      }
      else if (url.includes('nft-game/round/get-last')) {
        if (d && d.id != null) {
          if (d.botBalanceValueNumeric) S.botGmt = (+d.botBalanceValueNumeric || 0) / 1e18;
          if (d.cycleId != null) S.nowCy = d.cycleId;
          if (Array.isArray(d.userRounds) && d.userRounds.length) {
            const clans = {}; d.userRounds.forEach(u => { if (u && u.clanId != null) clans[u.clanId] = Math.round(u.power || 0); });
            if (Object.keys(clans).length) S.roster = { lg: d.leagueId, cy: d.cycleId, clans };
          }
        }
      }
      else return;
      S.updated = new Date().toISOString(); save(); render();
    } catch (e) {}
  }
  const oJson = Response.prototype.json; Response.prototype.json = function () { const u = this.url; return oJson.call(this).then(d => { handle(u, d); return d; }); };
  const oText = Response.prototype.text; Response.prototype.text = function () { const u = this.url; return oText.call(this).then(t => { try { if (t && (t[0] === '{' || t[0] === '[')) handle(u, JSON.parse(t)); } catch (e) {} return t; }); };
  let lastAuth = null;
  const grabAuth = hsrc => { if (!hsrc) return; try { if (typeof hsrc.forEach === 'function') hsrc.forEach((v, k) => { if (/^authorization$/i.test(k)) lastAuth = v; }); else if (typeof hsrc === 'object') Object.keys(hsrc).forEach(k => { if (/^authorization$/i.test(k)) lastAuth = hsrc[k]; }); } catch (e) {} };
  const freshHeaders = h => { const H = Object.assign({}, h || {}); if (lastAuth) { Object.keys(H).forEach(k => { if (/^authorization$/i.test(k)) delete H[k]; }); H['Authorization'] = lastAuth; } return H; };
  const oFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const hsrc = (init && init.headers) || (input && input.headers);
      if (url.indexOf('gomining.com') >= 0) grabAuth(hsrc);
      if (url.includes('round/find-by-cycleId')) {
        const method = (init && init.method) || (input && input.method) || 'GET';
        const headers = {}; if (hsrc) { if (typeof hsrc.forEach === 'function') hsrc.forEach((v, k) => headers[k] = v); else if (typeof hsrc === 'object') Object.keys(hsrc).forEach(k => headers[k] = hsrc[k]); }
        let body = (init && init.body); if (body != null && typeof body !== 'string') { try { body = JSON.stringify(body); } catch (e) {} }
        S.recipe = { url, method, headers, body: body != null ? body : null }; save(); render();
      }
    } catch (e) {}
    return oFetch.apply(this, arguments);
  };

  // ---------- SCANNER ----------
  let scanning = false, scanStop = false, scanMsg = '';
  function curCycle() { if (S.nowCy != null) return S.nowCy; let mx = null; Object.keys(S.cyc).forEach(c => { c = +c; if (mx == null || c > mx) mx = c; }); return mx; }
  function curLeague() { return g(S.pos, 'leagueId') || (S.roster ? S.roster.lg : undefined); }
  function detectRecipe() {
    const cyNow = curCycle(), lgNow = curLeague();
    let u; try { u = new URL(S.recipe.url); } catch (e) { return null; }
    let bodyObj = null; if (S.recipe.body) { try { bodyObj = JSON.parse(S.recipe.body); } catch (e) {} }
    const q = {}; u.searchParams.forEach((v, k) => { q[k] = v; });
    const findK = (src, re, val) => { for (const k in src) { if (re.test(k)) return k; } if (val != null) { for (const k in src) { if (String(src[k]) === String(val)) return k; } } return null; };
    const info = { method: (S.recipe.method || 'GET').toUpperCase(), bodyObj, base: u, cyLoc: null, cyKey: null, lgLoc: null, lgKey: null, pagLoc: null, pagKey: null, pageField: null, limit: 10, step: 1 };
    let k = findK(q, /cycle/i, cyNow); if (k) { info.cyLoc = 'q'; info.cyKey = k; } else if (bodyObj) { k = findK(bodyObj, /cycle/i, cyNow); if (k) { info.cyLoc = 'b'; info.cyKey = k; } }
    k = findK(q, /league|^lg$/i, lgNow); if (k) { info.lgLoc = 'q'; info.lgKey = k; } else if (bodyObj) { k = findK(bodyObj, /league|^lg$/i, lgNow); if (k) { info.lgLoc = 'b'; info.lgKey = k; } }
    const setPag = (loc, raw, key) => { info.pagLoc = loc; info.pagKey = key; let pj = {}; try { pj = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) {} info.pageField = Object.keys(pj).find(x => /page|offset|skip|from|cursor/i.test(x)) || null; info.limitField = Object.keys(pj).find(x => /^limit$|take|size|per/i.test(x)) || 'limit'; info.offsetBased = /offset|skip|from/i.test(info.pageField || ''); };
    let pk = Object.keys(q).find(x => /pag/i.test(x));
    if (pk) setPag('q', q[pk], pk);
    else if (bodyObj) { pk = Object.keys(bodyObj).find(x => /pag/i.test(x)); if (pk && typeof bodyObj[pk] === 'object') setPag('b', bodyObj[pk], pk); else { const pf = Object.keys(bodyObj).find(x => /page|offset|skip|from/i.test(x)); if (pf) { info.pagLoc = 'bflat'; info.pageField = pf; info.limitField = Object.keys(bodyObj).find(x => /limit|take|size/i.test(x)) || null; info.offsetBased = /offset|skip|from/i.test(pf); } } }
    return info;
  }
  function buildReq(info, lg, cy, off) {
    const u = new URL(info.base.toString());
    const body = info.bodyObj ? JSON.parse(JSON.stringify(info.bodyObj)) : null;
    const ALLM = [1, 2, 4, 8, 16, 32, 64, 128, 256];
    if (body) Object.keys(body).forEach(k => { if (/mult/i.test(k) && Array.isArray(body[k])) body[k] = ALLM; });
    [...u.searchParams.keys()].forEach(k => { if (/mult/i.test(k)) u.searchParams.set(k, JSON.stringify(ALLM)); });
    if (info.cyKey) { if (info.cyLoc === 'q') u.searchParams.set(info.cyKey, cy); else body[info.cyKey] = cy; }
    if (info.lgKey) { if (info.lgLoc === 'q') u.searchParams.set(info.lgKey, lg); else body[info.lgKey] = lg; }
    const setP = pj => { if (info.pageField) pj[info.pageField] = off; if (info.limitField) pj[info.limitField] = BIG_LIMIT; return pj; };
    if (info.pagLoc === 'q') { let pj = {}; try { pj = JSON.parse(u.searchParams.get(info.pagKey)); } catch (e) {} u.searchParams.set(info.pagKey, JSON.stringify(setP(pj))); }
    else if (info.pagLoc === 'b') { body[info.pagKey] = setP(body[info.pagKey] || {}); }
    else if (info.pagLoc === 'bflat') { if (info.pageField) body[info.pageField] = off; if (info.limitField) body[info.limitField] = BIG_LIMIT; }
    const opts = { method: info.method, headers: S.recipe.headers || {}, credentials: 'include' };
    if (body && info.method !== 'GET') opts.body = JSON.stringify(body);
    return { url: u.toString(), opts };
  }
  async function scan(lgFrom, lgTo, nCycles) {
    if (scanning) return;
    if (!S.recipe || !S.recipe.url) { scanMsg = '⚠️ Ouvre d\'abord l\'Historique 1×, puis relance.'; render(); return; }
    const info = detectRecipe();
    if (!info) { scanMsg = '⚠️ Requête illisible.'; render(); return; }
    scanning = true; scanStop = false;
    const nowCy = S.nowCy != null ? S.nowCy : (curCycle() || 0);
    let got = 0;
    async function fetchCycle(lg, cy, label) {
      let off = 0, guard = 0; const buf = [];
      while (true) {
        if (scanStop) break;
        const req = buildReq(info, lg, cy, off);
        req.opts.headers = freshHeaders(req.opts.headers);
        scanMsg = `${label} · ${got + buf.length} rounds`; render();
        let tot = 0, code = 0;
        try { const res = await oFetch(req.url, req.opts); code = res.status; if (res.ok) { const j = await res.json(); const rounds = extractRounds((j && j.data !== undefined) ? j.data : j); tot = rounds.length; rounds.forEach(r => { if (r && r.winnerClanId != null) buf.push(r); }); } } catch (e) {}
        if (code === 401 || code === 403) throw { auth: code };
        guard++;
        if (!info.pageField || tot === 0 || guard > 400) break;   // page vide = fin (fiable quel que soit le max du serveur)
        off += info.offsetBased ? tot : 1;                        // avance du nb RÉEL de rounds reçus (offset) ou +1 (page)
        await sleep(70);
      }
      return buf;
    }
    try {
      for (let lg = lgFrom; lg <= lgTo; lg++) {
        if (scanStop) break;
        for (let ci = 0; ci < nCycles; ci++) {
          if (scanStop) break;
          if ((S.lgMax[lg] || 0) > 32) break;   // ligue déjà connue NON-Dune → on saute ses autres cycles
          const cy = nowCy - 1 - ci; if (cy <= 0) break;
          const key = cy + ':' + lg;
          if (S.seen[key]) continue;
          const buf = await fetchCycle(lg, cy, `Ligue ${lg} cycle ${cy}`);
          if (buf.length) { buf.forEach(aggRound); got += buf.length; S.seen[key] = 1; save(); }
          await sleep(40);
        }
      }
    } catch (e) { scanning = false; scanMsg = `🔒 Jeton expiré. Ouvre l'Historique 1× puis relance.`; render(); return; }
    scanning = false;
    scanMsg = scanStop ? `⏹ Arrêté · ${got} rounds captés.` : `✅ Fini · ${got} rounds captés.`;
    save(); render();
  }

  // ---------- PANNEAU MINIMAL (juste le scanner) ----------
  let box;
  function render() {
    if (!box) return;
    const nClans = Object.keys(S.agg).length, nCyc = Object.keys(S.cyc).length, nNon = Object.keys(S.lgMax).filter(lg => (S.lgMax[lg] || 0) > 32).length;
    box.querySelector('#mwb').innerHTML =
      `<div class="row" style="opacity:.75">${(S.nSeen || 0).toLocaleString('fr-CA')} rounds · ${nClans} clans · ${nCyc} cycles · ${nNon} non-Dune</div>` +
      `<div class="scan"><div class="hd">🌐 Scanner ${S.recipe ? '<span style="color:#40cf87">requête apprise ✓</span>' : '<span style="color:#ffd166">ouvre l\'Historique 1×</span>'}</div>` +
      `<div class="row2">ligues <input id="lgA" type="number" value="1"> à <input id="lgB" type="number" value="40"> · <input id="ncy" type="number" value="6"> cycles</div>` +
      (scanning ? `<button id="mwstop" class="btnr">⏹ Stop</button> <span class="s">${scanMsg}</span>` : `<button id="mwscan" class="btng">▶ Scanner</button> <span class="s">${scanMsg}</span>`) +
      `</div>` +
      `<div class="row s" style="margin-top:8px;color:#8fd3a8">📡 Envoi auto vers ton tracker actif — ouvre ta page Miner Wars pour analyser.</div>`;
    const bs = box.querySelector('#mwscan'); if (bs) bs.onclick = () => { const a = +box.querySelector('#lgA').value || 1, b = +box.querySelector('#lgB').value || 40, n = +box.querySelector('#ncy').value || 1; scan(a, b, n); };
    const bt = box.querySelector('#mwstop'); if (bt) bt.onclick = () => { scanStop = true; };
  }
  function makeBox() {
    if (document.getElementById('mw-espion-box')) return;
    box = document.createElement('div'); box.id = 'mw-espion-box';
    box.style.cssText = 'position:fixed;top:56px;right:10px;z-index:2147483647;width:300px;background:#0e1526;color:#e6edf3;font:12px/1.5 system-ui;border:1px solid #2a3550;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.5)';
    box.innerHTML = `<div style="background:#16203a;padding:8px 11px;display:flex;justify-content:space-between;align-items:center;border-radius:12px 12px 0 0"><div style="font-weight:700">🕵️ MW Espion — capteur</div><span><button id="mwdl" title="exporter (secours)" style="background:#40cf87;color:#04120a;border:0;border-radius:6px;padding:3px 7px;cursor:pointer;font-weight:700">⬇︎</button> <button id="mwmin" style="background:#2a3550;color:#e6edf3;border:0;border-radius:6px;padding:3px 8px;cursor:pointer">–</button></span></div><div id="mwb" style="padding:10px 12px"></div><style>#mw-espion-box .row{font-size:11px;margin-bottom:10px}#mw-espion-box .hd{font-weight:700;color:#7ea0ff;margin-bottom:3px}#mw-espion-box .s{opacity:.75;font-size:11px}#mw-espion-box .scan{background:#111a2e;border:1px solid #24314f;border-radius:8px;padding:7px 8px}#mw-espion-box .row2{display:flex;gap:4px;align-items:center;flex-wrap:wrap;margin:4px 0}#mw-espion-box input{background:#0a1120;color:#e6edf3;border:1px solid #2a3550;border-radius:5px;padding:2px 4px;width:40px}#mw-espion-box .btng{background:#40cf87;color:#04120a;border:0;border-radius:6px;padding:4px 10px;cursor:pointer;font-weight:700}#mw-espion-box .btnr{background:#ff6b6b;color:#210606;border:0;border-radius:6px;padding:4px 10px;cursor:pointer;font-weight:700}</style>`;
    document.body.appendChild(box);
    box.querySelector('#mwmin').onclick = () => { const b = box.querySelector('#mwb'); b.style.display = b.style.display === 'none' ? '' : 'none'; };
    box.querySelector('#mwdl').onclick = () => { const blob = new Blob([JSON.stringify(S)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'mw_spy.json'; document.body.appendChild(a); a.click(); a.remove(); };
    render();
  }
  if (document.body) makeBox(); else addEventListener('DOMContentLoaded', makeBox);
})();
