// Miner Wars — Espion (extension Chrome, world:MAIN → hooke fetch/Response du jeu)
// v6.5 : classement du tier DÉTERMINISTE (max multiplicateur par ligue, filtré à l'affichage)
(function () {
  'use strict';
  const LS = 'mw_spy_v6';
  try { localStorage.removeItem('mw_spy_v5'); } catch (e) {}
  let S = {
    clan: null, botGmt: null, botCfg: null, total: null, pos: null, gmtPrice: null,
    abil: {}, clanNames: {}, agg: {},
    byMultLg: {},   // ligue -> mult -> [nbRounds, nbBoostés]
    spLg: {},       // ligue -> mult -> {spell: cnt}
    durLg: {},      // ligue -> mult -> [sommeMin, nb, nb>5min]
    lgMax: {},      // ligue -> multiplicateur MAX vu (>32 = tier supérieur, PAS Dune)
    clanCyc: {},    // clanId -> { cycle: division(leagueId) }  (historique : où était le clan chaque cycle)
    seen: {}, cyc: {}, nSeen: 0, nowCy: null, roster: null, recipe: null, updated: null
  };
  try { const o = JSON.parse(localStorage.getItem(LS) || 'null'); if (o) S = Object.assign(S, o); } catch (e) {}
  if (S.sv6 !== 6) { S.agg = {}; S.byMultLg = {}; S.spLg = {}; S.durLg = {}; S.lgMax = {}; S.clanCyc = {}; S.seen = {}; S.cyc = {}; S.nSeen = 0; S.sv6 = 6; try { localStorage.setItem(LS, JSON.stringify(S)); } catch (e) {} } // v6.6 : + historique par cycle → re-scan propre
  const save = () => { try { localStorage.setItem(LS, JSON.stringify(S)); } catch (e) {} };
  const g = (o, ...p) => p.reduce((a, k) => (a == null ? a : a[k]), o);
  const DOW = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  const dow = t => { try { const d = new Date(t); const n = (d.getDay() + 6) % 7; return isNaN(n) ? null : n; } catch (e) { return null; } };
  const abils = arr => (Array.isArray(arr) ? arr : []).map(a => ({ id: a.nftGameAbilityId || a.abilityId || a.id, count: a.count || 1 })).filter(a => a.id);
  const topKeys = (o, n) => Object.keys(o).sort((a, b) => o[b] - o[a]).slice(0, n);
  const esc = s => (s + '').replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const extractRounds = d => (Array.isArray(d) ? d : ((d && d.array) || []));
  const isDune = lg => (S.lgMax[lg] || 0) <= 32;   // Dune plafonne à x32 ; au-dessus = Eclipse/Horizon/Odyssey

  function aggRound(r) {
    if (!r || r.id == null || r.winnerClanId == null) return 0;
    const lg = r.leagueId, m = r.multiplier, wc = r.winnerClanId, cy = r.cycleId;
    if (lg == null || m == null) return 0;
    S.lgMax[lg] = Math.max(S.lgMax[lg] || 0, m);   // note le max (sert à classer le tier, sur TOUT le scan)
    if (m > 32) return 0;                          // round d'un tier supérieur → pas agrégé (mais lgMax l'a noté)
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
    const setPag = (loc, raw, key) => { info.pagLoc = loc; info.pagKey = key; let pj = {}; try { pj = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) {} info.pageField = Object.keys(pj).find(x => /page|offset|skip|from|cursor/i.test(x)) || null; info.limit = pj.limit || pj.take || pj.size || pj.count || 10; info.step = /offset|skip|from/i.test(info.pageField || '') ? info.limit : 1; };
    let pk = Object.keys(q).find(x => /pag/i.test(x));
    if (pk) setPag('q', q[pk], pk);
    else if (bodyObj) { pk = Object.keys(bodyObj).find(x => /pag/i.test(x)); if (pk && typeof bodyObj[pk] === 'object') setPag('b', bodyObj[pk], pk); else { const pf = Object.keys(bodyObj).find(x => /page|offset|skip|from/i.test(x)); if (pf) { info.pagLoc = 'bflat'; info.pageField = pf; const lf = Object.keys(bodyObj).find(x => /limit|take|size|count/i.test(x)); if (lf) info.limit = bodyObj[lf] || 10; info.step = /offset|skip|from/i.test(pf) ? info.limit : 1; } } }
    return info;
  }
  function buildReq(info, lg, cy, pageIdx) {
    const u = new URL(info.base.toString());
    const body = info.bodyObj ? JSON.parse(JSON.stringify(info.bodyObj)) : null;
    const ALLM = [1, 2, 4, 8, 16, 32, 64, 128, 256]; // large : pour VOIR les hauts multiplicateurs (classer le tier)
    if (body) Object.keys(body).forEach(k => { if (/mult/i.test(k) && Array.isArray(body[k])) body[k] = ALLM; });
    [...u.searchParams.keys()].forEach(k => { if (/mult/i.test(k)) u.searchParams.set(k, JSON.stringify(ALLM)); });
    const pageVal = pageIdx * info.step;
    if (info.cyKey) { if (info.cyLoc === 'q') u.searchParams.set(info.cyKey, cy); else body[info.cyKey] = cy; }
    if (info.lgKey) { if (info.lgLoc === 'q') u.searchParams.set(info.lgKey, lg); else body[info.lgKey] = lg; }
    if (info.pagLoc === 'q') { let pj = {}; try { pj = JSON.parse(u.searchParams.get(info.pagKey)); } catch (e) {} if (info.pageField) pj[info.pageField] = pageVal; u.searchParams.set(info.pagKey, JSON.stringify(pj)); }
    else if (info.pagLoc === 'b') { let pj = body[info.pagKey] || {}; if (info.pageField) pj[info.pageField] = pageVal; body[info.pagKey] = pj; }
    else if (info.pagLoc === 'bflat' && info.pageField) { body[info.pageField] = pageVal; }
    const opts = { method: info.method, headers: S.recipe.headers || {}, credentials: 'include' };
    if (body && info.method !== 'GET') opts.body = JSON.stringify(body);
    return { url: u.toString(), opts, limit: info.limit };
  }
  async function scan(lgFrom, lgTo, nCycles) {
    if (scanning) return;
    if (!S.recipe || !S.recipe.url) { scanMsg = '⚠️ Ouvre d\'abord l\'Historique 1×, puis relance.'; render(); return; }
    const info = detectRecipe();
    if (!info) { scanMsg = '⚠️ Requête illisible — clique ⬇︎ et envoie-moi le fichier.'; render(); return; }
    scanning = true; scanStop = false;
    const nowCy = S.nowCy != null ? S.nowCy : (curCycle() || 0);
    let got = 0;
    async function fetchCycle(lg, cy, label) {
      let page = 0; const buf = [];
      while (true) {
        if (scanStop) break;
        const req = buildReq(info, lg, cy, page);
        req.opts.headers = freshHeaders(req.opts.headers);
        scanMsg = `${label} · p${page + 1} · ${got} rounds Dune`; render();
        let n = 0, code = 0;
        try { const res = await oFetch(req.url, req.opts); code = res.status; if (res.ok) { const j = await res.json(); extractRounds((j && j.data !== undefined) ? j.data : j).forEach(r => { if (r && r.winnerClanId != null) { n++; buf.push(r); } }); } } catch (e) {}
        if (code === 401 || code === 403) throw { auth: code };
        page++;
        if (!info.pageField) break;
        if (n < req.limit || page >= 200) break;
        await sleep(230);
      }
      return buf;
    }
    try {
      for (let lg = lgFrom; lg <= lgTo; lg++) {
        if (scanStop) break;
        for (let ci = 0; ci < nCycles; ci++) {
          if (scanStop) break;
          const cy = nowCy - 1 - ci; if (cy <= 0) break;
          const key = cy + ':' + lg;
          if (S.seen[key]) continue;
          const buf = await fetchCycle(lg, cy, `Ligue ${lg} cycle ${cy}`);
          if (buf.length) { buf.forEach(aggRound); got += buf.length; S.seen[key] = 1; save(); }
          await sleep(150);
        }
      }
    } catch (e) { scanning = false; scanMsg = `🔒 Jeton expiré. Ouvre l'Historique 1× puis relance.`; render(); return; }
    scanning = false;
    const nd = Object.keys(S.lgMax).filter(lg => !isDune(lg)).length;
    scanMsg = scanStop ? `⏹ Arrêté · ${got} rounds (${nd} ligues non-Dune écartées).` : `✅ Fini · ${nd} ligues non-Dune écartées à l'affichage.`;
    save(); render();
  }

  // ---- agrégats Dune-only (calculés à la volée en filtrant les ligues > x32) ----
  function byMultDune() { const M = {}; Object.keys(S.byMultLg).forEach(lg => { if (!isDune(lg)) return; const o = S.byMultLg[lg]; Object.keys(o).forEach(m => { const t = M[m] || (M[m] = [0, 0]); t[0] += o[m][0]; t[1] += o[m][1]; }); }); return M; }
  function spDune() { const R = {}; Object.keys(S.spLg).forEach(lg => { if (!isDune(lg)) return; const o = S.spLg[lg]; Object.keys(o).forEach(m => { const t = R[m] || (R[m] = {}); Object.keys(o[m]).forEach(nm => { t[nm] = (t[nm] || 0) + o[m][nm]; }); }); }); return R; }
  function durDune() { let dt = 0, dn = 0, d5 = 0; const per = {}; Object.keys(S.durLg).forEach(lg => { if (!isDune(lg)) return; const o = S.durLg[lg]; Object.keys(o).forEach(m => { const p = per[m] || (per[m] = [0, 0, 0]); p[0] += o[m][0]; p[1] += o[m][1]; p[2] += o[m][2]; dt += o[m][0]; dn += o[m][1]; d5 += o[m][2]; }); }); return { per, dt, dn, d5 }; }
  const clanIsDune = a => Object.keys(a.lg || {}).some(lg => isDune(lg));

  // ---- Recherche d'un clan par nom : historique par cycle + habitudes de boost ----
  function renderSearch() {
    const inp = document.getElementById('mwq'), res = document.getElementById('mwqres');
    if (!inp || !res) return;
    const q = (inp.value || '').trim().toLowerCase();
    if (!q) { res.innerHTML = ''; return; }
    const matches = Object.keys(S.agg).filter(c => { const a = S.agg[c]; if (!clanIsDune(a)) return false; return (S.clanNames[c] || ('Clan ' + c)).toLowerCase().includes(q); })
      .sort((a, b) => S.agg[b].w - S.agg[a].w).slice(0, 6);
    if (!matches.length) { res.innerHTML = `<div class="sub" style="padding:4px 0">Aucun clan Dune trouvé pour « ${esc(q)} ».</div>`; return; }
    res.innerHTML = matches.map(c => {
      const a = S.agg[c]; const nm = S.clanNames[c] || ('Clan ' + c);
      const mm = topKeys(a.m, 3).map(m => 'x' + m).join('·');
      const dd = a.d.map((v, i) => [v, i]).sort((x, y) => y[0] - x[0]).slice(0, 2).filter(x => x[0] > 0).map(x => DOW[x[1]]).join('·');
      const sp = topKeys(a.sp, 2).join('·');
      const cyc = S.clanCyc[c] || {};
      const hist = Object.keys(cyc).map(Number).sort((x, y) => y - x).slice(0, 10).map(cy => `cy${cy}→div${cyc[cy]}`).join(' · ');
      const cast = Object.keys(a.cm || {}).map(Number).sort((x, y) => (a.m[y] || 0) - (a.m[x] || 0)).slice(0, 3).map(mu => { const s = a.cm[mu] || {}; const t = Object.keys(s).sort((x, y) => s[y] - s[x])[0]; const den = a.m[mu] || 0; const avg = (t && den) ? Math.round(s[t] / den * 10) / 10 : 0; return `x${mu}:${avg}×${t || ''}`; }).join('  ');
      return `<div class="clan"><b>${esc(nm)}</b> <span class="tag">${a.ev}b / ${a.w}v</span>`
        + `<div class="sub">📅 divisions : ${hist || '—'}</div>`
        + `<div class="sub">⚡ boost ${mm || '—'} · ${sp || '—'} · jours ${dd || '—'}</div>`
        + (cast ? `<div class="sub">🎯 casts moy : ${esc(cast)}</div>` : '') + `</div>`;
    }).join('');
  }

  let box;
  function render() {
    if (!box) return;
    const cid = g(S.clan, 'id');
    const duneClanIds = Object.keys(S.agg).filter(c => clanIsDune(S.agg[c]));
    const M = byMultDune(); const nDune = Object.keys(M).reduce((s, m) => s + M[m][0], 0);
    const nCyc = Object.keys(S.cyc).length, nNon = Object.keys(S.lgMax).filter(lg => !isDune(lg)).length;
    let h = '';
    h += `<div class="mws" style="opacity:.7;font-size:11px">${nDune.toLocaleString('fr-CA')} rounds Dune · ${duneClanIds.length} clans · ${nCyc} cycles · ${nNon} ligues non-Dune écartées</div>`;
    h += `<div class="mws scan"><div class="mwh">🌐 Scanner auto ${S.recipe ? '<span style="color:#40cf87">requête apprise ✓</span>' : '<span style="color:#ffd166">ouvre l\'Historique 1×</span>'}</div>`;
    h += `<div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;margin:3px 0">ligues <input id="lgA" type="number" value="1" style="width:38px"> à <input id="lgB" type="number" value="40" style="width:38px"> · <input id="ncy" type="number" value="6" style="width:38px"> cycles</div>`;
    h += scanning ? `<button id="mwstop" class="btnr">⏹ Stop</button> <span class="sub">${scanMsg}</span>` : `<button id="mwscan" class="btng">▶ Scanner</button> <span class="sub">${scanMsg}</span>`;
    h += `</div>`;
    const boostOn = (S.botCfg || []).filter(b => b.active).map(b => 'x' + b.multiplier).join(' ');
    h += `<div class="mws"><span class="mwh">🤖 Bot</span> ${S.botGmt != null ? S.botGmt.toFixed(0) + ' GMT' : '—'} · boost ${boostOn || '—'}</div>`;
    if (Object.keys(M).length) {
      const D = durDune();
      h += `<div class="mws"><div class="mwh">⚔️ Contestation & durée (Dune)</div><table><tr class="hd"><td>mult</td><td>boosté</td><td>durée moy</td><td>%>5min</td></tr>` +
        Object.keys(M).sort((a, b) => a - b).map(m => { const x = M[m]; const p = x[0] ? Math.round(x[1] / x[0] * 100) : 0; const hot = p >= 50 ? '#ff6b6b' : p >= 20 ? '#ffd166' : '#40cf87'; const d = D.per[m]; const av = (d && d[1]) ? (d[0] / d[1]) : null; const o5 = (d && d[1]) ? Math.round(d[2] / d[1] * 100) : null; const dc = (o5 != null && o5 >= 50) ? '#40cf87' : '#e6edf3'; return `<tr><td>x${m}</td><td style="color:${hot}">${p}%</td><td>${av != null ? av.toFixed(0) + 'min' : '—'}</td><td style="color:${dc}">${o5 != null ? o5 + '%' : '—'}</td></tr>`; }).join('') + `</table>` +
        (D.dn ? `<div class="note" style="color:#c9a3ff">⏱️ <b>${Math.round(D.d5 / D.dn * 100)}% des rondes durent > 5 min</b> (moy ${(D.dt / D.dn).toFixed(1)} min). ${(D.d5 / D.dn) >= 0.5 ? 'Rondes longues → ton Clan-boost ×2 bat les Timewrap.' : 'Rondes courtes → Timewrap avantagé.'}</div>` : '') + `</div>`;
    }
    if (S.roster && S.roster.clans && Object.keys(S.roster.clans).length) {
      const present = Object.keys(S.roster.clans).filter(id => +id !== cid).map(id => ({ id, pw: S.roster.clans[id], a: S.agg[id] }));
      const known = present.filter(x => x.a && x.a.ev > 0 && clanIsDune(x.a)).sort((a, b) => b.a.ev - a.a.ev);
      h += `<div class="mws" style="background:#1a1330;border:1px solid #4a2f6f;border-radius:8px;padding:7px 8px"><div class="mwh" style="color:#c9a3ff">⚠️ Dans ta division (${present.length} · ${known.length} fichés)</div>`;
      if (known.length) known.slice(0, 10).forEach(x => { const a = x.a; const nm = S.clanNames[x.id] || ('Clan ' + x.id); const mm = topKeys(a.m, 3).map(m => 'x' + m).join('·'); const sp = topKeys(a.sp, 1).join(''); h += `<div class="clan"><b>${nm}</b> <span class="tag">${a.ev}b/${a.w}v</span><br><span class="sub">boost ${mm || '—'} · ${sp || '—'} · ${x.pw} TH</span></div>`; });
      else h += `<div class="sub">Aucun clan fiché — scanne des cycles passés.</div>`;
      h += `</div>`;
    }
    const ranked = duneClanIds.filter(id => +id !== cid && S.agg[id].ev > 0).sort((a, b) => S.agg[b].ev - S.agg[a].ev).slice(0, 12);
    if (ranked.length) {
      h += `<div class="mws"><div class="mwh">🕵️ Top boosters (Dune)</div>`;
      ranked.forEach(id => { const a = S.agg[id]; const nm = S.clanNames[id] || ('Clan ' + id); const mm = topKeys(a.m, 3).map(m => 'x' + m).join('·'); const dd = a.d.map((v, i) => [v, i]).sort((x, y) => y[0] - x[0]).slice(0, 2).filter(x => x[0] > 0).map(x => DOW[x[1]]).join('·'); const sp = topKeys(a.sp, 1).join(''); h += `<div class="clan"><b>${nm}</b> <span class="tag">${a.ev} boosts</span><br><span class="sub">sur ${mm || '—'} · ${dd || '—'} · ${sp || '—'} · ${a.w} vict</span></div>`; });
      h += `</div>`;
    } else { h += `<div class="mws note">Aucun booster Dune agrégé. Lance le scanner sur des cycles passés.</div>`; }
    box.querySelector('#mwb').innerHTML = h;
    const bs = box.querySelector('#mwscan'); if (bs) bs.onclick = () => { const a = +box.querySelector('#lgA').value || 1, b = +box.querySelector('#lgB').value || 40, n = +box.querySelector('#ncy').value || 1; scan(a, b, n); };
    const bt = box.querySelector('#mwstop'); if (bt) bt.onclick = () => { scanStop = true; };
  }
  function makeBox() {
    if (document.getElementById('mw-espion-box')) return;
    box = document.createElement('div'); box.id = 'mw-espion-box';
    box.style.cssText = 'position:fixed;top:56px;right:10px;z-index:2147483647;width:330px;max-height:84vh;overflow:auto;background:#0e1526;color:#e6edf3;font:12px/1.5 system-ui;border:1px solid #2a3550;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.5)';
    box.innerHTML = `<div style="position:sticky;top:0;background:#16203a;padding:8px 11px;display:flex;justify-content:space-between;align-items:center;gap:6px;z-index:2"><div style="font-weight:700">🕵️ MW Espion</div><span><button id="mwdl" title="exporter" style="background:#40cf87;color:#04120a;border:0;border-radius:6px;padding:3px 7px;cursor:pointer;font-weight:700">⬇︎</button> <button id="mwmin" style="background:#2a3550;color:#e6edf3;border:0;border-radius:6px;padding:3px 8px;cursor:pointer">–</button></span></div><div style="padding:8px 11px;border-bottom:1px solid #1e2842"><input id="mwq" placeholder="🔎 Chercher un clan par nom" style="width:100%" autocomplete="off"><div id="mwqres" style="margin-top:4px"></div></div><div id="mwb" style="padding:10px 12px"></div><style>#mw-espion-box .mws{margin-bottom:12px}#mw-espion-box .mwh{font-weight:700;color:#7ea0ff;display:block;margin-bottom:3px}#mw-espion-box table{width:100%;font-size:11px;border-collapse:collapse}#mw-espion-box td{padding:1px 0}#mw-espion-box .hd td{opacity:.55}#mw-espion-box .note{opacity:.6;font-size:10.5px;margin-top:3px}#mw-espion-box .clan{padding:5px 0;border-top:1px solid #1e2842}#mw-espion-box .tag{background:#233;color:#9fd;border-radius:4px;padding:0 5px;font-size:10px}#mw-espion-box .sub{opacity:.72;font-size:11px}#mw-espion-box input{background:#0a1120;color:#e6edf3;border:1px solid #2a3550;border-radius:5px;padding:3px 6px}#mw-espion-box .scan{background:#111a2e;border:1px solid #24314f;border-radius:8px;padding:7px 8px}#mw-espion-box .btng{background:#40cf87;color:#04120a;border:0;border-radius:6px;padding:4px 10px;cursor:pointer;font-weight:700}#mw-espion-box .btnr{background:#ff6b6b;color:#210606;border:0;border-radius:6px;padding:4px 10px;cursor:pointer;font-weight:700}</style>`;
    document.body.appendChild(box);
    box.querySelector('#mwq').addEventListener('input', renderSearch);
    box.querySelector('#mwmin').onclick = () => { const b = box.querySelector('#mwb'); b.style.display = b.style.display === 'none' ? '' : 'none'; };
    box.querySelector('#mwdl').onclick = () => { const blob = new Blob([JSON.stringify(S)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'mw_spy.json'; document.body.appendChild(a); a.click(); a.remove(); };
    render();
  }
  if (document.body) makeBox(); else addEventListener('DOMContentLoaded', makeBox);
})();
