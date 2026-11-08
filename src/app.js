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

  /* ---------- projection: Web Mercator, the same one the street map uses, so everything lines up 1:1 ---------- */
  const R2D = Math.PI / 180;
  const wx = lo => (lo + 180) / 360;
  const wy = la => { const s = Math.sin(la * R2D); return .5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };
  const toW = ([la, lo]) => [wx(lo), wy(la)];
  const M_PER_UNIT = 40075016.686 * Math.cos(55.95 * R2D);           // metres per world unit around Edinburgh
  // open the map on where most bins are (5th to 95th percentile), close enough to read the neighbourhood names
  const quant = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
  const box = { s: quant(S.lat, .05), n: quant(S.lat, .95), w: quant(S.lon, .05), e: quant(S.lon, .95) };

  const stopX = Float64Array.from(S.lon, wx), stopY = Float64Array.from(S.lat, wy);
  const depot = [wx(D.depot.longitude), wy(D.depot.latitude)];
  const B = D.base;
  const base = {
    wards: B.wards.map(w => w.rings.map(r => decode(r).map(toW))),
    parks: B.parks.map(r => decode(r).map(toW)),
    lakes: (B.lakes || []).map(r => decode(r).map(toW)),
    water: B.water.map(l => decode(l).map(toW)),
    roads: Object.fromEntries(Object.entries(B.roads).map(([k, ls]) => [k, ls.map(l => decode(l).map(toW))])),
  };

  // street and place names for the fallback map (OpenStreetMap), in drawing priority order
  const LB = B.labels || { street_names: [], streets: [], places: [] };
  const lStreets = LB.streets.map(([n, la, lo, a, rk, len]) => ({ n: LB.street_names[n], x: wx(lo / 1e5 - 3), y: wy(la / 1e5 + 55), a: a * R2D, rk, len, s: 1 }));
  const lPlaces = LB.places.map(([n, la, lo, rk]) => ({ n: rk ? n.toUpperCase() : n, x: wx(lo), y: wy(la), rk, s: 0 }));
  const byRank = (arr, k) => arr.filter(l => l.rk === k);
  const labelOrder = [byRank(lPlaces, 0), byRank(lPlaces, 1), byRank(lStreets, 0), byRank(lPlaces, 2), byRank(lStreets, 1), byRank(lStreets, 2), byRank(lPlaces, 3), byRank(lStreets, 3)].flat();

  /* ---------- trips: geometry plus time anchors so each truck reaches a stop at its planned ETA ---------- */
  const trips = [];
  D.trucks.forEach((t, ti) => t.trips.forEach(tr => {
    const pts = decode(tr.line).map(toW);
    const cum = new Float64Array(pts.length);
    for (let k = 1; k < pts.length; k++) cum[k] = cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]) * M_PER_UNIT;
    const aT = [tr.start], aD = [0];
    let j = 0;
    tr.stops.forEach((s, k) => {
      let best = j, bd = Infinity;
      for (let q = j; q < pts.length; q++) {
        const d = Math.hypot(pts[q][0] - stopX[s], pts[q][1] - stopY[s]) * M_PER_UNIT;
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
  const T_END = Math.ceil(F.plan.last_back_min / 60) * 60;

  /* ---------- hero map ----------
     The street map is OpenStreetMap (OpenFreeMap vector tiles drawn by MapLibre), so streets, buildings and
     names are Edinburgh's own at every zoom. Bins and trucks are drawn on a canvas above it in the same
     projection. If the tiles can't load (offline, or inside a claude.ai artifact) a lighter vector map of the
     same streets is drawn instead, and it pans and zooms the same way. */
  const card = $("#mapcard"), cv = $("#map"), ctx = cv.getContext("2d"), baseCv = $("#mapBase"), bctx = baseCv.getContext("2d");
  const lblCv = document.createElement("canvas"); lblCv.className = "map-labels"; lblCv.setAttribute("aria-hidden", "true"); cv.after(lblCv);
  const lctx = lblCv.getContext("2d");
  let W = 0, H = 0, dpr = 1, C = {}, gl = null;
  const view = { x: .5, y: .5, z: 11 };                   // centre in world units, zoom (512-px tiles, as MapLibre)
  const css = n => getComputedStyle(card).getPropertyValue(n).trim();
  const dark = () => { const t = document.documentElement.dataset.theme; return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; };
  function readColours() {
    C = {}; ["bg", "land", "edge", "road", "road-2", "park", "water", "full", "done", "wait", "truck", "truck-ring", "ink", "label", "building"]
      .forEach(k => C[k] = css("--map-" + k));
  }
  const pad = () => W < 520 ? { top: 112, bottom: 78, left: 14, right: 14 } : { top: 70, bottom: 92, left: 24, right: 24 };
  function fitView() {
    const p = pad(), x0 = wx(box.w), x1 = wx(box.e), y0 = wy(box.n), y1 = wy(box.s);
    const sx = (W - p.left - p.right) / (x1 - x0), sy = (H - p.top - p.bottom) / (y1 - y0);
    const sc = Math.min(sx, sy);
    view.z = Math.log2(sc / 512);
    view.x = (x0 + x1) / 2 - (p.left - p.right) / 2 / sc;
    view.y = (y0 + y1) / 2 - (p.top - p.bottom) / 2 / sc;
  }
  let SC = 1, OX = 0, OY = 0;                              // world → screen: x * SC + OX
  function syncView() {
    if (gl) { const c = gl.getCenter(); view.x = wx(c.lng); view.y = wy(c.lat); view.z = gl.getZoom(); }
    SC = 512 * 2 ** view.z; OX = W / 2 - view.x * SC; OY = H / 2 - view.y * SC;
  }
  const P = (x, y) => [x * SC + OX, y * SC + OY];

  // the fallback street map
  function path(c, pts, close) {
    for (let k = 0; k < pts.length; k++) { const x = pts[k][0] * SC + OX, y = pts[k][1] * SC + OY; k ? c.lineTo(x, y) : c.moveTo(x, y); }
    if (close) c.closePath();
  }
  function drawBase() {
    if (gl) return;
    const c = bctx, z = view.z;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = C.water; c.fillRect(0, 0, W, H);                         // the Firth of Forth: everything outside the wards
    c.beginPath(); base.wards.forEach(rings => rings.forEach(r => path(c, r, true))); c.fillStyle = C.land; c.fill("evenodd");
    c.beginPath(); base.parks.forEach(r => path(c, r, true)); c.fillStyle = C.park; c.fill();
    c.beginPath(); base.lakes.forEach(r => path(c, r, true)); c.fillStyle = C.water; c.fill();
    c.lineJoin = c.lineCap = "round";
    c.beginPath(); base.water.forEach(l => path(c, l, false)); c.strokeStyle = C.water; c.lineWidth = Math.max(1.4, (z - 10) * 1.2); c.stroke();
    const w = k => Math.max(.5, k * 2 ** (z - 12));
    const cls = [["local", C["road-2"], .9], ["minor", C.road, 1.3], ["major", C.road, 2.2]].filter(([k]) => (base.roads[k] || []).length);
    cls.forEach(([k, , wd]) => { c.beginPath(); base.roads[k].forEach(l => path(c, l, false)); c.strokeStyle = C.edge; c.lineWidth = w(wd) + 1.4; c.stroke(); });   // casings first
    cls.forEach(([k, col, wd]) => { c.beginPath(); base.roads[k].forEach(l => path(c, l, false)); c.strokeStyle = col; c.lineWidth = w(wd); c.stroke(); });
    c.setLineDash([3, 3]);
    c.beginPath(); base.wards.forEach(rings => rings.forEach(r => path(c, r, true))); c.strokeStyle = C.edge; c.lineWidth = 1; c.stroke();
    c.setLineDash([]);
    drawLabels();
    base0 = { SC, OX, OY };
  }
  // names on the fallback map: places from the city zoom, street names as you zoom in, never overlapping
  const widths = new Map();
  function drawLabels() {
    const c = lctx;
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, lblCv.width, lblCv.height);
    if (gl) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const z = view.z, fam = getComputedStyle(document.body).fontFamily, ppm = SC / M_PER_UNIT, boxes = [];
    const PMIN = [9.6, 11.2, 12.7, 14.2], SMIN = [12.3, 13, 13.6, 14.5];
    const font = l => l.s ? `${l.rk < 2 ? 600 : 500} ${z > 15 ? 12.5 : 11}px ${fam}`
      : l.rk === 0 ? `680 ${z > 12 ? 15 : 13}px ${fam}` : `650 ${l.rk === 1 ? (z > 13 ? 12.5 : 11) : 10.5}px ${fam}`;
    const width = (f, t) => { const k = f + t; let w = widths.get(k); if (w == null) { c.font = f; w = c.measureText(t).width; widths.set(k, w); } return w; };
    c.textAlign = "center"; c.textBaseline = "middle"; c.lineJoin = "round";
    let n = 0;
    for (const l of labelOrder) {
      if (z < (l.s ? SMIN : PMIN)[l.rk]) continue;
      const x = l.x * SC + OX, y = l.y * SC + OY;
      if (x < -80 || y < -20 || x > W + 80 || y > H + 20) continue;
      const f = font(l), tw = width(f, l.n) + (l.s ? 0 : l.n.length * (l.rk ? 1.1 : 0)), th = l.s ? 13 : 16;
      if (l.s && tw > l.len * ppm * .95) continue;                       // the name must fit along its street
      const ca = Math.abs(Math.cos(l.a || 0)), sa = Math.abs(Math.sin(l.a || 0));
      const hw = (tw * ca + th * sa) / 2 + 3, hh = (tw * sa + th * ca) / 2 + 2;
      if (boxes.some(b => x - hw < b[2] && x + hw > b[0] && y - hh < b[3] && y + hh > b[1])) continue;
      boxes.push([x - hw, y - hh, x + hw, y + hh]);
      c.save(); c.translate(x, y); if (l.a) c.rotate(l.a);
      c.font = f; if ("letterSpacing" in c) c.letterSpacing = !l.s && l.rk ? "1.1px" : "0px";
      c.lineWidth = 3.2; c.strokeStyle = C.land; c.strokeText(l.n, 0, 0);
      c.fillStyle = l.s ? C.label : C.ink; c.globalAlpha = l.s ? .85 : (l.rk ? .72 : .9); c.fillText(l.n, 0, 0);
      c.restore();
      if (++n > 260) break;
    }
  }

  function layout() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, card.clientWidth); H = Math.max(1, card.clientHeight);
    for (const c of [cv, baseCv, lblCv]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    if (!gl && !moved) fitView();
    if (gl) gl.resize();
    syncView(); drawBase();
  }

  /* the fallback map handles the mouse like any web map: scroll to zoom, drag to pan (with a little glide),
     double-click to zoom in; on phones two fingers pan and pinch, one finger scrolls the page.
     While it moves, the street layer is moved as a bitmap and redrawn sharp once it settles. */
  let moved = false, base0 = null, settleT = 0, vraf = 0, drag = null;
  const target = { z: null, ax: 0, ay: 0 }, vel = [0, 0], touches = new Map();
  const coarse = matchMedia("(pointer: coarse)").matches;
  function applyView() {
    syncView();
    if (base0) {
      const k = SC / base0.SC, t = `translate(${OX - base0.OX * k}px, ${OY - base0.OY * k}px) scale(${k})`;
      baseCv.style.transform = t; lblCv.style.transform = t;
    }
    clearTimeout(settleT); settleT = setTimeout(sharpen, 160);
    if (!playing || !visible) frame(T);
  }
  function sharpen() { baseCv.style.transform = lblCv.style.transform = ""; syncView(); drawBase(); }
  function setZoom(z, sx, sy) {
    const k = 2 ** (z - view.z), wxp = (sx - OX) / SC, wyp = (sy - OY) / SC;
    view.x = wxp - (wxp - view.x) / k; view.y = wyp - (wyp - view.y) / k; view.z = z; syncView();
  }
  function viewLoop() {
    vraf = 0; let busy = false;
    if (target.z != null) {
      const dz = target.z - view.z;
      if (Math.abs(dz) < .003) { setZoom(target.z, target.ax, target.ay); target.z = null; }
      else { setZoom(view.z + dz * .22, target.ax, target.ay); busy = true; }
    }
    if (!drag && Math.hypot(vel[0], vel[1]) > .08) { view.x -= vel[0] / SC; view.y -= vel[1] / SC; vel[0] *= .9; vel[1] *= .9; busy = true; }
    moved = true; applyView();
    if (busy) vraf = requestAnimationFrame(viewLoop);
  }
  const kick = () => { if (!vraf) vraf = requestAnimationFrame(viewLoop); };
  const ZMIN = 9.5, ZMAX = 17.5;
  function zoomAt(dz, sx = W / 2, sy = H / 2) {
    if (gl) { gl.easeTo({ zoom: gl.getZoom() + dz, around: gl.unproject([sx, sy]), duration: 380 }); return; }
    target.z = Math.min(ZMAX, Math.max(ZMIN, (target.z ?? view.z) + dz)); target.ax = sx; target.ay = sy; kick();
  }
  function redraw() { syncView(); drawBase(); frame(T); }
  {
    const local = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    let pinch = null;
    cv.addEventListener("pointerdown", e => {
      if (gl || e.button) return;
      hideTip();
      if (e.pointerType === "touch") {
        touches.set(e.pointerId, local(e));
        if (touches.size === 2) { const [a, b] = [...touches.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], z: view.z }; cv.setPointerCapture(e.pointerId); }
        return;
      }
      drag = { p: local(e), t: performance.now() }; vel[0] = vel[1] = 0; target.z = null;
      cv.setPointerCapture(e.pointerId); card.classList.add("grabbing");
    });
    cv.addEventListener("pointermove", e => {
      if (gl) return;
      const p = local(e);
      if (e.pointerType === "touch") {
        if (!touches.has(e.pointerId)) return;
        touches.set(e.pointerId, p);
        if (touches.size === 2 && pinch) {
          const [a, b] = [...touches.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          view.x -= (m[0] - pinch.m[0]) / SC; view.y -= (m[1] - pinch.m[1]) / SC; syncView();
          setZoom(Math.min(ZMAX, Math.max(ZMIN, pinch.z + Math.log2(d / pinch.d))), m[0], m[1]);
          pinch.m = m; moved = true; applyView();
        }
        return;
      }
      if (!drag) { hover(p); return; }
      const dx = p[0] - drag.p[0], dy = p[1] - drag.p[1];
      view.x -= dx / SC; view.y -= dy / SC; vel[0] = dx; vel[1] = dy; drag.p = p; drag.t = performance.now();
      moved = true; applyView();
    });
    const up = e => {
      touches.delete(e.pointerId); if (touches.size < 2) pinch = null;
      if (!drag) return;
      if (performance.now() - drag.t > 80) vel[0] = vel[1] = 0;      // let go after stopping: no glide
      drag = null; card.classList.remove("grabbing"); kick();
    };
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    cv.addEventListener("click", e => { if (!gl) hover(local(e)); });
    cv.addEventListener("pointerleave", () => { if (!drag) hideTip(); });
    cv.addEventListener("dblclick", e => { if (gl) return; const p = local(e); zoomAt(1, p[0], p[1]); });
    cv.addEventListener("wheel", e => {
      if (gl) return;
      e.preventDefault(); hideTip();
      const p = local(e), d = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
      zoomAt(-d * (e.ctrlKey ? .012 : .0028), p[0], p[1]);           // ctrl + wheel is a trackpad pinch
    }, { passive: false });
    if (coarse) card.classList.add("coarse");
    $("#mZoomIn").addEventListener("click", () => zoomAt(1));
    $("#mZoomOut").addEventListener("click", () => zoomAt(-1));
    $("#mReset").addEventListener("click", () => {
      if (gl) { gl.fitBounds([[box.w, box.s], [box.e, box.n]], { padding: pad(), duration: 700 }); return; }
      moved = false; target.z = null; fitView(); redraw();
    });
  }

  /* hover (or tap) a bin stop to see what tomorrow's plan does with it */
  const tip = document.createElement("div"); tip.className = "map-tip"; tip.hidden = true; card.appendChild(tip);
  const truckName = k => (D.trucks[k] || {}).id || "";
  function showTip(i, x, y) {
    const pred = S.pred[i], served = S.truck[i] >= 0;
    const rows = [
      ["b", N[S.site[i]]],
      ["span", `${S.nb[i]} bin${S.nb[i] > 1 ? "s" : ""} · ${(F.wards_plan[S.ward[i]] || {}).name || ""}`],
      ["span", `Forecast by 14:00: ${pred >= 100 ? "full" : pred + "%"}`],
      ["em", served ? (S.eta[i] <= T ? `Emptied at ${clock(S.eta[i])} by ${truckName(S.truck[i])}` : `Due at ${clock(S.eta[i])} · ${truckName(S.truck[i])}`)
        : pred >= 80 ? "First on the next round" : "Not needed tomorrow"],
    ];
    tip.replaceChildren(...rows.map(([t, txt]) => { const el = document.createElement(t); el.textContent = txt; return el; }));
    tip.className = "map-tip " + (served ? (S.eta[i] <= T ? "done" : "due") : pred >= 80 ? "due" : "wait");
    tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight, left = Math.max(8, Math.min(W - w - 8, x + 14 + w > W - 8 ? x - w - 14 : x + 14));
    tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(Math.max(8, Math.min(H - h - 8, y - h / 2)))}px)`;
  }
  function hideTip() { tip.hidden = true; }
  function hover([x, y]) {
    let best = -1, bd = 100;                                 // within 10 px
    for (let i = 0; i < nStops; i++) {
      const dx = stopX[i] * SC + OX - x, dy = stopY[i] * SC + OY - y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    if (!showBins || best < 0) { hideTip(); cv.style.cursor = ""; return; }
    cv.style.cursor = "pointer"; showTip(best, x, y);
  }

  // on the street map, bin stops are a map layer under the street and place names, so the names stay readable
  const doneNow = new Uint8Array(nStops);
  function addStops(m) {
    if (m.getSource("bs-stops")) return;
    const features = [];
    for (let i = 0; i < nStops; i++) features.push({ type: "Feature", id: i, geometry: { type: "Point", coordinates: [S.lon[i], S.lat[i]] }, properties: { c: S.truck[i] >= 0 || S.pred[i] >= 80 ? 1 : 0, pred: S.pred[i] } });
    m.addSource("bs-stops", { type: "geojson", data: { type: "FeatureCollection", features } });
    const before = (m.getStyle().layers.find(l => l.type === "symbol") || {}).id;
    const big = ["==", ["get", "c"], 1];
    m.addLayer({ id: "bs-stops", type: "circle", source: "bs-stops", layout: { "circle-sort-key": ["get", "c"] }, paint: {
      "circle-color": ["case", ["boolean", ["feature-state", "done"], false], C.done, ["step", ["get", "pred"], "#c7d8d0", 35, "#8fbda8", 60, "#e6bd56", 80, "#e28740", 90, "#c84630"]],
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, ["case", big, 1.9, 1.4], 12, ["case", big, 3, 2.2], 14, 4.6, 16, 7, 18, 9.5],
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 12.5, 0, 13.5, 1.4],
      "circle-stroke-color": C.bg } }, before);
    m.setLayoutProperty("bs-stops", "visibility", showBins ? "visible" : "none");
    doneNow.fill(0); syncStops(T);
  }
  function syncStops(t) {
    if (!gl || !gl.getSource("bs-stops")) return;
    for (const i of servedIdx) {
      const want = S.eta[i] <= t ? 1 : 0;
      if (doneNow[i] !== want) { doneNow[i] = want; gl.setFeatureState({ source: "bs-stops", id: i }, { done: !!want }); }
    }
  }

  let showBins = true, showRoutes = true, followTruck = -1, speed = 1;
  const routeColours = ["#2e80ba", "#bd5832", "#8060a9", "#268c78", "#bb8b1c", "#b94485", "#528835", "#405fb4"];
  let T = 35, playing = !reduce.matches, visible = true, last = 0, raf = 0, hold = 0;
  const SPEED = T_END / 180;                                // three minutes per shift at 1×; faster modes stay proportional
  function frame(t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const z = view.z, r = Math.min(7, Math.max(1.5, 1.6 + (z - 11.3) * 1.15)), ring = z > 13.2;
    // stops: can wait, then forecast to be full, then emptied (on the street map they are a map layer instead)
    const groups = [[], [], []];
    const m = 12;
    for (let i = 0; i < nStops; i++) {
      const g = S.truck[i] >= 0 ? (S.eta[i] <= t ? 2 : 1) : (S.pred[i] >= 80 ? 1 : 0);
      groups[g].push(i);
    }
    if (gl) syncStops(t);
    else if (showBins) {
      const fills = ["#c7d8d0", "#8fbda8", "#e6bd56", "#e28740", "#c84630", C.done];
      const dots = fills.map(() => []);
      for (let i = 0; i < nStops; i++) {
        const done = S.truck[i] >= 0 && S.eta[i] <= t;
        const v = S.pred[i], k = done ? 5 : v >= 90 ? 4 : v >= 80 ? 3 : v >= 60 ? 2 : v >= 35 ? 1 : 0;
        dots[k].push(i);
      }
      dots.forEach((ii, k) => {
        ctx.beginPath();
        for (const i of ii) {
          const [x,y] = P(stopX[i],stopY[i]);
          if (x < -m || y < -m || x > W+m || y > H+m) continue;
          ctx.moveTo(x+r,y); ctx.arc(x,y,r,0,Math.PI*2);
        }
        ctx.fillStyle = fills[k]; ctx.fill();
        if (ring) { ctx.strokeStyle = C.bg; ctx.lineWidth = 1.2; ctx.stroke(); }
      });
    }
    // a ring where a bin was just emptied
    ctx.strokeStyle = C.done; ctx.lineWidth = 1.2;
    for (const i of showBins ? servedIdx : []) {
      const age = t - S.eta[i];
      if (age < 0) break;
      if (age > 7) continue;
      const [x, y] = P(stopX[i], stopY[i]);
      ctx.globalAlpha = 1 - age / 7; ctx.beginPath(); ctx.arc(x, y, r + age * (1 + r * .3), 0, 6.2832); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // the road each truck has driven so far, then the trucks
    let km = 0, active = 0;
    const heads = [];
    ctx.lineJoin = ctx.lineCap = "round";
    ctx.strokeStyle = C.done; ctx.lineWidth = Math.max(1.1, r * .7); ctx.globalAlpha = .65;
    for (const tr of trips) {
      ctx.beginPath();
      ctx.strokeStyle = routeColours[tr.truck % routeColours.length];
      ctx.globalAlpha = followTruck < 0 || followTruck === tr.truck ? .7 : .15;
      if (t <= tr.start) continue;
      const d = tripDist(tr, t);
      km += tr.km * (tr.total ? d / tr.total : 1);
      const [hx, hy, k] = pointAt(tr, d);
      for (let q = 0; q <= k; q++) { const x = tr.pts[q][0] * SC + OX, y = tr.pts[q][1] * SC + OY; q ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      const [x, y] = P(hx, hy); ctx.lineTo(x, y);
      if (showRoutes) ctx.stroke();
      if (t < tr.end) { active++; heads.push([x, y, tr.truck]); }
    }
    ctx.globalAlpha = 1;
    // depot
    const [dx, dy] = P(depot[0], depot[1]), ds = Math.max(4.5, r + 2);
    ctx.fillStyle = C.ink; ctx.strokeStyle = C.bg; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.rect(dx - ds, dy - ds, ds * 2, ds * 2); ctx.fill(); ctx.stroke();
    if (z > 11.6) {
      ctx.font = `600 ${z > 13 ? 12.5 : 11.5}px ${getComputedStyle(document.body).fontFamily}`;
      ctx.lineWidth = 3.5; ctx.strokeStyle = C.bg; ctx.strokeText("Seafield depot", dx + ds + 6, dy + 4);
      ctx.fillStyle = C.ink; ctx.fillText("Seafield depot", dx + ds + 6, dy + 4);
    }
    const tr = Math.max(3, r * .9 + 2);
    for (const [x, y, ti] of heads) {
      ctx.beginPath(); ctx.arc(x, y, tr + 3.5, 0, 6.2832); ctx.fillStyle = C["truck-ring"]; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, tr, 0, 6.2832); ctx.fillStyle = routeColours[ti % routeColours.length]; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = C.bg; ctx.stroke();
    }
    $("#mClock").textContent = clock(Math.min(t, T_END));
    if (!scrubbing) timeIn.value = Math.round(t);
    timeIn.setAttribute("aria-valuetext", clock(t) + " simulated time");
    timeIn.style.setProperty("--p", (Math.min(t, T_END) / T_END * 100).toFixed(2) + "%");
    $("#mBins").textContent = int(groups[2].length);
    $("#mTrucks").textContent = active;
    $("#mKm").textContent = int(km);
  }
  const timeIn = $("#mTime"); let scrubbing = false;
  timeIn.max = T_END;
  timeIn.setAttribute("aria-label", `Time of day in the replay, ${clock(0)} to ${clock(T_END)}`);
  $(".map-scale span:last-child").textContent = clock(T_END);
  function tick(now) {
    raf = 0;
    if (!playing || !visible) return;
    const dt = last ? Math.min(.05, (now - last) / 1000) : 0; last = now;
    if (!scrubbing) {
      if (T >= T_END) { hold += dt; if (hold > 2.4) { T = 0; hold = 0; } }
      else T = Math.min(T_END, T + dt * SPEED * speed);
    }
    followPosition();
    // with the street map, draw in the map's own frame so trucks and streets move together
    if (gl) gl.triggerRepaint(); else { syncView(); frame(T); }
    raf = requestAnimationFrame(tick);
  }
  const ICON = { pause: '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="3" y="2" width="3" height="10" rx="1" fill="currentColor"/><rect x="8" y="2" width="3" height="10" rx="1" fill="currentColor"/></svg>',
                 play: '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M4 2.2v9.6a.6.6 0 0 0 .9.5l7.6-4.8a.6.6 0 0 0 0-1L4.9 1.7a.6.6 0 0 0-.9.5z" fill="currentColor"/></svg>' };
  function play(on) {
    playing = on;
    const b = $("#mPlay");
    b.innerHTML = on ? ICON.pause : ICON.play;
    b.setAttribute("aria-label", on ? "Pause the replay" : "Play the replay");
    last = 0;
    if (on && !raf) raf = requestAnimationFrame(tick);
  }
  $("#mPlay").addEventListener("click", () => { if (!playing && T >= T_END) T = 0; play(!playing); });
  const scrub = () => { T = +timeIn.value; hold = 0; followPosition(); if (gl) gl.triggerRepaint(); else frame(T); };
  timeIn.addEventListener("input", scrub);
  timeIn.addEventListener("pointerdown", () => { scrubbing = true; });
  ["pointerup", "pointercancel", "change"].forEach(ev => timeIn.addEventListener(ev, () => { scrubbing = false; last = 0; }));
  // Search only the project's real OSM labels and council bin register; no invented coordinates.
  const locations = new Map();
  labelOrder.forEach(l => { if (!locations.has(l.n.toLowerCase())) locations.set(l.n.toLowerCase(), {name: l.n, x: l.x, y: l.y}); });
  for (let i = 0; i < nStops; i++) {
    const name = N[S.site[i]], key = name.toLowerCase();
    if (!locations.has(key)) locations.set(key, {name, x: stopX[i], y: stopY[i]});
  }
  const options = $("#mPlaces");
  [...locations.values()].sort((a,b) => a.name.localeCompare(b.name)).forEach(l => {
    const o = document.createElement("option"); o.value = l.name; options.appendChild(o);
  });
  const fromWorld = (x,y) => [(x * 360 - 180), Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) / R2D];
  const stopFollowing = () => { followTruck = -1; $("#mFollow").value = "-1"; };
  $("#mLocate").addEventListener("submit", e => {
    e.preventDefault();
    const key = $("#mSearch").value.trim().toLowerCase(), loc = locations.get(key);
    if (!loc) { $("#mSearchStatus").textContent = "Choose a street or place from the suggestions."; return; }
    stopFollowing(); hideTip();
    if (gl) gl.flyTo({center: fromWorld(loc.x, loc.y), zoom: 16, duration: reduce.matches ? 0 : 900});
    else { view.x = loc.x; view.y = loc.y; view.z = 16; moved = true; target.z = null; redraw(); }
    $("#mSearchStatus").textContent = loc.name;
  });
  D.trucks.forEach((t, i) => { const o = document.createElement("option"); o.value = i; o.textContent = t.id; $("#mFollow").appendChild(o); });
  function followPosition() {
    if (followTruck < 0) return;
    const runs = trips.filter(tr => tr.truck === followTruck);
    const tr = runs.find(tr => T >= tr.start && T <= tr.end);
    const [x,y] = tr ? pointAt(tr, tripDist(tr, T)) : depot;
    if (gl) gl.jumpTo({center: fromWorld(x,y)});
    else { view.x = x; view.y = y; moved = true; syncView(); drawBase(); }
  }
  $("#mFollow").addEventListener("change", e => { followTruck = +e.target.value; if (followTruck >= 0) { if (gl) gl.setZoom(14.5); else view.z = 14.5; followPosition(); } frame(T); });
  $("#mSpeed").addEventListener("change", e => { speed = +e.target.value; });
  $("#mShowBins").addEventListener("change", e => { showBins = e.target.checked; hideTip(); if (gl?.getLayer("bs-stops")) gl.setLayoutProperty("bs-stops", "visibility", showBins ? "visible" : "none"); frame(T); });
  $("#mShowRoutes").addEventListener("change", e => { showRoutes = e.target.checked; frame(T); });
  $("#mReset").addEventListener("click", stopFollowing);
  cv.addEventListener("pointerdown", stopFollowing);
  const figure = card.closest("figure");
  $("#mExpand").addEventListener("click", async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await figure.requestFullscreen(); }
    catch { figure.classList.toggle("map-expanded"); $("#mExpand").textContent = figure.classList.contains("map-expanded") ? "Exit full screen" : "Full screen"; layout(); }
  });
  document.addEventListener("fullscreenchange", () => { $("#mExpand").textContent = document.fullscreenElement ? "Exit full screen" : "Full screen"; layout(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && figure.classList.contains("map-expanded")) { figure.classList.remove("map-expanded"); $("#mExpand").textContent = "Full screen"; layout(); } });
  readColours(); layout();
  window.BinSight = { show: t => { T = t; syncView(); frame(t); }, play, view: () => ({ ...view, street: !!gl }), map: () => gl };   // handy for screenshots and testing
  if (reduce.matches) T = 300;                    // a still frame at 11:00 for reduced motion
  frame(T);
  play(playing);
  new ResizeObserver(() => { layout(); frame(T); }).observe(card);
  const wake = () => { if (visible && playing && !raf) { last = 0; raf = requestAnimationFrame(tick); } };
  new IntersectionObserver(es => { visible = es[0].isIntersecting && !document.hidden; wake(); }).observe(card);
  document.addEventListener("visibilitychange", () => { visible = !document.hidden; wake(); });

  /* OpenStreetMap street tiles with the platinum palette adapted from binsight-edinburgh (MIT). */
  const OFM_STYLE = "https://tiles.openfreemap.org/styles/positron";
  const ML_JS = "https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.24.0/maplibre-gl.js";
  const ML_CSS = "https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.css";
  const loadScript = src => new Promise((ok, no) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
  let rawStyle = null;
  function paletteStyle() {
    const s = JSON.parse(JSON.stringify(rawStyle));
    const lay = id => s.layers.find(l => l.id === id);
    const P = (ids, k, v) => [].concat(ids).forEach(id => { const l = lay(id); if (l) (l.paint ||= {})[k] = v; });
    const land = "#eef0f2", bld = "#d8dce1", ink = "#2a3038", txt = "#59616a", halo = "#f5f6f7";
    P("background", "background-color", land);
    P("landuse_residential", "fill-color", "#eaecef");
    P("park", "fill-color", "#dbe5de"); P("landcover_wood", "fill-color", "#d5e0d8");
    P("water", "fill-color", "#ccd5dd"); P("waterway", "line-color", "#bfc9d2");
    P("building", "fill-color", bld); P("building", "fill-outline-color", "#c9ced4");
    P(["highway_minor", "highway_major_inner", "highway_motorway_inner", "highway_motorway_bridge_inner", "tunnel_motorway_inner", "road_pier"], "line-color", "#ffffff");
    P("highway_path", "line-color", "#fbfbfc");
    P(["highway_major_casing", "highway_motorway_casing", "highway_motorway_bridge_casing", "tunnel_motorway_casing"], "line-color", "#d0d5db");
    P(["railway", "railway_transit", "railway_service"], "line-color", "#c6ccd3");
    P(["highway-name-path", "highway-name-minor", "highway-name-major"], "text-color", txt);
    P(["highway-name-path", "highway-name-minor", "highway-name-major"], "text-halo-color", halo);
    P(["highway-name-path", "highway-name-minor", "highway-name-major"], "text-halo-width", 1.4);
    s.layers.filter(l => /^label_/.test(l.id)).forEach(l => { l.paint = { ...l.paint, "text-color": ink, "text-halo-color": land, "text-halo-width": 1.4, "text-halo-blur": 0 }; });
    P(["water_name_point_label", "water_name_line_label", "waterway_line_label"], "text-color", "#61778a");
    // the building layer starts a little earlier, and street names one zoom earlier, than stock positron
    if (lay("building")) lay("building").minzoom = 13;
    if (lay("highway-name-minor")) lay("highway-name-minor").minzoom = 14.5;
    // extra detail positron leaves out: house numbers, tram and rail stops, parks and places
    const name = ["coalesce", ["get", "name_en"], ["get", "name"]];
    const extra = [
      { id: "bs-housenumber", type: "symbol", source: "openmaptiles", "source-layer": "housenumber", minzoom: 17,
        layout: { "text-field": ["get", "housenumber"], "text-font": ["Noto Sans Regular"], "text-size": 10 },
        paint: { "text-color": "#98a0a8", "text-halo-color": bld, "text-halo-width": 1 } },
      { id: "bs-poi", type: "symbol", source: "openmaptiles", "source-layer": "poi", minzoom: 16.5,
        filter: ["!", ["match", ["get", "class"], ["railway", "bus", "park"], true, false]],
        layout: { "text-field": name, "text-font": ["Noto Sans Regular"], "text-size": 10.5, "text-max-width": 8 },
        paint: { "text-color": "#80878f", "text-halo-color": halo, "text-halo-width": 1.2 } },
      { id: "bs-park", type: "symbol", source: "openmaptiles", "source-layer": "poi", minzoom: 14,
        filter: ["==", ["get", "class"], "park"],
        layout: { "text-field": name, "text-font": ["Noto Sans Italic"], "text-size": 11, "text-max-width": 8 },
        paint: { "text-color": "#5f7d68", "text-halo-color": halo, "text-halo-width": 1.2 } },
      { id: "bs-station", type: "symbol", source: "openmaptiles", "source-layer": "poi", minzoom: 13.5,
        filter: ["==", ["get", "class"], "railway"],
        layout: { "text-field": name, "text-font": ["Noto Sans Bold"], "text-size": 10.5, "text-max-width": 9, "text-anchor": "top", "text-offset": [0, .5] },
        paint: { "text-color": "#3e5568", "text-halo-color": halo, "text-halo-width": 1.4 } },
      { id: "bs-station-dot", type: "circle", source: "openmaptiles", "source-layer": "poi", minzoom: 13.5,
        filter: ["==", ["get", "class"], "railway"],
        paint: { "circle-radius": 3, "circle-color": "#ffffff", "circle-stroke-color": "#3e5568", "circle-stroke-width": 1.4 } },
    ];
    const at = s.layers.findIndex(l => l.id === "highway-name-path");
    s.layers.splice(at < 0 ? s.layers.length : at, 0, ...extra);
    return s;
  }
  (async () => {
    try {
      const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 8000);
      rawStyle = await fetch(OFM_STYLE, { signal: ctl.signal }).then(r => { if (!r.ok) throw new Error("style"); return r.json(); });
      clearTimeout(tm);
      const link = document.createElement("link"); link.rel = "stylesheet"; link.href = ML_CSS; document.head.appendChild(link);
      if (!window.maplibregl) await loadScript(ML_JS);
      if (!window.maplibregl) return;
      const m = new maplibregl.Map({
        container: "mapgl", style: paletteStyle(), bounds: [[box.w, box.s], [box.e, box.n]], fitBoundsOptions: { padding: pad() },
        attributionControl: false, dragRotate: false, pitchWithRotate: false, touchPitch: false, keyboard: true,
        cooperativeGestures: coarse, minZoom: 9.5, maxZoom: 19, fadeDuration: 0,
      });
      m.touchZoomRotate.disableRotation();
      m.keyboard.disableRotation();
      m.on("dragstart", stopFollowing);
      m.addControl(new maplibregl.ScaleControl({unit: "metric"}), "bottom-right");
      m.on("style.load", () => { if (gl) addStops(m); });
      m.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
      let on = false;
      const swap = () => {                                  // only once the first street tiles are drawn, so the map is never blank
        if (on) return; on = true;
        if (moved) m.jumpTo({center: fromWorld(view.x, view.y), zoom: view.z});
        gl = m;
        card.classList.add("street"); baseCv.hidden = true; drawLabels();
        addStops(m);
        $("#mMapStatus").textContent = "Live street map · OpenStreetMap";
        m.getCanvas().setAttribute("aria-label", "Edinburgh street map. Use arrow keys to pan, plus and minus to zoom.");
        m.on("render", () => { syncView(); frame(T); });
        m.scrollZoom.setWheelZoomRate(1 / 300); m.scrollZoom.setZoomRate(1 / 80);
        m.on("mousemove", "bs-stops", e => { const f = e.features[0]; m.getCanvas().style.cursor = "pointer"; showTip(f.id, e.point.x, e.point.y); });
        m.on("mouseleave", "bs-stops", () => { m.getCanvas().style.cursor = ""; hideTip(); });
        m.on("click", "bs-stops", e => showTip(e.features[0].id, e.point.x, e.point.y));
        m.on("movestart", hideTip);
        syncView(); frame(T);
      };
      m.once("idle", swap);
      setTimeout(() => { if (!on && m.loaded()) swap(); else if (!on) $("#mMapStatus").textContent = "Offline overview · street tiles still loading"; }, 12000);
    } catch (e) { $("#mMapStatus").textContent = "Offline overview · street tiles unavailable"; }
  })();
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

  /* ---------- the sensor: a 3D model of the HC-SR04 module, to scale in millimetres ---------- */
  const THREE_JS = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
  const stage = $("#stage");
  let sensorStarted = false;
  new IntersectionObserver((es, ob) => {
    if (!es[0].isIntersecting || sensorStarted) return;
    sensorStarted = true; ob.disconnect();
    const go = () => { try { buildSensor(); } catch (e) { $("#stageFallback").hidden = false; } };
    if (window.THREE) go();
    else { const s = document.createElement("script"); s.src = THREE_JS; s.onload = go; s.onerror = () => { $("#stageFallback").hidden = false; }; document.head.appendChild(s); }
  }, { rootMargin: "300px" }).observe(stage);

  function buildSensor() {
    const T3 = window.THREE, cvs = $("#sensor3d");
    const renderer = new T3.WebGLRenderer({ canvas: cvs, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputEncoding = T3.sRGBEncoding;
    renderer.toneMapping = T3.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    renderer.physicallyCorrectLights = true;
    const scene = new T3.Scene();
    const camera = new T3.PerspectiveCamera(28, 1, 1, 1000);
    camera.position.set(0, 4, 118);

    // a soft studio for the metal to reflect: a grey room with three light panels
    const pm = new T3.PMREMGenerator(renderer);
    const room = new T3.Scene();
    room.add(new T3.Mesh(new T3.BoxGeometry(100, 100, 100), new T3.MeshBasicMaterial({ color: 0x6f7773, side: T3.BackSide })));
    const panel = (w, h, x, y, z, ry, rx, k) => { const m = new T3.Mesh(new T3.PlaneGeometry(w, h), new T3.MeshBasicMaterial({ color: new T3.Color(k, k, k), side: T3.DoubleSide })); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); room.add(m); };
    panel(60, 20, 0, 45, 0, 0, Math.PI / 2, 5);
    panel(30, 40, -48, 5, 10, Math.PI / 2, 0, 3);
    panel(30, 40, 48, 0, 20, -Math.PI / 2, 0, 1.8);
    panel(60, 30, 0, 0, 49, Math.PI, 0, 1.4);
    scene.environment = pm.fromScene(room, .035).texture;
    const key = new T3.DirectionalLight(0xffffff, 2.2); key.position.set(-30, 50, 80); scene.add(key);
    scene.add(new T3.HemisphereLight(0xffffff, 0x8899aa, .6));

    const tex = (w, h, draw) => { const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h); const t = new T3.CanvasTexture(c); t.encoding = T3.sRGBEncoding; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t; };
    const PX = 40;                                           // texture pixels per millimetre
    const BLUE = "#1d4fa6", BLUE_D = "#173f87";
    const hole = (g, x, y) => {                               // a plated mounting hole at board coordinates (mm, origin centre, y up)
      const cx = (x + 22.5) * PX, cy = (10 - y) * PX;
      g.fillStyle = "#d4b25a"; g.beginPath(); g.arc(cx, cy, 1.1 * PX, 0, 7); g.fill();
      g.fillStyle = "#1b1d1f"; g.beginPath(); g.arc(cx, cy, .6 * PX, 0, 7); g.fill();
    };
    const traces = (g, seed) => {
      g.strokeStyle = BLUE_D; g.lineWidth = .35 * PX; g.lineCap = "round"; g.lineJoin = "round";
      let r = seed; const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
      for (let k = 0; k < 22; k++) {
        let x = rnd() * 45 * PX, y = rnd() * 20 * PX; g.beginPath(); g.moveTo(x, y);
        for (let s = 0; s < 3; s++) { if (rnd() < .5) x += (rnd() - .5) * 14 * PX; else y += (rnd() - .5) * 8 * PX; g.lineTo(x, y); }
        g.stroke();
      }
    };
    const front = tex(45 * PX, 20 * PX, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, "#2257b1"); gr.addColorStop(1, BLUE); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      traces(g, 7);
      [[-21, 8.5], [21, 8.5], [-21, -8.5], [21, -8.5]].forEach(([x, y]) => hole(g, x, y));
      g.fillStyle = "#f4f6f8"; g.textAlign = "center"; g.textBaseline = "middle";
      g.font = `700 ${2.1 * PX}px Arial, sans-serif`; g.fillText("HC-SR04", 22.5 * PX, 3.2 * PX);
      g.font = `700 ${1.6 * PX}px Arial, sans-serif`; g.fillText("T", 3.2 * PX, 18.2 * PX); g.fillText("R", 41.8 * PX, 18.2 * PX);
      g.save(); g.translate(22.5 * PX, 14.8 * PX); g.font = `600 ${1.05 * PX}px Arial, sans-serif`;
      ["Vcc", "Trig", "Echo", "Gnd"].forEach((t, k) => { g.save(); g.translate((k - 1.5) * 2.54 * PX, 0); g.rotate(-Math.PI / 2); g.fillText(t, 0, 0); g.restore(); });
      g.restore();
      // solder pads for the four header pins
      for (let k = 0; k < 4; k++) { g.fillStyle = "#cfd3d6"; g.beginPath(); g.arc((22.5 + (k - 1.5) * 2.54) * PX, 18.6 * PX, .75 * PX, 0, 7); g.fill(); }
    });
    const back = tex(45 * PX, 20 * PX, (g, w, h) => {
      g.fillStyle = BLUE; g.fillRect(0, 0, w, h); traces(g, 19);
      [[-21, 8.5], [21, 8.5], [-21, -8.5], [21, -8.5]].forEach(([x, y]) => hole(g, -x, y));
      g.fillStyle = "#f4f6f8"; g.textAlign = "center"; g.font = `600 ${1.2 * PX}px Arial, sans-serif`; g.fillText("BinSight firmware", 22.5 * PX, 18.6 * PX);
    });
    const edge = new T3.MeshStandardMaterial({ color: 0x1a4796, roughness: .6 });
    const pcb = new T3.Mesh(new T3.BoxGeometry(45, 20, 1.6), [edge, edge, edge, edge,
      new T3.MeshStandardMaterial({ map: front, roughness: .48, metalness: .05 }), new T3.MeshStandardMaterial({ map: back, roughness: .5 })]);
    const board = new T3.Group(); board.add(pcb);

    const metal = new T3.MeshStandardMaterial({ color: 0xdfe3e7, metalness: 1, roughness: .26 });
    const plastic = new T3.MeshStandardMaterial({ color: 0x1b1d1f, roughness: .55 });
    const mesh = tex(512, 512, (g, w, h) => {
      g.fillStyle = "#1d1f22"; g.fillRect(0, 0, w, h);
      g.strokeStyle = "rgba(205,210,215,.55)"; g.lineWidth = 2.2;
      for (let k = -w; k < 2 * w; k += 11) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + h, h); g.stroke(); g.beginPath(); g.moveTo(k + h, 0); g.lineTo(k, h); g.stroke(); }
      const v = g.createRadialGradient(w / 2, h / 2, w * .2, w / 2, h / 2, w * .5); v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,.55)"); g.fillStyle = v; g.fillRect(0, 0, w, h);
    });
    const grille = new T3.MeshStandardMaterial({ map: mesh, metalness: .6, roughness: .45 });
    const cyl = (r, h, mat, open) => { const m = new T3.Mesh(new T3.CylinderGeometry(r, r, h, 72, 1, open), mat); m.rotation.x = Math.PI / 2; return m; };
    const can = x => {
      const g = new T3.Group(); g.position.set(x, 1, .8);
      const foot = cyl(8.25, 1, plastic); foot.position.z = .5; g.add(foot);
      const body = cyl(8, 11.6, metal, true); body.position.z = 1 + 5.8; g.add(body);
      const lip = new T3.Mesh(new T3.TorusGeometry(7.65, .42, 16, 72), metal); lip.position.z = 12.55; g.add(lip);
      const face = new T3.Mesh(new T3.CircleGeometry(7.5, 72), grille); face.position.z = 12.1; g.add(face);
      const inner = new T3.Mesh(new T3.RingGeometry(7.2, 7.6, 72), new T3.MeshStandardMaterial({ color: 0x0e0f10, roughness: .8 })); inner.position.z = 12.15; g.add(inner);
      board.add(g);
    };
    can(-13); can(13);
    // the crystal oscillator (HC-49/S): a rounded metal can lying between the transducers
    const xs = new T3.Shape(), L = 5.5, Rr = 2.3;
    xs.moveTo(-L + Rr, -Rr); xs.lineTo(L - Rr, -Rr); xs.absarc(L - Rr, 0, Rr, -Math.PI / 2, Math.PI / 2, false); xs.lineTo(-L + Rr, Rr); xs.absarc(-L + Rr, 0, Rr, Math.PI / 2, Math.PI * 1.5, false);
    const xtal = new T3.Mesh(new T3.ExtrudeGeometry(xs, { depth: 3, bevelEnabled: true, bevelSize: .35, bevelThickness: .35, bevelSegments: 4, curveSegments: 24 }), metal);
    xtal.position.set(0, 6.4, .8 + .35); board.add(xtal);
    // the four header pins and their plastic spacer, sticking out of the bottom edge
    const spacer = new T3.Mesh(new T3.BoxGeometry(10.16, 2.5, 2.5), plastic); spacer.position.set(0, -11.25, 0); board.add(spacer);
    const pinMat = new T3.MeshStandardMaterial({ color: 0xd8c27a, metalness: 1, roughness: .3 });
    for (let k = 0; k < 4; k++) { const p = new T3.Mesh(new T3.BoxGeometry(.64, 8.6, .64), pinMat); p.position.set((k - 1.5) * 2.54, -13.6, 0); board.add(p); }
    // chips on the back
    [[-9, 2, 6, 4], [3, 2, 6, 4], [12.5, -3, 4.5, 4]].forEach(([x, y, w, h]) => {
      const c = new T3.Mesh(new T3.BoxGeometry(w, h, 1.5), plastic); c.position.set(x, y, -.8 - .75); board.add(c);
      for (let k = 0; k < Math.round(w / 1.27); k++) [-1, 1].forEach(s => { const l = new T3.Mesh(new T3.BoxGeometry(.4, .9, .3), metal); l.position.set(x - w / 2 + .6 + k * 1.27, y + s * (h / 2 + .35), -.95); board.add(l); });
    });
    const pivot = new T3.Group(); pivot.add(board); board.position.set(0, 1.5, -6); scene.add(pivot);
    // a soft contact shadow on the floor
    const shTex = tex(256, 256, (g, w, h) => { const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); r.addColorStop(0, "rgba(0,0,0,.32)"); r.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = r; g.fillRect(0, 0, w, h); });
    shTex.encoding = T3.LinearEncoding;
    const shadow = new T3.Mesh(new T3.PlaneGeometry(70, 26), new T3.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = -24; scene.add(shadow);

    // hotspots follow points on the model
    const spots = { t: new T3.Vector3(-21, 1, 9), r: new T3.Vector3(21, 1, 9), x: new T3.Vector3(2.5, 8.6, 3.5), p: new T3.Vector3(0, -17.8, 0) };
    const spotEls = $$(".hs");
    const nrm = new T3.Vector3(), tmp = new T3.Vector3(), camDir = new T3.Vector3();

    // turning: drag to spin, it settles back into a gentle sway
    let yaw = -.55, pitch = .32, vy = 0, vp = 0, drag = null, idle = 0, t0 = performance.now(), dirty = true;
    const still = reduce.matches;
    cvs.addEventListener("pointerdown", e => { drag = [e.clientX, e.clientY]; cvs.setPointerCapture(e.pointerId); stage.classList.add("grabbing"); $("#stageHint").style.opacity = 0; });
    cvs.addEventListener("pointermove", e => {
      if (!drag) return;
      const dx = e.clientX - drag[0], dy = e.clientY - drag[1]; drag = [e.clientX, e.clientY];
      vy = dx * .012; vp = dy * .008; yaw += vy; pitch = Math.max(-.9, Math.min(1.1, pitch + vp)); idle = 0; dirty = true;
    });
    const up = () => { drag = null; stage.classList.remove("grabbing"); };
    cvs.addEventListener("pointerup", up); cvs.addEventListener("pointercancel", up);

    let W3 = 0, H3 = 0;
    const size = () => {
      const r = stage.getBoundingClientRect(); W3 = r.width; H3 = r.height;
      renderer.setSize(W3, H3, false); camera.aspect = W3 / H3;
      camera.position.z = W3 / H3 < .9 ? 185 : 140;                // phones: step back a little
      camera.updateProjectionMatrix(); dirty = true;
    };
    new ResizeObserver(size).observe(stage); size();
    let onScreen = true;
    new IntersectionObserver(es => { onScreen = es[0].isIntersecting; if (onScreen) loop(); }).observe(stage);
    let running = false;
    function loop() {
      if (running) return; running = true;
      const step = now => {
        if (!onScreen) { running = false; return; }
        const dt = Math.min(.05, (now - t0) / 1000); t0 = now; idle += dt;
        if (!drag) {
          yaw += vy; pitch = Math.max(-.9, Math.min(1.1, pitch + vp)); vy *= .94; vp *= .9;
          if (!still && idle > 2.5) { yaw += (-.55 + Math.sin(now / 2600) * .45 - yaw) * .012; pitch += (.32 - pitch) * .015; }
          if (Math.abs(vy) > 1e-4 || Math.abs(vp) > 1e-4 || (!still && idle > 2.5)) dirty = true;
        }
        if (dirty) {
          pivot.rotation.set(pitch, yaw, 0); pivot.position.y = still ? 0 : Math.sin(now / 1800) * .6;
          renderer.render(scene, camera);
          pivot.updateMatrixWorld();
          nrm.set(0, 0, 1).transformDirection(board.matrixWorld);
          camera.getWorldDirection(camDir);
          const facing = -nrm.dot(camDir);
          spotEls.forEach(el => {
            const k = el.dataset.hs;
            tmp.copy(spots[k]).applyMatrix4(board.matrixWorld).project(camera);
            const x = (tmp.x + 1) / 2 * W3, y = (1 - tmp.y) / 2 * H3;
            const show = k === "p" ? 1 : Math.max(0, Math.min(1, (facing - .25) * 3));
            el.style.opacity = W3 < 380 && k === "x" ? 0 : show;
            const right = k === "r" || k === "x" ? true : k === "t" ? false : x > W3 * .5;
            el.style.transform = `translate(${right ? x - 5 : x - el.offsetWidth + 5}px, ${y - el.offsetHeight / 2}px)`;
            el.style.flexDirection = right ? "row" : "row-reverse";
            el.style.padding = right ? "5px 11px 5px 6px" : "5px 6px 5px 11px";
          });
          dirty = still ? false : dirty;
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
    loop();
  }

  /* ---------- how the sensor measures: time the echo, get the distance, get the fill ---------- */
  {
    const DEPTH = 1.2, LID = 66, FLOOR = 262, SOUND = 343;     // an example bin 1.2 m deep, drawn from y=66 (sensor) to y=262 (floor)
    const fillIn = $("#eFill");
    const upd = () => {
      const f = +fillIn.value / 100;
      const dist = Math.max(.02, DEPTH * (1 - f));
      const top = LID + (FLOOR - LID) * (dist / DEPTH);
      $("#oFill").textContent = Math.round(f * 100) + "%";
      $("#eTime").textContent = (2 * dist / SOUND * 1000).toFixed(1) + " ms";
      $("#eDist").textContent = dist.toFixed(2) + " m";
      $("#ePct").textContent = Math.round((1 - dist / DEPTH) * 100) + "%";
      const w = $("#echoWaste"); w.setAttribute("y", top); w.setAttribute("height", FLOOR + 10 - top);
      $("#echoTop").setAttribute("d", `M40 ${top + 2} q 20 -7 40 -2 t 40 -1 t 40 -3 t 40 2 V ${top + 6} H 40 z`);
      $("#echoLine").setAttribute("y2", top - 2);
      $("#echoArrA").setAttribute("d", `M206 72 l4 -6 l4 6 z`);
      $("#echoArrB").setAttribute("d", `M206 ${top - 8} l4 6 l4 -6 z`);
      const span = top - LID - 4, n = Math.max(1, Math.min(4, Math.floor(span / 26)));
      $("#echoWaves").innerHTML = Array.from({ length: n }, (_, k) => {
        const y = LID + 10 + (span - 12) * (k + .5) / n, half = 10 + (y - LID) * .27;
        return `<path d="M${120 - half} ${y} Q 120 ${y + 9} ${120 + half} ${y}" style="animation-delay:${(k * .35).toFixed(2)}s"/>`;
      }).join("");
    };
    fillIn.addEventListener("input", upd); upd();
  }

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
