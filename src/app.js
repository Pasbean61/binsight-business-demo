/* BinSight business demo. All numbers come from the embedded data (#demo), which is derived from the
   BinSight research model: real Edinburgh bin stops, streets, wards and routes; simulated fill levels. */
(() => {
  "use strict";
  const D = JSON.parse(document.getElementById("demo").textContent);
  const F = D.facts, S = D.stops, N = D.names, SIM = F.sim;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const nStops = S.lat.length;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");

  /* ---------- formatting ---------- */
  const int = v => Math.round(v).toLocaleString("en-GB");
  const pct = v => Math.round(v * 100) + "%";
  const clock = m => { const t = Math.round(F.fleet.start_h * 60 + m); return String(Math.floor(t / 60) % 24).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0"); };
  const money = v => {
    const a = Math.abs(v);
    if (a >= 1e6) return "£" + (v / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.?0+$/, "") + "m";
    if (a >= 1e4) return "£" + Math.round(v / 1e3) + "k";
    if (a >= 1e3) return "£" + (v / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
    return "£" + Math.round(v);
  };
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const planDate = new Date(F.plan_day + "T12:00:00Z");
  const dayLong = `${DAYS[planDate.getUTCDay()]} ${planDate.getUTCDate()} ${MONTHS[planDate.getUTCMonth()]}`;
  const dayShort = `${DAYS[planDate.getUTCDay()].slice(0, 3)} ${planDate.getUTCDate()} ${MONTHS[planDate.getUTCMonth()].slice(0, 3)}`;

  /* ---------- headline numbers (all derived from the simulation) ---------- */
  const tt = SIM.timetable, bs = SIM.binsight;
  const perStopDay = (tt.cost_day - bs.cost_day) / nStops;               // £ saved per stop per day
  const hoursFreedDay = tt.truck_hours_day - bs.truck_hours_day;
  const derived = {
    served: int(F.plan.served), stops: int(nStops), bins: int(F.bins), fleet: int(F.fleet.trucks),
    trucks: int(F.plan.trucks), trips: int(F.plan.trips), lastBack: clock(F.plan.last_back_min),
    ovfCut: pct(1 - bs.overflow_events_day / tt.overflow_events_day),
    costCut: pct(1 - bs.cost_day / tt.cost_day),
    collCut: pct(1 - bs.collections_day / tt.collections_day),
    hoursFreed: int(hoursFreedDay), shiftsFreed: int(hoursFreedDay / 8),
    simDays: `${F.sim_days} test days × ${F.sim_seeds} runs`,
    perStop: "£" + int(perStopDay * 365),
  };
  $$("[data-f]").forEach(el => { const v = derived[el.dataset.f]; if (v != null) el.textContent = v; });
  $("#mDay").textContent = `${dayLong} · Edinburgh`;
  $("#crDay").textContent = dayShort;

  /* ---------- polyline decoding (Google, precision 5) ---------- */
  function decode(str) {
    const out = []; let i = 0, lat = 0, lon = 0;
    while (i < str.length) {
      for (const k of [0, 1]) {
        let b, shift = 0, res = 0;
        do { b = str.charCodeAt(i++) - 63; res |= (b & 31) << shift; shift += 5; } while (b >= 32);
        const d = res & 1 ? ~(res >> 1) : res >> 1;
        if (k === 0) lat += d; else lon += d;
      }
      out.push([lat / 1e5, lon / 1e5]);
    }
    return out;
  }

  /* ---------- projection: metres east/south of the stops' centre ---------- */
  // frame the map on where the bins are: the 1st to 99th percentile of stops, so a few outlying villages don't shrink the city
  const quant = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
  const padLa = (quant(S.lat, .99) - quant(S.lat, .01)) * .05, padLo = (quant(S.lon, .99) - quant(S.lon, .01)) * .05;
  const minLa = quant(S.lat, .01) - padLa, maxLa = quant(S.lat, .99) + padLa, minLo = quant(S.lon, .01) - padLo, maxLo = quant(S.lon, .99) + padLo;
  const la0 = (minLa + maxLa) / 2, lo0 = (minLo + maxLo) / 2;
  const KX = 111320 * Math.cos(la0 * Math.PI / 180), KY = 110540;
  const mx = lo => (lo - lo0) * KX, my = la => (la0 - la) * KY;
  const toM = ([la, lo]) => [mx(lo), my(la)];
  const ext = { x0: mx(minLo), x1: mx(maxLo), y0: my(maxLa), y1: my(minLa) };

  const stopX = Float32Array.from(S.lon, mx), stopY = Float32Array.from(S.lat, my);
  const depot = [mx(D.depot.longitude), my(D.depot.latitude)];
  const base = {
    wards: D.base.wards.map(w => w.rings.map(r => decode(r).map(toM))),
    parks: D.base.parks.map(r => decode(r).map(toM)),
    water: D.base.water.map(l => decode(l).map(toM)),
    roads: D.base.roads.map(l => decode(l).map(toM)),
  };

  /* ---------- trips: geometry plus time anchors so each truck reaches a stop at its planned ETA ---------- */
  const trips = [];
  D.trucks.forEach((t, ti) => t.trips.forEach(tr => {
    const pts = decode(tr.line).map(toM);
    const cum = new Float64Array(pts.length);
    for (let k = 1; k < pts.length; k++) cum[k] = cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
    const aT = [tr.start], aD = [0];
    let j = 0;
    tr.stops.forEach((s, k) => {
      let best = j, bd = Infinity;
      for (let q = j; q < pts.length; q++) {
        const d = Math.hypot(pts[q][0] - stopX[s], pts[q][1] - stopY[s]);
        if (d < bd) { bd = d; best = q; }
        if (d < 20) break;
      }
      j = best; aT.push(tr.eta[k]); aD.push(cum[j]);
    });
    aT.push(tr.end); aD.push(cum[pts.length - 1]);
    trips.push({ truck: ti, pts, cum, aT, aD, km: tr.km, start: tr.start, end: tr.end, total: cum[pts.length - 1] });
  }));
  function tripDist(tr, t) {
    if (t <= tr.start) return 0;
    if (t >= tr.end) return tr.total;
    const { aT, aD } = tr;
    let k = 1; while (k < aT.length - 1 && aT[k] < t) k++;
    const span = aT[k] - aT[k - 1];
    return aD[k - 1] + (span > 0 ? (t - aT[k - 1]) / span : 1) * (aD[k] - aD[k - 1]);
  }
  function pointAt(tr, d) {
    const { cum, pts } = tr;
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] < d) lo = m; else hi = m; }
    const seg = cum[hi] - cum[lo], f = seg > 0 ? (d - cum[lo]) / seg : 0;
    return [pts[lo][0] + f * (pts[hi][0] - pts[lo][0]), pts[lo][1] + f * (pts[hi][1] - pts[lo][1]), lo];
  }
  const servedIdx = [];
  for (let i = 0; i < nStops; i++) if (S.truck[i] >= 0) servedIdx.push(i);
  servedIdx.sort((a, b) => S.eta[a] - S.eta[b]);
  const T_END = F.plan.last_back_min + 6;

  /* ---------- hero map ---------- */
  const card = $("#mapcard"), cv = $("#map"), ctx = cv.getContext("2d");
  const baseCv = document.createElement("canvas"), bctx = baseCv.getContext("2d");
  let W = 0, H = 0, dpr = 1, sc = 1, ox = 0, oy = 0, C = {};
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function readColours() {
    C = { bg: css("--map-bg"), land: css("--map-land"), edge: css("--map-edge"), road: css("--map-road"), park: css("--map-park"),
          water: css("--map-water"), full: css("--map-full"), done: css("--map-done"), wait: css("--map-wait"), truck: css("--map-truck"), ink: css("--map-ink"), ink2: css("--map-ink-2") };
  }
  const P = (x, y) => [ox + x * sc, oy + y * sc];
  function layout() {
    const r = card.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    for (const c of [cv, baseCv]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const top = W < 480 ? 104 : 62, bottom = W < 480 ? 70 : 78, side = 12;
    const bw = ext.x1 - ext.x0, bh = ext.y1 - ext.y0;
    sc = Math.min((W - 2 * side) / bw, (H - top - bottom) / bh);
    ox = W / 2 - (ext.x0 + bw / 2) * sc;
    oy = top + (H - top - bottom) / 2 - (ext.y0 + bh / 2) * sc;
    drawBase();
  }
  function path(c, pts, close) {
    pts.forEach((p, k) => { const [x, y] = P(p[0], p[1]); k ? c.lineTo(x, y) : c.moveTo(x, y); });
    if (close) c.closePath();
  }
  function drawBase() {
    const c = bctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = C.bg; c.fillRect(0, 0, W, H);
    c.beginPath(); base.wards.forEach(rings => rings.forEach(r => path(c, r, true)));
    c.fillStyle = C.land; c.fill("evenodd");
    c.beginPath(); base.parks.forEach(r => path(c, r, true)); c.fillStyle = C.park; c.fill();
    c.lineJoin = c.lineCap = "round";
    c.beginPath(); base.water.forEach(l => path(c, l, false)); c.strokeStyle = C.water; c.lineWidth = 1.6; c.stroke();
    c.beginPath(); base.roads.forEach(l => path(c, l, false)); c.strokeStyle = C.road; c.lineWidth = .7; c.stroke();
    c.beginPath(); base.wards.forEach(rings => rings.forEach(r => path(c, r, true))); c.strokeStyle = C.edge; c.lineWidth = .8; c.stroke();
  }

  let T = 0, playing = !reduce.matches, visible = true, last = 0, raf = 0, hold = 0;
  const SPEED = T_END / 30;                       // a full shift in about 30 seconds
  function frame(t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(baseCv, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const r = W < 520 ? 1.15 : 1.35;
    // stops: can wait, then forecast full, then emptied
    const groups = [[], [], []];
    for (let i = 0; i < nStops; i++) {
      if (S.truck[i] >= 0) groups[S.eta[i] <= t ? 2 : 1].push(i);
      else groups[S.pred[i] >= 80 ? 1 : 0].push(i);
    }
    [[C.wait, r * .85], [C.full, r * 1.1], [C.done, r]].forEach(([col, rad], g) => {
      ctx.beginPath();
      for (const i of groups[g]) { const [x, y] = P(stopX[i], stopY[i]); ctx.moveTo(x + rad, y); ctx.arc(x, y, rad, 0, 6.2832); }
      ctx.fillStyle = col; ctx.fill();
    });
    // a ring where a bin was just emptied
    ctx.strokeStyle = C.done; ctx.lineWidth = 1;
    for (const i of servedIdx) {
      const age = t - S.eta[i];
      if (age < 0) break;
      if (age > 7) continue;
      const [x, y] = P(stopX[i], stopY[i]);
      ctx.globalAlpha = 1 - age / 7; ctx.beginPath(); ctx.arc(x, y, r + age * 1.1, 0, 6.2832); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // trails and trucks
    let km = 0, active = 0;
    const heads = [];
    ctx.lineJoin = ctx.lineCap = "round";
    ctx.strokeStyle = C.done; ctx.lineWidth = 1.1; ctx.globalAlpha = .28;
    ctx.beginPath();
    for (const tr of trips) {
      if (t <= tr.start) continue;
      const d = tripDist(tr, t);
      km += tr.km * (tr.total ? d / tr.total : 1);
      const [hx, hy, k] = pointAt(tr, d);
      let m = 0;
      for (let q = 0; q <= k; q++) { const [x, y] = P(tr.pts[q][0], tr.pts[q][1]); m++ ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      const [x, y] = P(hx, hy); ctx.lineTo(x, y);
      if (t < tr.end) { active++; heads.push([x, y]); }
    }
    ctx.stroke(); ctx.globalAlpha = 1;
    // depot
    const [dx, dy] = P(depot[0], depot[1]);
    ctx.fillStyle = C.ink; ctx.fillRect(dx - 4, dy - 4, 8, 8);
    ctx.strokeStyle = C.bg; ctx.lineWidth = 1.5; ctx.strokeRect(dx - 4, dy - 4, 8, 8);
    for (const [x, y] of heads) {
      ctx.beginPath(); ctx.arc(x, y, 5.5, 0, 6.2832); ctx.fillStyle = "rgba(255,255,255,.14)"; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, 2.9, 0, 6.2832); ctx.fillStyle = C.truck; ctx.fill();
      ctx.lineWidth = 1.2; ctx.strokeStyle = C.bg; ctx.stroke();
    }
    $("#mClock").textContent = clock(Math.min(t, T_END));
    $("#mBins").textContent = int(groups[2].length);
    $("#mTrucks").textContent = active;
    $("#mKm").textContent = int(km);
  }
  function tick(now) {
    raf = 0;
    if (!playing || !visible) return;
    const dt = last ? Math.min(.1, (now - last) / 1000) : 0; last = now;
    if (T >= T_END) { hold += dt; if (hold > 2.6) { T = 0; hold = 0; } }
    else T = Math.min(T_END, T + dt * SPEED);
    frame(T);
    raf = requestAnimationFrame(tick);
  }
  function play(on) {
    playing = on;
    const b = $("#mPlay");
    b.textContent = on ? "Pause" : "Play";
    b.setAttribute("aria-label", on ? "Pause the animation" : "Play the animation");
    last = 0;
    if (on && !raf) raf = requestAnimationFrame(tick);
  }
  $("#mPlay").addEventListener("click", () => { if (!playing && T >= T_END) T = 0; play(!playing); });
  readColours(); layout();
  window.BinSight = { show: t => { T = t; frame(t); }, play };   // handy for screenshots and testing
  if (reduce.matches) T = 300;                    // a still frame at 11:00 for reduced motion
  frame(T);
  play(playing);
  new ResizeObserver(() => { layout(); frame(T); }).observe(card);
  new IntersectionObserver(es => { visible = es[0].isIntersecting && !document.hidden; if (visible && playing && !raf) { last = 0; raf = requestAnimationFrame(tick); } }).observe(card);
  document.addEventListener("visibilitychange", () => { visible = !document.hidden; if (visible && playing && !raf) { last = 0; raf = requestAnimationFrame(tick); } });
  const retheme = () => { readColours(); drawBase(); frame(T); };
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", retheme);
  new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  /* ---------- control room ---------- */
  const wards = F.wards_plan.slice().sort((a, b) => b.served - a.served);
  const maxShare = Math.max(...wards.map(w => w.served / w.stops));
  const TOP = 8, rest = wards.slice(TOP);
  $("#crRows").innerHTML = wards.slice(0, TOP).map(w => {
    const share = w.served / w.stops;
    return `<tr><td>${w.name}</td><td class="n num">${int(w.stops)}</td><td><span class="meter" aria-hidden="true"><i style="width:${(share / maxShare * 100).toFixed(1)}%"></i></span><span class="num">${int(w.served)}</span> <span class="muted">(${pct(share)})</span></td><td class="n num">${w.trucks}</td></tr>`;
  }).join("") + `<tr><td class="muted">${rest.length} more wards</td><td class="n num muted">${int(rest.reduce((a, w) => a + w.stops, 0))}</td><td class="muted"><span class="num">${int(rest.reduce((a, w) => a + w.served, 0))}</span></td><td class="n muted"></td></tr>`;

  /* ---------- driver app: the first truck's first trip ---------- */
  {
    const t = D.trucks[0], tr = t.trips[0], SHOW = 7;
    $("#drTruck").textContent = t.id;
    $("#drSub").textContent = `Trip 1 of ${t.trips.length} · ${tr.stops.length} stops · ${tr.km.toFixed(1)} km`;
    const rows = tr.stops.slice(0, SHOW).map((s, k) =>
      `<li${k === 0 ? ' class="now"' : ""}><time>${clock(tr.eta[k])}</time><span class="st">${N[S.site[s]]}</span><span class="bins">${S.nb[s]} bin${S.nb[s] > 1 ? "s" : ""} · ${S.pred[s] >= 100 ? "full" : S.pred[s] + "%"}</span></li>`);
    rows.push(`<li class="tip"><time>${clock(tr.eta[SHOW])}</time><span class="st">${tr.stops.length - SHOW} more stops</span><span class="bins"></span></li>`);
    rows.push(`<li class="tip"><time>${clock(tr.end)}</time><span class="st">Tip, then back to depot</span><span class="bins"></span></li>`);
    $("#drRun").innerHTML = rows.join("");
    $(".phone .ph-top span").textContent = clock(tr.start);
  }

  /* ---------- per-street lookup (shared by the resident app and the search) ---------- */
  const byName = new Map();
  for (let i = 0; i < nStops; i++) { const k = S.site[i]; if (!byName.has(k)) byName.set(k, []); byName.get(k).push(i); }
  function street(k) {
    const ii = byName.get(k) || [];
    const served = ii.filter(i => S.truck[i] >= 0);
    return {
      name: N[k], stops: ii.length, bins: ii.reduce((a, i) => a + S.nb[i], 0),
      ward: (() => { const c = {}; ii.forEach(i => c[S.ward[i]] = (c[S.ward[i]] || 0) + S.nb[i]); const w = Object.keys(c).sort((a, b) => c[b] - c[a])[0]; return F.wards_plan[w]?.name || ""; })(),
      served: served.length, first: served.length ? Math.min(...served.map(i => S.eta[i])) : null,
      maxPred: Math.max(...ii.map(i => S.pred[i])),
    };
  }
  function pillFor(st) {
    if (st.served) return ["go", `Emptied tomorrow from ${clock(st.first)}`];
    if (st.maxPred >= 80) return ["warn", `Next round · forecast ${st.maxPred}%`];
    return ["wait", `Not needed tomorrow · up to ${st.maxPred}%`];
  }

  /* ---------- resident app: the fullest stop on Calton Road ---------- */
  {
    const k = N.indexOf("Calton Road");
    const ii = (byName.get(k) || []).filter(i => S.truck[i] >= 0).sort((a, b) => S.nb[b] - S.nb[a]);
    const i = ii[0];
    if (i != null) {
      const phones = $$(".phone");
      phones[1].querySelector(".ph-top span").textContent = "23:00";
      $("#rsStreet").textContent = N[k];
      $("#rsSub").textContent = `Your communal bins · ${S.nb[i]} bins at this stop`;
      $("#rsNow").textContent = S.fill[i] + "%";
      $("#rsBar").style.width = Math.min(100, S.fill[i]) + "%";
      $("#rsPred").textContent = S.pred[i] > 100 ? "over 100% without a visit" : S.pred[i] + "%";
      $("#rsPill").textContent = `Truck due tomorrow around ${clock(S.eta[i])}`;
    }
  }

  /* ---------- street search ---------- */
  const q = $("#q"), res = $("#results");
  const lower = N.map(n => n.toLowerCase());
  function search() {
    const s = q.value.trim().toLowerCase();
    if (s.length < 2) { res.innerHTML = `<li><span class="st">Type at least two letters of a street name.</span></li>`; return; }
    const hits = [];
    lower.forEach((n, k) => { const p = n.indexOf(s); if (p >= 0) hits.push([p === 0 ? 0 : 1, n.length, k]); });
    hits.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (!hits.length) { res.innerHTML = `<li><span class="st">No communal bin stops found on “${q.value.trim().replace(/[<>&"]/g, "")}”.</span><span class="sub">Many streets have kerbside bins instead. Try a nearby main road.</span></li>`; return; }
    res.innerHTML = hits.slice(0, 6).map(([, , k]) => {
      const st = street(k), [cls, txt] = pillFor(st);
      return `<li><span class="st">${st.name}</span><span class="sub">${st.stops} bin stop${st.stops > 1 ? "s" : ""} · ${st.bins} bins · ${st.ward}</span><span class="pill ${cls}">${txt}</span></li>`;
    }).join("") + (hits.length > 6 ? `<li><span class="sub">${hits.length - 6} more streets match. Keep typing to narrow it down.</span></li>` : "");
  }
  q.addEventListener("input", search);
  $("#chips").innerHTML = ["Leith Walk", "Easter Road", "Marchmont Road", "Gorgie Road", "Portobello High Street", "Calton Road"]
    .filter(n => N.includes(n)).map(n => `<button type="button">${n}</button>`).join("");
  $("#chips").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { q.value = b.textContent; search(); } });
  search();

  /* ---------- savings calculator ---------- */
  const cStops = $("#cStops");
  let level = .5;
  const yr = 365;
  const ovfPerStop = (tt.overflow_events_day - bs.overflow_events_day) / nStops;
  const hrsPerStop = hoursFreedDay / nStops;
  const co2PerStop = (tt.km_day - bs.km_day) * F.fleet.fuel_l_per_km * F.fleet.co2_kg_per_l / 1000 / nStops;   // tonnes a day
  function calc() {
    const n = +cStops.value, k = n * level * yr;
    const save = perStopDay * k;
    $("#oStops").textContent = int(n);
    $("#cTotal").textContent = money(save);
    $("#cKeep").textContent = money(save * .75);
    $("#cFee").textContent = money(save * .25);
    $("#cOvf").textContent = int(ovfPerStop * k);
    $("#cHours").textContent = int(hrsPerStop * k);
    $("#cCo2").textContent = int(co2PerStop * k);
  }
  cStops.addEventListener("input", calc);
  $("#cLevel").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    level = +b.dataset.v;
    $$("#cLevel button").forEach(x => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", x === b); });
    calc();
  });
  $$("#cLevel button").forEach(x => x.setAttribute("aria-pressed", x.classList.contains("on")));
  calc();

  /* ---------- pilot form (demo: nothing is sent) ---------- */
  $("#pilotForm").addEventListener("submit", e => {
    e.preventDefault();
    const f = e.target, err = $("#fErr");
    const name = f.name.value.trim(), org = f.org.value.trim(), email = f.email.value.trim();
    const miss = [!name && "your name", !org && "your organisation", !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && "a valid work email"].filter(Boolean);
    if (miss.length) { err.textContent = "Please add " + miss.join(", ").replace(/, ([^,]*)$/, " and $1") + "."; return; }
    err.textContent = "";
    const box = $("#pilotBox"), done = document.createElement("div");
    done.className = "done"; done.setAttribute("role", "status");
    const b = document.createElement("b"); b.textContent = `Thanks, ${name.split(" ")[0]}.`;
    const p1 = document.createElement("p"); p1.textContent = `In a live service we would reply to ${email} within two working days with a proposed pilot area for ${org} and a shadow-mode start date.`;
    const p2 = document.createElement("p"); p2.textContent = "This is a demo site, so your request has not been sent or stored anywhere.";
    done.append(b, p1, p2);
    box.replaceChildren(done);
  });
})();
