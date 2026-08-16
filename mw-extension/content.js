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
    seen: {}, cyc: {}, nSeen: 0, nowCy: null, roster: null, recipe: null, updated: null,
    rewardBase: {}   // {cycleId: {btc,fund,own,at,trusted}} — cumul figé au début de chaque cycle (survit aux resets)
  };
  try { const o = JSON.parse(localStorage.getItem(LS) || 'null'); if (o) S = Object.assign(S, o); } catch (e) {}
  if (S.sv6 !== 7) { S.agg = {}; S.byMultLg = {}; S.spLg = {}; S.durLg = {}; S.lgMax = {}; S.clanCyc = {}; S.seen = {}; S.cyc = {}; S.nSeen = 0; S.sv6 = 7; try { localStorage.setItem(LS, JSON.stringify(S)); } catch (e) {} } // remise à zéro demandée
  const save = () => { try { buildLive(); } catch (e) {} try { localStorage.setItem(LS, JSON.stringify(S)); } catch (e) {} };
  const g = (o, ...p) => p.reduce((a, k) => (a == null ? a : a[k]), o);
  const dow = t => { try { const d = new Date(t); const n = (d.getDay() + 6) % 7; return isNaN(n) ? null : n; } catch (e) { return null; } };
  const abils = arr => (Array.isArray(arr) ? arr : []).map(a => ({ id: a.nftGameAbilityId || a.abilityId || a.id, count: a.count || 1 })).filter(a => a.id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const extractRounds = d => (Array.isArray(d) ? d : ((d && d.array) || []));

  // Cherche en profondeur le 1er nombre dont la CLÉ matche re. big=true : divise par 1e18 les valeurs "wei" (>1e12).
  function deepNum(obj, re, big) {
    let found = null;
    (function walk(o, depth) {
      if (o == null || found != null || depth > 6) return;
      if (typeof o === 'object') {
        for (const k in o) {
          if (found != null) return;
          const v = o[k];
          const isNum = typeof v === 'number' || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v));
          if (isNum && re.test(k)) { let n = +v; if (big && Math.abs(n) > 1e12) n = n / 1e18; if (!isNaN(n)) { found = n; return; } }
          else if (v && typeof v === 'object') walk(v, depth + 1);
        }
      }
    })(obj, 0);
    return found;
  }
  // Emballe l'état PERSO du joueur pour le tracker.
  // Champs API confirmés (user 2026-08-12) : get-total-reward-by-user = valeurs CUMULÉES depuis le début du clan :
  //   depositBtc (BTC cumulé), depositGmtFund (GMT total cumulé = owner share + minage), depositGmtFundOwner (owner share cumulé).
  //   get-user-positions-data = {leagueId, clanRank, userRank}.
  // Récompense DU CYCLE = cumul actuel − cumul au début du cycle (baseline mémorisée par cycleId, cf. rewardBase).
  function buildLive() {
    const L = { at: S.updated || null, cycleId: S.nowCy != null ? S.nowCy : null };
    if (S.gmtPrice != null) { const p = +S.gmtPrice; if (!isNaN(p)) L.pxGmt = p; }
    if (S.botGmt != null) { const b = +S.botGmt; if (!isNaN(b)) L.botGmt = b; }
    L.leagueId = g(S.pos, 'leagueId'); if (L.leagueId == null && S.roster) L.leagueId = S.roster.lg;
    L.rank = g(S.pos, 'clanRank'); L.userRank = g(S.pos, 'userRank');
    const btcNow = g(S.total, 'depositBtc'), fundNow = g(S.total, 'depositGmtFund'), ownNow = g(S.total, 'depositGmtFundOwner');
    L.satsCum = btcNow != null ? Math.round(+btcNow * 1e8) : null;   // cumul (info)
    L.gmtCum = fundNow != null ? +fundNow : null;                    // cumul (info)
    L.gmtOwner = ownNow != null ? +ownNow : null;
    // Baseline par cycle : on fige le cumul la 1re fois qu'on voit ce cycleId. trusted = on surveillait déjà le cycle
    // précédent (donc capté près du démarrage → diff fiable). Sinon (1re install en cours de cycle) : non fiable.
    S.rewardBase = S.rewardBase || {};
    const cy = S.nowCy;
    if (cy != null && btcNow != null && fundNow != null && !S.rewardBase[cy]) {
      S.rewardBase[cy] = { btc: +btcNow, fund: +fundNow, own: ownNow != null ? +ownNow : 0, at: S.updated || null, trusted: !!S.rewardBase[cy - 1] };
    }
    const base = (cy != null) ? S.rewardBase[cy] : null;
    L.baseAt = base ? base.at : null; L.baseTrusted = base ? !!base.trusted : false;
    L.sats = (base && base.trusted && btcNow != null) ? Math.round((+btcNow - base.btc) * 1e8) : null;   // récompense DU CYCLE
    L.gmt = (base && base.trusted && fundNow != null) ? (+fundNow - base.fund) : null;                   // récompense DU CYCLE
    L.blocs = null;   // nb de blocs non exposé par ces endpoints → reste manuel
    S.live = L;
  }

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

  // Découverte : enregistre la FORME (clés) des endpoints liés aux blocs/récompenses non encore gérés,
  // pour repérer où vivent les rewards par bloc (btc/gmt/owner). Léger : clés seulement, pas les données.
  function shapeOf(x) {
    if (Array.isArray(x)) return { array: true, n: x.length, itemKeys: (x.length && x[0] && typeof x[0] === 'object') ? Object.keys(x[0]).slice(0, 50) : [] };
    if (x && typeof x === 'object') return { keys: Object.keys(x).slice(0, 50) };
    return { type: typeof x };
  }
  function discover(url, d) {
    try {
      if (!/gomining\.com/.test(url)) return;
      if (!/reward|block|round|histor|mining|prize|winn|earn|payout|bonus/i.test(url)) return;
      let path = url; try { path = new URL(url).pathname; } catch (e) {}
      S.seenUrls = S.seenUrls || {};
      if (!S.seenUrls[path] && Object.keys(S.seenUrls).length < 80) S.seenUrls[path] = shapeOf(d);
    } catch (e) {}
  }
  function handle(url, obj) {
    try {
      if (!obj) return; const d = obj.data !== undefined ? obj.data : obj;
      discover(url, d);
      if (url.includes('nft-game-ability/find-all')) { (Array.isArray(d) ? d : (d.array || [])).forEach(a => { if (a && a.id) S.abil[a.id] = a.name; }); }
      else if (url.includes('nft-game/clan/get-my')) { S.clan = d; if (d && d.id != null) { S.myId = d.id; if (d.name) S.clanNames[d.id] = d.name; } }
      else if (url.includes('nft-game-bot-balance/get-my')) S.botGmt = (+g(d, 'valueNumeric') || 0) / 1e18;
      else if (url.includes('nft-game-bot/index')) S.botCfg = Array.isArray(d) ? d : (d.array || d);
      else if (url.includes('nft-game/get-total-reward-by-user')) S.total = d;
      else if (url.includes('nft-game/league/get-user-positions-data')) S.pos = d;
      else if (url.includes('exchanges/getTokenPrice')) S.gmtPrice = g(d, 'value');
      else if (url.includes('nft-game/round/find-by-cycleId')) {
        const rs = extractRounds(d); let n = 0;
        if (rs.length) { if (!S.sampleRound) S.sampleRound = rs[0]; if (S.myId != null && !S.sampleMyRound) { const mr = rs.find(r => r && r.winnerClanId === S.myId); if (mr) S.sampleMyRound = mr; } }
        rs.forEach(r => { if (r && r.winnerClanId != null) { n++; const cw = r.clanWinner || {}; if (cw.clan && cw.clan.id && cw.clan.name) S.clanNames[cw.clan.id] = cw.clan.name; } });
        save(); render(); return n;
      }
      else if (url.includes('nft-game/round/get-last')) {
        if (d && d.id != null) {
          if (!S.lastRoundKeys) S.lastRoundKeys = Object.keys(d);
          if (Array.isArray(d.userRounds) && d.userRounds.length && !S.sampleUserRound) S.sampleUserRound = d.userRounds[0];
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
  // Décode l'expiration du jeton (JWT) SANS l'exposer — pour savoir si un bot cloud 24/7 est viable.
  function tokenTTL() {
    try {
      let t = lastAuth; if (!t) return { none: true };
      t = t.replace(/^Bearer\s+/i, ''); const p = t.split('.'); if (p.length < 2) return { opaque: true };
      const b = p[1].replace(/-/g, '+').replace(/_/g, '/');
      const j = JSON.parse(decodeURIComponent(escape(atob(b))));
      if (!j.exp) return { noexp: true };
      return { hours: Math.round((j.exp * 1000 - Date.now()) / 36e5 * 10) / 10, exp: j.exp };
    } catch (e) { return { err: true }; }
  }
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
  function buildReq(info, lg, cy, off, lim) {
    const u = new URL(info.base.toString());
    const body = info.bodyObj ? JSON.parse(JSON.stringify(info.bodyObj)) : null;
    const ALLM = [1, 2, 4, 8, 16, 32, 64, 128, 256];
    if (body) Object.keys(body).forEach(k => { if (/mult/i.test(k) && Array.isArray(body[k])) body[k] = ALLM; });
    [...u.searchParams.keys()].forEach(k => { if (/mult/i.test(k)) u.searchParams.set(k, JSON.stringify(ALLM)); });
    if (info.cyKey) { if (info.cyLoc === 'q') u.searchParams.set(info.cyKey, cy); else body[info.cyKey] = cy; }
    if (info.lgKey) { if (info.lgLoc === 'q') u.searchParams.set(info.lgKey, lg); else body[info.lgKey] = lg; }
    const setP = pj => { if (info.pageField) pj[info.pageField] = off; if (lim && info.limitField) pj[info.limitField] = lim; return pj; };
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
    let got = 0, effLimit = BIG_LIMIT;   // grosse limite ; repli auto sur la limite d'origine si le serveur la refuse
    async function fetchCycle(lg, cy, label) {
      let off = 0, guard = 0; const buf = [];
      while (true) {
        if (scanStop) break;
        const req = buildReq(info, lg, cy, off, effLimit);
        req.opts.headers = freshHeaders(req.opts.headers);
        scanMsg = `${label} · ${got + buf.length} rounds`; render();
        let tot = 0, code = 0;
        try { const res = await oFetch(req.url, req.opts); code = res.status; if (res.ok) { const j = await res.json(); const rounds = extractRounds((j && j.data !== undefined) ? j.data : j); tot = rounds.length; rounds.forEach(r => { if (r && r.winnerClanId != null) buf.push(r); }); } } catch (e) {}
        if (code === 401 || code === 403) throw { auth: code };
        if (off === 0 && buf.length === 0 && tot === 0 && effLimit) { effLimit = 0; continue; } // grosse limite refusée → repli sur la limite d'origine, on retente
        guard++;
        if (!info.pageField || tot === 0 || guard > 1000) break;   // page vide = fin
        off += info.offsetBased ? tot : 1;                         // avance du nb RÉEL reçu (offset) ou +1 (page)
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
      (() => { const L = S.live || {}; const f = (v, d) => v == null ? '—' : (+v).toLocaleString('fr-CA', { maximumFractionDigits: d || 0 });
        const cycleLine = (L.gmt != null || L.sats != null)
          ? `<div class="row2 s">💰 ${f(L.gmt, 2)} GMT · ₿ ${f(L.sats)} sats <span style="opacity:.6">· ce cycle</span></div>`
          : `<div class="row2 s">💰 ${f(L.gmtCum, 2)} · ₿ ${f(L.satsCum)} <span style="opacity:.6">· cumul (récompense par cycle auto dès le prochain mardi)</span></div>`;
        return `<div class="scan" style="margin-top:8px"><div class="hd">👤 Toi (live)</div>` + cycleLine +
          `<div class="row2 s">🏅 rang ${L.rank == null ? '—' : L.rank} · 🤖 bot ${f(L.botGmt, 2)} GMT · GMT $${f(L.pxGmt, 4)}</div>` +
          `<button id="mwperso" class="btng" style="margin-top:6px;font-size:11px;padding:3px 8px">📋 copier données perso (debug)</button>` +
          `<button id="mwtokbtn" class="btng" style="margin-top:6px;margin-left:6px;font-size:11px;padding:3px 8px;background:#7ea0ff;color:#04101f">🔑 durée du jeton</button>` +
          `<div id="mwtok" class="row2 s" style="margin-top:6px"></div></div>`; })() +
      `<div class="row s" style="margin-top:8px;color:#8fd3a8">📡 Envoi auto vers ton tracker actif — ouvre ta page Miner Wars pour analyser.</div>`;
    const bs = box.querySelector('#mwscan'); if (bs) bs.onclick = () => { const a = +box.querySelector('#lgA').value || 1, b = +box.querySelector('#lgB').value || 40, n = +box.querySelector('#ncy').value || 1; scan(a, b, n); };
    const bt = box.querySelector('#mwstop'); if (bt) bt.onclick = () => { scanStop = true; };
    const btk = box.querySelector('#mwtokbtn'); if (btk) btk.onclick = () => {
      const el = box.querySelector('#mwtok'); const r = tokenTTL();
      if (!el) return;
      if (r.none) el.innerHTML = '⚠️ Aucun jeton vu — recharge/ouvre le jeu puis réessaie.';
      else if (r.opaque) el.innerHTML = '🔒 Jeton opaque (pas un JWT) — je vérifierai autrement.';
      else if (r.noexp) el.innerHTML = '♾️ Jeton sans expiration (bon signe pour le 24/7).';
      else if (r.hours != null) el.innerHTML = `⏳ Le jeton expire dans <b>${r.hours} h</b>.` + (r.hours >= 24 ? ' ✅ Viable pour un bot cloud.' : ' ⚠️ Court — il faudra le renouveler.');
      else el.innerHTML = 'Impossible de lire le jeton.';
    };
    const bp = box.querySelector('#mwperso'); if (bp) bp.onclick = () => {
      const j = JSON.stringify({ total: S.total, pos: S.pos, botGmt: S.botGmt, gmtPrice: S.gmtPrice, live: S.live, myId: S.myId, nowCy: S.nowCy, seenUrls: S.seenUrls, sampleRound: S.sampleRound, sampleMyRound: S.sampleMyRound, sampleUserRound: S.sampleUserRound, lastRoundKeys: S.lastRoundKeys }, null, 2);
      const done = () => { bp.textContent = '✅ copié — colle dans le chat'; };
      try { navigator.clipboard.writeText(j).then(done).catch(() => { const blob = new Blob([j], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'mw_perso.json'; document.body.appendChild(a); a.click(); a.remove(); bp.textContent = '⬇︎ téléchargé — envoie le fichier'; }); }
      catch (e) { const blob = new Blob([j], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'mw_perso.json'; document.body.appendChild(a); a.click(); a.remove(); bp.textContent = '⬇︎ téléchargé — envoie le fichier'; }
    };
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
