const MODEL = JSON.parse(document.getElementById("model-json").textContent);
const PAY = JSON.parse(document.getElementById("sample-json").textContent);
const FACTS = JSON.parse(document.getElementById("facts-json").textContent);
const CALIB = JSON.parse(document.getElementById("calib-json").textContent);

const RATES = MODEL.decayRates, ENTS = MODEL.entities, DAY = 86400;
const NR = RATES.length, LAG = MODEL.labelLagDays;
const COST = { fee: 1200, review: 40, falseBlock: 970, catch: 0.9, usd: 83 };
const WARMUP = 0.35;
const idx = {}; MODEL.features.forEach((f, i) => idx[f] = i);
const plainIdx = MODEL.plainFeatures.map(f => idx[f]);
const NP = plainIdx.length;
const SA = idx.amount, SL = idx.amount_log, SF = idx.amount_fraction, SH = idx.hour_of_day;
const SLOT = ENTS.map(e => ({
  count: idx[e + "_count"], mean: idx[e + "_mean_amount"], age: idx[e + "_age"],
  gap: idx[e + "_gap"], avm: idx[e + "_amount_vs_mean"],
  act: MODEL.decayNames.map(w => idx[e + "_activity_" + w]),
  con: MODEL.decayNames.map(w => idx[e + "_contagion_" + w]),
}));

const el = id => document.getElementById(id);
const fmtInt = v => Math.round(v).toLocaleString();
const money = v => "₹" + (v / 1e6).toFixed(2) + "M";
const esc = v => String(v).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const chart = (w, h, body) => `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img" preserveAspectRatio="xMidYMid meet">${body}</svg>`;

function unb64(s, T) {
  const bin = atob(s), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new T(u.buffer);
}

function evalTrees(trees, v) {
  let s = 0;
  for (const t of trees) {
    let n = t;
    while (n.v === undefined) {
      const x = v[n.f];
      n = Number.isNaN(x) ? (n.d ? n.l : n.r) : (x <= n.t ? n.l : n.r);
    }
    s += n.v;
  }
  return 1 / (1 + Math.exp(-s));
}

/* ---------------------------------------------------------------- routing */
const TABS = ["home", "data", "experiments", "model", "architecture"];
let current = null;
const onShow = {};

function show(tab) {
  if (!TABS.includes(tab)) tab = "home";
  if (tab === current) return;
  current = tab;
  TABS.forEach(t => { el("page-" + t).hidden = t !== tab; });
  document.querySelectorAll(".tabs a").forEach(a =>
    a.setAttribute("aria-current", a.dataset.tab === tab ? "page" : "false"));
  document.title = tab === "home" ? "R-Zero" : "R-Zero · " + tab[0].toUpperCase() + tab.slice(1);
  if (onShow[tab]) { const fn = onShow[tab]; delete onShow[tab]; fn(); }
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
}

window.addEventListener("hashchange", () => show(location.hash.slice(1)));
document.querySelectorAll(".tabs a").forEach(a => a.addEventListener("click", e => {
  e.preventDefault(); location.hash = a.dataset.tab;
  if (location.hash.slice(1) === current) show(a.dataset.tab);
}));

/* ------------------------------------------------------- 1. branching sim */
function branching(r0) {
  let rng = 20260903;
  const rand = () => (rng = (rng * 1664525 + 1013904223) >>> 0) / 4294967296;
  const events = [{ t: 0, g: 0 }];
  let frontier = [{ t: 0, g: 0 }], gens = 0;
  while (frontier.length && gens < 24 && events.length < 900) {
    const next = [];
    for (const p of frontier) {
      let n = 0, L = Math.exp(-r0), q = rand();
      while (q > L && n < 40) { q *= rand(); n++; }
      for (let k = 0; k < n; k++) {
        const child = { t: p.t - Math.log(1 - rand()) * 3.3, g: p.g + 1 };
        if (child.t < 260) { next.push(child); events.push(child); }
      }
    }
    frontier = next;
    if (next.length) gens = next[0].g;
  }
  return { events, gens, exploded: events.length >= 900 };
}

function drawBranching(r0) {
  const W = 460, H = 150, L = 8, R = 8, T = 14, B = 26;
  const res = branching(r0);
  const span = Math.max(...res.events.map(e => e.t), 30);
  const maxG = Math.max(...res.events.map(e => e.g), 1);
  const X = t => L + (t / span) * (W - L - R);
  const Y = g => T + (g / Math.max(maxG, 4)) * (H - T - B);
  const dots = res.events.map(e => {
    const o = clamp(1 - e.g / (maxG + 2), .3, 1);
    return `<circle cx="${X(e.t).toFixed(1)}" cy="${Y(e.g).toFixed(1)}" r="${e.g ? 3 : 5}"
      fill="${e.g ? "var(--r2)" : "var(--brand)"}" opacity="${o.toFixed(2)}"/>`;
  }).join("");
  el("br-chart").innerHTML = chart(W, H, `
    <line x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}" stroke="var(--edge)"/>
    ${dots}
    <text x="${L}" y="${H - B + 16}" font-size="10" fill="var(--ink-3)">the first fraud</text>
    <text x="${W - R}" y="${H - B + 16}" text-anchor="end" font-size="10" fill="var(--ink-3)">${span.toFixed(0)} minutes later</text>`);
  el("br-total").textContent = res.exploded ? "900+" : fmtInt(res.events.length);
  el("br-gen").textContent = res.exploded ? "—" : res.gens;
  const st = el("br-state");
  st.textContent = r0 >= 1 ? "runs away" : "contained";
  st.className = r0 >= 1 ? "hot" : "good";
}

function initBranching() {
  const r = el("br-r0");
  const sync = () => {
    const r0 = Number(r.value) / 100;
    el("br-v").textContent = r0.toFixed(3) + (Math.abs(r0 - 0.438) < 0.006 ? "  (card fraud)" : "");
    drawBranching(r0);
  };
  r.addEventListener("input", sync);
  el("br-run").addEventListener("click", () => { sync(); });
  sync();
}

/* ------------------------------------------------------ 2. decay, live O(1) */
function initDecay() {
  const acc = [0, 0, 0];
  let ops = 0, last = performance.now(), history = [];
  const halves = [1 / 24, 1, 7];
  const rates = halves.map(h => Math.log(2) / h);
  const SPEED = 1 / 60;

  function step(now) {
    const dt = ((now - last) / 1000) * SPEED;
    last = now;
    for (let k = 0; k < 3; k++) acc[k] *= Math.exp(-rates[k] * dt);
    history.push(acc[2]);
    if (history.length > 150) history.shift();
    el("dec-1h").textContent = acc[0].toFixed(3);
    el("dec-1d").textContent = acc[1].toFixed(3);
    el("dec-7d").textContent = acc[2].toFixed(3);
    el("dec-ops").textContent = fmtInt(ops);
    draw();
    if (el("page-home") && !el("page-home").hidden) requestAnimationFrame(step);
    else setTimeout(() => requestAnimationFrame(step), 400);
  }

  function draw() {
    const W = 460, H = 120, T = 10, B = 20, L = 6, R = 6;
    const max = Math.max(...history, 1.2);
    const n = history.length;
    const X = i => L + (i / Math.max(n - 1, 1)) * (W - L - R);
    const Y = v => T + (1 - v / max) * (H - T - B);
    const line = history.map((v, i) => (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1)).join(" ");
    const bars = [0, 1, 2].map((k, i) => {
      const bw = 26, x = W - R - 10 - (2 - i) * (bw + 9);
      const h = clamp(acc[k] / max, 0, 1) * (H - T - B);
      return `<rect x="${x}" y="${H - B - h}" width="${bw}" height="${h.toFixed(1)}"
        fill="var(--r2)" opacity="${0.35 + 0.3 * i}" rx="3"/>
        <text x="${x + bw / 2}" y="${H - B + 14}" text-anchor="middle" font-size="9.5" fill="var(--ink-3)">${["1h","1d","7d"][k]}</text>`;
    }).join("");
    el("dec-chart").innerHTML = chart(W, H, `
      <line x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}" stroke="var(--edge)"/>
      <path d="${line}" fill="none" stroke="var(--r2)" stroke-width="2"/>${bars}`);
  }

  el("dec-add").addEventListener("click", () => {
    for (let k = 0; k < 3; k++) acc[k] += 0.481;
    ops += 6;
  });
  el("dec-reset").addEventListener("click", () => {
    acc[0] = acc[1] = acc[2] = 0; ops = 0; history = [];
  });
  requestAnimationFrame(step);
}

/* ------------------------------------------------ 3. popularity weighting */
function initPopularity() {
  const r = el("pw-r");
  const EG = [[1, "a device seen once"], [3, "a device seen three times"],
              [332, "a billing address"], [13553, "a card"],
              [172786, "gmail.com in this dataset"]];
  const sync = () => {
    const f = Number(r.value) / 1000;
    const d = Math.round(Math.pow(10, f * Math.log10(400000)) );
    const w = 1 / Math.log(d + 5);
    el("pw-d").textContent = fmtInt(d);
    el("pw-w").textContent = w.toFixed(3);
    let best = EG[0];
    for (const e of EG) if (Math.abs(Math.log(e[0]) - Math.log(d)) < Math.abs(Math.log(best[0]) - Math.log(d))) best = e;
    el("pw-eg").textContent = "≈ " + best[1];
    const W = 460, H = 128, L = 40, R = 12, T = 12, B = 26;
    const X = v => L + (Math.log10(Math.max(v, 1)) / Math.log10(400000)) * (W - L - R);
    const Y = v => T + (1 - v / 0.72) * (H - T - B);
    let path = "";
    for (let i = 0; i <= 120; i++) {
      const dd = Math.pow(10, (i / 120) * Math.log10(400000));
      path += (i ? "L" : "M") + X(dd).toFixed(1) + " " + Y(1 / Math.log(dd + 5)).toFixed(1) + " ";
    }
    const ticks = [1, 10, 1000, 100000].map(v =>
      `<text x="${X(v)}" y="${H - B + 15}" text-anchor="middle" font-size="9.5" fill="var(--ink-3)">${v >= 1000 ? (v / 1000) + "k" : v}</text>`).join("");
    el("pw-chart").innerHTML = chart(W, H, `
      ${[0, .5, 1].map(f2 => { const y = T + f2 * (H - T - B);
        return `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="var(--edge-2)"/>
        <text x="${L - 7}" y="${y + 4}" text-anchor="end" font-size="9.5" fill="var(--ink-3)">${((1 - f2) * 0.72).toFixed(1)}</text>`; }).join("")}
      <path d="${path}" fill="none" stroke="var(--brand)" stroke-width="2"/>
      <line x1="${X(d)}" y1="${T}" x2="${X(d)}" y2="${H - B}" stroke="var(--r2)" stroke-dasharray="3 3"/>
      <circle cx="${X(d)}" cy="${Y(w)}" r="5" fill="var(--r2)"/>
      <line x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}" stroke="var(--edge)"/>${ticks}
      <text x="${W - R}" y="${H - 3}" text-anchor="end" font-size="9.5" fill="var(--ink-3)">people sharing the attribute</text>`);
  };
  r.addEventListener("input", sync);
  sync();
}

/* -------------------------------------------------------- 4. identity graph */
function initGraph() {
  const W = 460, H = 210;
  const cards = Array.from({ length: 8 }, (_, i) => ({
    id: "c" + i, x: 60 + i * 47, y: 44, label: "card " + (9143 + i * 64),
  }));
  const hubs = [
    { id: "dev", x: 150, y: 158, label: "Trident/7.0", kind: "device" },
    { id: "addr", x: 310, y: 158, label: "address 881", kind: "address" },
  ];
  const link = cards.flatMap(c => hubs.map(h => ({ a: c, b: h })));
  const paint = (active) => {
    const on = id => !active || active === id ||
      (active === "dev" || active === "addr" ? true : false);
    const edges = link.map(l => {
      const lit = !active || l.b.id === active || l.a.id === active;
      return `<line x1="${l.a.x}" y1="${l.a.y + 9}" x2="${l.b.x}" y2="${l.b.y - 11}"
        stroke="${lit ? "var(--r2)" : "var(--edge)"}" stroke-width="${lit ? 1.4 : 1}"
        opacity="${lit ? .8 : .35}"/>`;
    }).join("");
    const cardNodes = cards.map(c => {
      const lit = !active || active === "dev" || active === "addr" || active === c.id;
      return `<g class="gnode" data-id="${c.id}">
        <rect x="${c.x - 17}" y="${c.y - 9}" width="34" height="19" rx="6"
          fill="${lit ? "var(--r2)" : "var(--card)"}" stroke="${lit ? "var(--r2)" : "var(--edge)"}"/>
        <text x="${c.x}" y="${c.y + 4}" text-anchor="middle" font-size="9"
          fill="${lit ? "#fff" : "var(--ink-3)"}" font-weight="600">card</text></g>`;
    }).join("");
    const hubNodes = hubs.map(h => {
      const lit = !active || active === h.id;
      return `<g class="gnode" data-id="${h.id}">
        <rect x="${h.x - 52}" y="${h.y - 11}" width="104" height="24" rx="8"
          fill="${lit ? "var(--brand)" : "var(--card)"}" stroke="${lit ? "var(--brand)" : "var(--edge)"}"/>
        <text x="${h.x}" y="${h.y + 5}" text-anchor="middle" font-size="10.5"
          fill="${lit ? "var(--on-brand)" : "var(--ink-3)"}" font-weight="600">${h.label}</text></g>`;
    }).join("");
    el("graph-chart").innerHTML = chart(W, H, `
      <text x="8" y="16" font-size="10" fill="var(--ink-3)">eight cards, none with any history</text>
      ${edges}${cardNodes}${hubNodes}
      <text x="8" y="${H - 6}" font-size="10" fill="var(--ink-3)">two identities they all share</text>`);
    el("graph-chart").querySelectorAll(".gnode").forEach(g => {
      g.style.cursor = "pointer";
      g.addEventListener("mouseenter", () => set(g.dataset.id));
      g.addEventListener("click", () => set(g.dataset.id));
    });
  };
  const set = id => {
    paint(id);
    const h = hubs.find(x => x.id === id);
    el("gr-name").textContent = h ? h.label : "a single card";
    el("gr-note").textContent = h
      ? `every one of these eight cards passed through this ${h.kind}`
      : "on its own: no history, small amount, nothing to flag";
  };
  el("graph-chart").addEventListener("mouseleave", () => { paint(null); set(null); });
  paint(null);
}

/* ---------------------------------------------------- 5. confirmation lag */
function initLag() {
  const pts = Object.entries(FACTS.leak.lag).map(([k, v]) => [Number(k), v]).sort((a, b) => a[0] - b[0]);
  const none = FACTS.leak.none;
  const interp = d => {
    if (d <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++)
      if (d <= pts[i][0]) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
        return y0 + (y1 - y0) * (d - x0) / (x1 - x0);
      }
    return pts[pts.length - 1][1];
  };
  const r = el("lag-r");
  const sync = () => {
    const d = Number(r.value);
    const pr = interp(d);
    el("lag-v").textContent = d === 0 ? "none (cheating)" : d + (d === 1 ? " day" : " days");
    el("lag-pr").textContent = pr.toFixed(3);
    el("lag-note").textContent = d === 0 ? "a laboratory result, not a system"
      : d <= 7 ? "what a real chargeback feed gives you"
      : d <= 21 ? "a slow dispute cycle, still ahead"
      : "degraded, but still beating no contagion";
    const W = 460, H = 140, L = 40, R = 14, T = 14, B = 30;
    const X = v => L + (v / 45) * (W - L - R);
    const Y = v => T + (1 - (v - 0.15) / 0.55) * (H - T - B);
    let path = "";
    for (let i = 0; i <= 90; i++) { const dd = i / 2; path += (i ? "L" : "M") + X(dd).toFixed(1) + " " + Y(interp(dd)).toFixed(1) + " "; }
    const ticks = [0, 7, 21, 45].map(v =>
      `<text x="${X(v)}" y="${H - B + 15}" text-anchor="middle" font-size="9.5" fill="var(--ink-3)">${v}d</text>`).join("");
    el("lag-chart").innerHTML = chart(W, H, `
      ${[0, .5, 1].map(f => { const y = T + f * (H - T - B);
        return `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="var(--edge-2)"/>
        <text x="${L - 7}" y="${y + 4}" text-anchor="end" font-size="9.5" fill="var(--ink-3)">${(0.70 - f * 0.55).toFixed(2)}</text>`; }).join("")}
      <line x1="${L}" y1="${Y(none)}" x2="${W - R}" y2="${Y(none)}" stroke="var(--ink-3)" stroke-dasharray="4 3"/>
      <text x="${W - R - 2}" y="${Y(none) - 6}" text-anchor="end" font-size="9.5" fill="var(--ink-3)">no contagion at all</text>
      <path d="${path}" fill="none" stroke="var(--r2)" stroke-width="2.2"/>
      <line x1="${X(7)}" y1="${T}" x2="${X(7)}" y2="${H - B}" stroke="var(--brand)" stroke-dasharray="3 3" opacity=".6"/>
      <line x1="${X(d)}" y1="${T}" x2="${X(d)}" y2="${H - B}" stroke="var(--r2)" stroke-dasharray="3 3"/>
      <circle cx="${X(d)}" cy="${Y(pr)}" r="5" fill="var(--r2)"/>
      <line x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}" stroke="var(--edge)"/>${ticks}
      <text x="${W - R}" y="${H - 3}" text-anchor="end" font-size="9.5" fill="var(--ink-3)">days before a fraud reaches the model</text>`);
  };
  r.addEventListener("input", sync);
  sync();
}

/* --------------------------------------------------- 6. the calibration dial */
const CAL = (() => {
  const edges = [];
  for (let i = 0; i <= CALIB.bins; i++) edges.push(CALIB.lo + (CALIB.hi - CALIB.lo) * i / CALIB.bins);
  const tail = (h, thr) => {
    let k = 0; while (k < CALIB.bins && edges[k + 1] <= thr) k++;
    let s = 0; for (let i = k; i < CALIB.bins; i++) s += h[i];
    return s;
  };
  return {
    rates(thr) {
      const c = CALIB.customer, t = CALIB.txn;
      return {
        fa: tail(c.clean, thr) / c.n_clean,
        catch: tail(c.fraud, thr) / c.n_fraud,
        txn: tail(t.clean, thr) / t.n_clean,
      };
    },
    edges,
  };
})();

function initCalibrationOld() {
  const r = el("cal-r");
  const toB = v => CALIB.lo + (CALIB.hi - CALIB.lo) * (v / 1000);
  const toV = b => Math.round(1000 * (b - CALIB.lo) / (CALIB.hi - CALIB.lo));
  const sync = () => {
    const b = toB(Number(r.value)), q = CAL.rates(b);
    el("cal-b").textContent = b.toFixed(2);
    el("cal-fa").textContent = (100 * q.fa).toFixed(2) + "%";
    el("cal-catch").textContent = (100 * q.catch).toFixed(1) + "%";
    el("cal-txn").textContent = (100 * q.txn).toFixed(2) + "%";
    const W = 460, H = 158, L = 34, R = 14, T = 14, B = 36;
    const c = CALIB.customer;
    const maxc = Math.max(...c.clean), maxf = Math.max(...c.fraud);
    const X = i => L + (i / CALIB.bins) * (W - L - R);
    const bw = (W - L - R) / CALIB.bins;
    let bars = "";
    for (let i = 0; i < CALIB.bins; i++) {
      const hc = (c.clean[i] / maxc) * (H - T - B) * 0.92;
      const hf = (c.fraud[i] / maxf) * (H - T - B) * 0.55;
      const lit = CAL.edges[i] >= b;
      bars += `<rect x="${X(i)}" y="${H - B - hc}" width="${bw + .4}" height="${hc.toFixed(1)}"
        fill="${lit ? "var(--r2)" : "var(--brand)"}" opacity="${lit ? .8 : .3}"/>`;
      bars += `<rect x="${X(i)}" y="${H - B - hf}" width="${bw + .4}" height="${hf.toFixed(1)}"
        fill="var(--ink)" opacity=".22"/>`;
    }
    const bx = L + ((b - CALIB.lo) / (CALIB.hi - CALIB.lo)) * (W - L - R);
    el("cal-chart").innerHTML = chart(W, H, `${bars}
      <line x1="${bx}" y1="${T - 4}" x2="${bx}" y2="${H - B}" stroke="var(--ink)" stroke-width="1.6"/>
      <text x="${bx + 5}" y="${T + 5}" font-size="10" fill="var(--ink)" font-weight="600">act &#8594;</text>
      <line x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}" stroke="var(--edge)"/>
      <text x="${L}" y="${H - B + 14}" font-size="9.5" fill="var(--ink-3)">weak evidence</text>
      <text x="${W - R}" y="${H - B + 14}" text-anchor="end" font-size="9.5" fill="var(--ink-3)">overwhelming</text>
      <rect x="${L}" y="${H - 12}" width="8" height="8" rx="2" fill="var(--brand)" opacity=".55"/>
      <text x="${L + 12}" y="${H - 4}" font-size="9.5" fill="var(--ink-3)">clean customers</text>
      <rect x="${L + 100}" y="${H - 12}" width="8" height="8" rx="2" fill="var(--ink)" opacity=".3"/>
      <text x="${L + 112}" y="${H - 4}" font-size="9.5" fill="var(--ink-3)">fraudulent customers</text>
      <rect x="${L + 224}" y="${H - 12}" width="8" height="8" rx="2" fill="var(--r2)" opacity=".8"/>
      <text x="${L + 236}" y="${H - 4}" font-size="9.5" fill="var(--ink-3)">stopped at this setting</text>`);
    el("cal-theory").classList.toggle("on", Math.abs(b - CALIB.closed_form) < 0.09);
    el("cal-fitted").classList.toggle("on", Math.abs(b - CALIB.calibrated) < 0.09);
  };
  r.addEventListener("input", sync);
  el("cal-theory").addEventListener("click", () => { r.value = toV(CALIB.closed_form); sync(); });
  el("cal-fitted").addEventListener("click", () => { r.value = toV(CALIB.calibrated); sync(); });
  r.value = toV(CALIB.calibrated);
  sync();
}


/* ------------------------------------------- 6. review latency, the real dial */
function initLatency() {
  const S = FACTS.desk.latency_sweep;
  const LAB = ["15 min", "1 hour", "4 hours", "12 hours", "1 day", "3 days", "1 week", "never"];
  const r = el("lt-r");
  const sync = () => {
    const i = Number(r.value), row = S[i];
    el("lt-v").textContent = LAB[i] + (i === 7 ? " (an automatic block)" : "");
    el("lt-txn").textContent = (100 * row.txn).toFixed(3) + "%";
    el("lt-worst").textContent = fmtInt(row.worst);
    el("lt-rec").textContent = (100 * row.recall).toFixed(1) + "%";
    const W = 460, H = 168, L = 46, R = 16, T = 16, B = 40;
    const maxT = Math.max(...S.map(s => s.txn));
    const X = k => L + (k / (S.length - 1)) * (W - L - R);
    const Y = v => T + (1 - Math.sqrt(v / maxT)) * (H - T - B);
    const bars = S.map((s, k) => {
      const h = (H - B) - Y(s.txn);
      const lit = k === i;
      return `<rect x="${(X(k) - 15).toFixed(1)}" y="${Y(s.txn).toFixed(1)}" width="30"
        height="${Math.max(h, 1.5).toFixed(1)}" rx="4"
        fill="${lit ? "var(--r2)" : "var(--brand)"}" opacity="${lit ? .95 : .32}"/>`;
    }).join("");
    const ticks = S.map((s, k) =>
      `<text x="${X(k)}" y="${H - B + 15}" text-anchor="middle" font-size="9"
        fill="${k === i ? "var(--r2)" : "var(--ink-3)"}" font-weight="${k === i ? 600 : 400}">${LAB[k]}</text>`).join("");
    el("lt-chart").innerHTML = chart(W, H, `
      <line x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}" stroke="var(--edge)"/>
      ${bars}${ticks}
      <text x="${L - 8}" y="${T + 8}" text-anchor="end" font-size="9.5" fill="var(--ink-3)">${(100 * maxT).toFixed(1)}%</text>
      <text x="${L - 8}" y="${H - B}" text-anchor="end" font-size="9.5" fill="var(--ink-3)">0</text>
      <text x="${L}" y="${H - 4}" font-size="10" fill="var(--ink-3)">innocent payments blocked, by how long a mistake stands</text>`);
  };
  r.addEventListener("input", sync);
  sync();
}

/* ------------------------------------------------------------- 7. one tree */
let SHOWCASE = null;

function initTree() {
  let ti = 0, ri = 0;
  const draw = () => {
    if (!SHOWCASE || !SHOWCASE.length) return;
    const row = SHOWCASE[ri % SHOWCASE.length];
    const tree = MODEL.trees[ti % MODEL.trees.length];
    const path = [];
    let n = tree;
    while (n.v === undefined) {
      const x = row.v[n.f], goLeft = !(x > n.t);
      path.push({ f: MODEL.features[n.f], t: n.t, x, goLeft });
      n = goLeft ? n.l : n.r;
    }
    const W = 460, rowH = 30, H = 26 + path.length * rowH + 34;
    let body = `<text x="4" y="12" font-size="10" fill="var(--ink-3)">tree ${(ti % MODEL.trees.length) + 1} of ${MODEL.trees.length} &#183; transaction ${row.i}</text>`;
    path.forEach((p, k) => {
      const y = 26 + k * rowH;
      const val = p.x < 0 ? "unknown" : p.x >= 1000 ? p.x.toFixed(0) : p.x >= 1 ? p.x.toFixed(2) : p.x.toFixed(4);
      body += `<rect x="${4 + k * 9}" y="${y}" width="${W - 8 - k * 9}" height="${rowH - 6}" rx="6"
        fill="var(--card)" stroke="var(--edge-2)"/>
        <text x="${12 + k * 9}" y="${y + 16}" font-size="10.5" font-family="IBM Plex Mono, monospace" fill="var(--ink-2)">${esc(p.f)}</text>
        <text x="${W - 12}" y="${y + 16}" text-anchor="end" font-size="10.5" font-family="IBM Plex Mono, monospace"
          fill="${p.goLeft ? "var(--brand)" : "var(--r2)"}" font-weight="600">${val} ${p.goLeft ? "&#8804;" : "&gt;"} ${p.t >= 1000 ? p.t.toFixed(0) : p.t.toFixed(3)}</text>`;
    });
    const y = 26 + path.length * rowH;
    body += `<rect x="${4 + path.length * 9}" y="${y}" width="${W - 8 - path.length * 9}" height="24" rx="6"
      fill="var(--brand-soft)"/>
      <text x="${12 + path.length * 9}" y="${y + 16}" font-size="10.5" fill="var(--brand)" font-weight="600">leaf</text>
      <text x="${W - 12}" y="${y + 16}" text-anchor="end" font-size="11" font-family="IBM Plex Mono, monospace"
        fill="var(--brand)" font-weight="600">${n.v >= 0 ? "+" : ""}${n.v.toFixed(4)}</text>`;
    el("tree-chart").innerHTML = chart(W, H, body);
    el("tree-leaf").textContent = (n.v >= 0 ? "+" : "") + n.v.toFixed(4);
    el("tree-sum").textContent = row.score.toFixed(3);
  };
  el("tree-next").addEventListener("click", () => { ri++; draw(); });
  el("tree-tree").addEventListener("click", () => { ti += 7; draw(); });
  draw();
  return draw;
}

/* ---------------------------------------------------------- 8. the frontier */
function initPareto() {
  const P = FACTS.pareto;
  const W = 460, H = 190, L = 46, R = 16, T = 16, B = 34;
  const maxFB = Math.max(...P.map(p => p.fb)) * 1.05;
  const lo = Math.min(...P.map(p => p.net)) * 0.96, hi = Math.max(...P.map(p => p.net)) * 1.02;
  const X = v => L + (v / maxFB) * (W - L - R);
  const Y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  let pick = P.reduce((a, p, i) => P[a].net > p.net ? a : i, 0);
  const paint = () => {
    const line = P.map((p, i) => (i ? "L" : "M") + X(p.fb).toFixed(1) + " " + Y(p.net).toFixed(1)).join(" ");
    const dots = P.map((p, i) => `<circle class="pnode" data-i="${i}" cx="${X(p.fb).toFixed(1)}" cy="${Y(p.net).toFixed(1)}"
      r="${i === pick ? 6 : 3.4}" fill="${i === pick ? "var(--r2)" : "var(--brand)"}"
      opacity="${i === pick ? 1 : .55}" style="cursor:pointer"/>`).join("");
    el("pareto-chart").innerHTML = chart(W, H, `
      ${[0, .5, 1].map(f => { const y = T + f * (H - T - B);
        return `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="var(--edge-2)"/>
        <text x="${L - 7}" y="${y + 4}" text-anchor="end" font-size="9.5" fill="var(--ink-3)">&#8377;${((hi - f * (hi - lo)) / 1e6).toFixed(0)}M</text>`; }).join("")}
      <path d="${line}" fill="none" stroke="var(--brand)" stroke-width="1.6" opacity=".45"/>${dots}
      <line x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}" stroke="var(--edge)"/>
      <text x="${L}" y="${H - B + 15}" font-size="9.5" fill="var(--ink-3)">block nobody</text>
      <text x="${W - R}" y="${H - B + 15}" text-anchor="end" font-size="9.5" fill="var(--ink-3)">${fmtInt(maxFB)} wrongly blocked</text>
      <text x="${W - R}" y="${H - 3}" text-anchor="end" font-size="9.5" fill="var(--ink-3)">drag along the frontier</text>`);
    el("pareto-chart").querySelectorAll(".pnode").forEach(c => {
      const go = () => { pick = Number(c.dataset.i); paint(); };
      c.addEventListener("mouseenter", go); c.addEventListener("click", go);
    });
    const p = P[pick];
    el("pa-net").textContent = money(p.net);
    el("pa-fb").textContent = fmtInt(p.fb);
    el("pa-rec").textContent = (100 * p.net / FACTS.full.exposure).toFixed(0) + "%";
  };
  paint();
}

/* ------------------------------------------------------- 9. the review queue */
function initQueue() {
  const grid = el("q-grid");
  grid.innerHTML = Array.from({ length: 100 }, () => "<i></i>").join("");
  const cells = [...grid.children];
  const set = (hits, label) => {
    const rng = (s => () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)(7);
    const picked = new Set();
    while (picked.size < hits) picked.add(Math.floor(rng() * 100));
    cells.forEach((c, i) => c.className = picked.has(i) ? "f" : "");
    el("q-hits").textContent = hits;
    const wasted = (100 - hits) * FACTS.review.minutes;
    el("q-waste").textContent = Math.floor(wasted / 60) + " h " + Math.round(wasted % 60) + " m";
    el("q-base").classList.toggle("on", label === "base");
    el("q-ours").classList.toggle("on", label === "ours");
  };
  el("q-base").addEventListener("click", () => set(9, "base"));
  el("q-ours").addEventListener("click", () => set(89, "ours"));
  set(89, "ours");
}

function makeHeap() {
  const at = [], fam = [], ent = [], wt = [];
  const swap = (i, j) => {
    let x = at[i]; at[i] = at[j]; at[j] = x;
    x = fam[i]; fam[i] = fam[j]; fam[j] = x;
    x = ent[i]; ent[i] = ent[j]; ent[j] = x;
    x = wt[i]; wt[i] = wt[j]; wt[j] = x;
  };
  return {
    size: () => at.length,
    top: () => at[0],
    push(a, f, e, w) {
      at.push(a); fam.push(f); ent.push(e); wt.push(w);
      let i = at.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (at[p] <= at[i]) break; swap(p, i); i = p; }
    },
    pop(out) {
      out.at = at[0]; out.fam = fam[0]; out.ent = ent[0]; out.w = wt[0];
      const n = at.length - 1;
      swap(0, n); at.pop(); fam.pop(); ent.pop(); wt.pop();
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < n && at[l] < at[m]) m = l;
        if (r < n && at[r] < at[m]) m = r;
        if (m === i) break;
        swap(m, i); i = m;
      }
      return out;
    }
  };
}

function datasetFromRows(rows, lag) {
  rows.sort((a, b) => a[0] - b[0]);
  const n = rows.length;
  const sec = new Float64Array(n), amt = new Float64Array(n), y = new Int8Array(n);
  const code = ENTS.map(() => new Int32Array(n));
  const maps = ENTS.map(() => new Map());
  const counts = ENTS.map(() => [0]);
  const keys = ENTS.map(() => ["—"]);
  let labelled = false;
  for (let i = 0; i < n; i++) {
    sec[i] = rows[i][0]; amt[i] = rows[i][1]; y[i] = rows[i][6];
    if (rows[i][6] >= 0) labelled = true;
    for (let j = 0; j < ENTS.length; j++) {
      const k = rows[i][2 + j];
      if (k === undefined || k === null || k === "") { code[j][i] = 0; continue; }
      let c = maps[j].get(k);
      if (c === undefined) { c = counts[j].length; maps[j].set(k, c); counts[j].push(0); keys[j].push(k); }
      code[j][i] = c; counts[j][c]++;
    }
  }
  return {
    n, sec, amt, y, code, seed: null, pending: null, labelled, keys, lag,
    warm: rows.length >= 500 ? WARMUP : 0,
    vsize: counts.map(c => c.length), deg: counts.map(c => Float64Array.from(c)),
    seeded: false, t0: 0,
  };
}

function datasetFromPayload() {
  const C = PAY.cols, n = PAY.n;
  const su = unb64(C.sec, Uint32Array), au = unb64(C.amt, Uint32Array);
  const sec = new Float64Array(n), amt = new Float64Array(n);
  for (let i = 0; i < n; i++) { sec[i] = su[i]; amt[i] = au[i] / 1000; }
  const y = Int8Array.from(unb64(C.y, Uint8Array));
  const code = ENTS.map(e => Int32Array.from(
    PAY.vocab[e].length > 254 ? unb64(C[e], Uint16Array) : unb64(C[e], Uint8Array)));
  const seed = ENTS.map(e => {
    const s = PAY.seed[e];
    return {
      cnt: Float64Array.from(unb64(s.cnt, Uint32Array)),
      tot: unb64(s.tot, Float64Array),
      first: unb64(s.first, Int32Array), prev: unb64(s.prev, Int32Array),
      act: unb64(s.act, Float64Array), acc: unb64(s.acc, Float64Array),
      deg: Float64Array.from(unb64(s.deg, Uint32Array)),
    };
  });
  const p = PAY.pending;
  return {
    n, sec, amt, y, code, seed, labelled: true, warm: 0, seeded: true,
    pending: {
      at: unb64(p.at, Float64Array), fam: unb64(p.fam, Uint8Array),
      ent: unb64(p.ent, Uint32Array), w: unb64(p.w, Float64Array),
    },
    vsize: ENTS.map(e => PAY.vocab[e].length + 1),
    deg: seed.map(s => s.deg),
    keys: ENTS.map(e => ["—"].concat(PAY.vocab[e])),
    t0: PAY.t0Sec / DAY, ref: PAY.ref,
  };
}

function makeEngine(ds) {
  const F = ENTS.length, T0 = ds.t0 || 0;
  const S = [];
  for (let j = 0; j < F; j++) {
    const V = ds.vsize[j];
    const s = {
      cnt: new Float64Array(V), tot: new Float64Array(V),
      first: new Float64Array(V), prev: new Float64Array(V),
      act: new Float64Array(V * NR), acc: new Float64Array(V * NR),
      aT: new Float64Array(V), cT: new Float64Array(V),
    };
    s.first.fill(-1); s.prev.fill(-1);
    if (ds.seed) {
      const z = ds.seed[j];
      s.cnt.set(z.cnt); s.tot.set(z.tot); s.act.set(z.act); s.acc.set(z.acc);
      for (let c = 0; c < V; c++) {
        s.first[c] = z.first[c] < 0 ? -1 : z.first[c] / DAY;
        s.prev[c] = z.prev[c] < 0 ? -1 : z.prev[c] / DAY;
      }
      s.aT.fill(T0); s.cT.fill(T0);
    }
    S.push(s);
  }
  const heap = makeHeap(), slot = { at: 0, fam: 0, ent: 0, w: 0 };
  const lag = ds.lag === undefined ? LAG : ds.lag;
  if (ds.pending) {
    for (let i = 0; i < ds.pending.at.length; i++)
      heap.push(ds.pending.at[i] / DAY, ds.pending.fam[i], ds.pending.ent[i], ds.pending.w[i]);
  }
  const dj = [], dc = [], hot = { fam: -1, val: 0, share: 0 };
  let cur = -1;

  function drain() {
    for (let i = 0; i < dj.length; i++) {
      const s = S[dj[i]], b = dc[i] * NR;
      for (let k = 0; k < NR; k++) s.act[b + k] += 1;
    }
    dj.length = 0; dc.length = 0;
  }

  return {
    state: S,
    hot,
    live() {
      let n = 0;
      for (let j = 0; j < F; j++) {
        const s = S[j];
        for (let c = 1; c < ds.vsize[j]; c++) if (s.acc[c * NR + 2] > 1e-4) n++;
      }
      return n;
    },
    step(i, v) {
      const t = ds.sec[i] / DAY, a = ds.amt[i];
      if (t !== cur) { drain(); cur = t; }
      while (heap.size() && heap.top() < t) {
        const p = heap.pop(slot), s = S[p.fam], b = p.ent * NR;
        const dt = p.at - s.cT[p.ent];
        if (dt > 0) {
          for (let k = 0; k < NR; k++) s.acc[b + k] *= Math.exp(-RATES[k] * dt);
          s.cT[p.ent] = p.at;
        }
        for (let k = 0; k < NR; k++) s.acc[b + k] += p.w;
      }
      v[SA] = a;
      v[SL] = Math.log1p(Math.max(a, 0));
      v[SF] = Math.round((a - Math.floor(a)) * 1000) / 1000;
      v[SH] = (t * 24) % 24;
      let peak = 0;
      hot.fam = -1; hot.val = 0; hot.share = 0;
      for (let j = 0; j < F; j++) {
        const g = SLOT[j], c = ds.code[j][i], s = S[j];
        if (c <= 0) {
          v[g.count] = -1; v[g.mean] = -1; v[g.age] = -1; v[g.gap] = -1; v[g.avm] = -1;
          for (let k = 0; k < NR; k++) { v[g.act[k]] = 0; v[g.con[k]] = 0; }
          continue;
        }
        const b = c * NR;
        let dt = t - s.aT[c];
        if (dt > 0) {
          for (let k = 0; k < NR; k++) s.act[b + k] *= Math.exp(-RATES[k] * dt);
          s.aT[c] = t;
        }
        dt = t - s.cT[c];
        if (dt > 0) {
          for (let k = 0; k < NR; k++) s.acc[b + k] *= Math.exp(-RATES[k] * dt);
          s.cT[c] = t;
        }
        const cnt = s.cnt[c], mean = cnt > 0 ? s.tot[c] / cnt : -1;
        v[g.count] = cnt;
        v[g.mean] = mean;
        v[g.age] = s.first[c] >= 0 ? t - s.first[c] : -1;
        v[g.gap] = s.prev[c] >= 0 ? t - s.prev[c] : -1;
        v[g.avm] = mean > 0 ? a / mean : -1;
        for (let k = 0; k < NR; k++) {
          v[g.act[k]] = s.act[b + k];
          v[g.con[k]] = s.acc[b + k];
        }
        const con = s.acc[b + NR - 1], share = con / (s.act[b + NR - 1] + 1);
        if (con > peak) peak = con;
        if (share > hot.share) { hot.fam = j; hot.val = con; hot.share = share; }
        s.cnt[c] = cnt + 1; s.tot[c] += a;
        if (s.first[c] < 0) s.first[c] = t;
        s.prev[c] = t;
        dj.push(j); dc.push(c);
      }
      return peak;
    },
    confirm(i) {
      const t = ds.sec[i] / DAY;
      for (let j = 0; j < F; j++) {
        const c = ds.code[j][i];
        if (c > 0) heap.push(t + lag, j, c, 1 / Math.log(ds.deg[j][c] + 5));
      }
    }
  };
}

const SYNONYMS = {
  timestamp: ["timestamp", "time", "datetime", "date", "created_at", "createdat",
              "transactiondt", "txn_time", "ts", "event_time", "occurred_at"],
  amount: ["amount", "amt", "value", "transactionamt", "price", "total",
           "order_value", "txn_amount"],
  card: ["card", "card1", "card_id", "cardid", "cardnumber", "card_number",
         "pan", "account", "account_id", "customer", "customer_id", "user_id"],
  address: ["address", "addr", "addr1", "billing", "billing_address", "zip",
            "zipcode", "postcode", "pincode", "city"],
  email: ["email", "emaildomain", "p_emaildomain", "email_domain", "mail",
          "domain", "email_address"],
  device: ["device", "deviceinfo", "device_info", "device_id", "useragent",
           "user_agent", "ua", "fingerprint", "browser"],
  label: ["isfraud", "is_fraud", "fraud", "label", "target", "class",
          "chargeback", "is_chargeback", "outcome"],
};
const FIELDS = ["timestamp", "amount", "card", "address", "email", "device", "label"];
const MAX_ROWS = 300000;

function splitLine(line, delimiter) {
  const out = [];
  let cell = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; }
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) { out.push(cell); cell = ""; }
    else cell += c;
  }
  out.push(cell);
  return out.map(s => s.trim());
}

function sniff(text, forceHeader) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter(l => l.trim().length);
  if (!lines.length) return { error: "That file has no rows in it." };
  const delimiter = [",", ";", "\t", "|"]
    .map(d => ({ d, n: splitLine(lines[0], d).length }))
    .sort((a, b) => b.n - a.n)[0].d;
  const first = splitLine(lines[0], delimiter);
  const numeric = c => c !== "" && Number.isFinite(Number(c));
  const sample = lines.slice(1, 51).map(l => splitLine(l, delimiter));
  let hasHeader;
  if (!sample.length) {
    hasHeader = !first.some(numeric);
  } else {
    let agrees = 0;
    first.forEach((cell, i) => {
      const seen = sample.filter(r => r[i] !== undefined && r[i] !== "");
      if (!seen.length) { agrees++; return; }
      const mostlyNumeric = seen.filter(r => numeric(r[i])).length > seen.length / 2;
      if (numeric(cell) === mostlyNumeric) agrees++;
    });
    hasHeader = agrees < first.length;
  }
  if (forceHeader !== undefined && forceHeader !== null) hasHeader = !!forceHeader;
  const header = hasHeader ? first : first.map((_, i) => "column " + (i + 1));
  const body = lines.slice(hasHeader ? 1 : 0);
  if (!body.length) return { error: "That file has a header but no data rows." };
  const truncated = body.length > MAX_ROWS;
  const rows = (truncated ? body.slice(0, MAX_ROWS) : body).map(l => splitLine(l, delimiter));
  return { header, rows, hasHeader, delimiter, truncated, total: body.length };
}

function guessMapping(header, positional) {
  if (positional) {
    const mapping = {};
    FIELDS.forEach((f, i) => { mapping[f] = i < header.length ? i : -1; });
    return mapping;
  }
  const norm = header.map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const used = new Set();
  const mapping = {};
  for (const field of FIELDS) {
    let best = -1, bestRank = 1e9;
    SYNONYMS[field].forEach((syn, rank) => {
      const key = syn.replace(/[^a-z0-9]/g, "");
      norm.forEach((h, i) => {
        if (used.has(i)) return;
        const score = h === key ? rank : h.includes(key) || key.includes(h) ? rank + 40 : -1;
        if (score >= 0 && score < bestRank) { bestRank = score; best = i; }
      });
    });
    if (best >= 0) { mapping[field] = best; used.add(best); }
    else mapping[field] = -1;
  }
  return mapping;
}

function parseTime(raw, index) {
  const n = Number(raw);
  if (raw !== "" && Number.isFinite(n)) return n > 3e10 ? n / 1000 : n;
  const t = Date.parse(raw);
  if (Number.isFinite(t)) return t / 1000;
  return index;
}

function parseAmount(raw) {
  let v = String(raw).trim().replace(/[^0-9.,\-]/g, "");
  if (/^-?\d{1,3}(\.\d{3})+,\d{1,2}$/.test(v)) v = v.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d+,\d{1,2}$/.test(v)) v = v.replace(",", ".");
  else v = v.replace(/,/g, "");
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const TRUE_WORDS = new Set(["1", "true", "yes", "y", "fraud", "chargeback", "bad"]);
const FALSE_WORDS = new Set(["0", "false", "no", "n", "legit", "legitimate", "good", "ok"]);

function parseLabel(raw) {
  if (raw === undefined || raw === "") return -1;
  const v = String(raw).trim().toLowerCase();
  if (TRUE_WORDS.has(v)) return 1;
  if (FALSE_WORDS.has(v)) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? (n ? 1 : 0) : -1;
}

function rowsFrom(parsed, mapping) {
  const at = f => mapping[f];
  const cell = (r, f) => (at(f) >= 0 && r[at(f)] !== undefined ? r[at(f)] : "");
  const out = [];
  parsed.rows.forEach((r, i) => {
    const ts = parseTime(cell(r, "timestamp"), i);
    if (!Number.isFinite(ts)) return;
    out.push([ts, parseAmount(cell(r, "amount")),
      cell(r, "card"), cell(r, "address"), cell(r, "email"), cell(r, "device"),
      parseLabel(cell(r, "label"))]);
  });
  return out;
}

function parseCSV(text) {
  const parsed = sniff(text);
  if (parsed.error) return [];
  return rowsFrom(parsed, guessMapping(parsed.header, !parsed.hasHeader));
}

function simulate(n, rate, ring, burstMin) {
  const rng = (s => () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)(20260901);
  const rows = [], span = 40 * DAY;
  const devices = ["iOS 14.2", "Windows", "SM-G973F", "MacOS", "SM-A505F", "Trident/7.0"];
  const mails = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "anonymous.com"];
  const nFraud = Math.round(n * rate);
  const nRings = Math.max(1, Math.round(nFraud / Math.max(ring * 3, 1)));
  const legit = n - nFraud;
  for (let i = 0; i < legit; i++) {
    rows.push([Math.floor(rng() * span), Math.round((10 + rng() * rng() * 900) * 100) / 100,
      "c" + Math.floor(rng() * 4000), "a" + Math.floor(rng() * 300),
      mails[Math.floor(rng() * mails.length)], devices[Math.floor(rng() * devices.length)], 0]);
  }
  let made = 0;
  for (let r = 0; r < nRings && made < nFraud; r++) {
    const cards = Array.from({ length: ring }, (_, k) => "R" + r + "c" + k);
    const dev = "R" + r + "dev", addr = "R" + r + "addr";
    const start = Math.floor(rng() * span * 0.92);
    const burst = burstMin * 60;
    const size = Math.min(nFraud - made, Math.max(2, Math.round(ring * 3 + rng() * ring * 3)));
    for (let k = 0; k < size; k++) {
      rows.push([Math.floor(start + rng() * burst * (1 + k * 0.35)),
        Math.round((20 + rng() * 1400) * 100) / 100,
        cards[Math.floor(rng() * cards.length)], addr,
        rng() < 0.7 ? "anonymous.com" : mails[Math.floor(rng() * mails.length)],
        rng() < 0.8 ? dev : devices[Math.floor(rng() * devices.length)], 1]);
      made++;
    }
  }
  return rows.sort((a, b) => a[0] - b[0]);
}

/* ------------------------------------------ evidence scale and calibration */
function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const pos = clamp(q, 0, 1) * (sorted.length - 1);
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function makeEvidenceScale(scores, labels, nBins) {
  const n = scores.length;
  const bins = nBins || 25;
  const sorted = Float64Array.from(scores).sort();
  const edges = [];
  for (let i = 1; i < bins; i++) edges.push(quantile(sorted, i / bins));
  const uniq = edges.filter((v, i) => i === 0 || v > edges[i - 1]);
  const nb = uniq.length + 1;
  const fraud = new Float64Array(nb).fill(1), legit = new Float64Array(nb).fill(1);
  const binOf = s => {
    let lo = 0, hi = uniq.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (s > uniq[m]) lo = m + 1; else hi = m; }
    return lo;
  };
  for (let i = 0; i < n; i++) (labels[i] === 1 ? fraud : legit)[binOf(scores[i])] += 1;
  let fs = 0, ls = 0;
  for (let i = 0; i < nb; i++) { fs += fraud[i]; ls += legit[i]; }
  const lr = new Float64Array(nb);
  for (let i = 0; i < nb; i++) lr[i] = clamp(Math.log((fraud[i] / fs) / (legit[i] / ls)), -6, 6);
  return s => lr[binOf(s)];
}

function accumulate(evidence, scores, keys, lower) {
  const total = new Map(), cleared = new Set();
  const running = new Float64Array(scores.length);
  for (let i = 0; i < scores.length; i++) {
    const k = keys[i];
    if (cleared.has(k)) { running[i] = total.get(k); continue; }
    const t = (total.get(k) || 0) + evidence(scores[i]);
    total.set(k, t); running[i] = t;
    if (t <= lower) cleared.add(k);
  }
  return running;
}

function calibrate(scores, labels, keys, targetFalseAlarm, missRate) {
  const alpha = targetFalseAlarm === undefined ? 0.01 : targetFalseAlarm;
  const beta = missRate === undefined ? 0.10 : missRate;
  const lower = Math.log(beta / (1 - alpha));
  const closed = Math.log((1 - beta) / alpha);
  const evidence = makeEvidenceScale(scores, labels);
  const running = accumulate(evidence, scores, keys, lower);

  const peak = new Map(), bad = new Map();
  for (let i = 0; i < running.length; i++) {
    const k = keys[i];
    if (!peak.has(k) || running[i] > peak.get(k)) peak.set(k, running[i]);
    if (labels[i] === 1) bad.set(k, 1);
  }
  const clean = [], dirty = [];
  peak.forEach((v, k) => (bad.has(k) ? dirty : clean).push(v));
  clean.sort((a, b) => a - b); dirty.sort((a, b) => a - b);

  const tail = (arr, thr) => {
    let lo = 0, hi = arr.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < thr) lo = m + 1; else hi = m; }
    return (arr.length - lo) / Math.max(arr.length, 1);
  };
  let upper = closed;
  if (clean.length) {
    const distinct = [];
    for (let i = 0; i < clean.length; i++) if (!i || clean[i] > clean[i - 1]) distinct.push(clean[i]);
    upper = distinct[distinct.length - 1] + 1e-9;
    for (let i = 0; i < distinct.length; i++) {
      if (tail(clean, distinct[i]) <= alpha) { upper = distinct[i]; break; }
    }
  }
  return {
    evidence, lower, upper, closed,
    achieved: tail(clean, upper),
    achievedClosed: tail(clean, closed),
    caught: tail(dirty, upper),
    caughtClosed: tail(dirty, closed),
    nClean: clean.length, nDirty: dirty.length,
    clean, dirty,
    labelled: dirty.length > 0,
  };
}

function applyTest(cal, scores, labels, keys) {
  const running = accumulate(cal.evidence, scores, keys, cal.lower);
  const settled = new Map();
  const dec = new Int8Array(scores.length);
  for (let i = 0; i < scores.length; i++) {
    const k = keys[i];
    if (settled.has(k)) { dec[i] = settled.get(k); continue; }
    if (running[i] >= cal.upper) { dec[i] = 1; settled.set(k, 1); }
    else if (running[i] <= cal.lower) { dec[i] = -1; settled.set(k, -1); }
  }
  const peak = new Map(), bad = new Map(), blocked = new Map();
  for (let i = 0; i < scores.length; i++) {
    const k = keys[i];
    if (labels[i] === 1) bad.set(k, 1);
    if (dec[i] === 1) blocked.set(k, 1);
    if (!peak.has(k)) peak.set(k, 1);
  }
  let cleanN = 0, cleanBlocked = 0, dirtyN = 0, dirtyBlocked = 0;
  peak.forEach((_, k) => {
    if (bad.has(k)) { dirtyN++; if (blocked.has(k)) dirtyBlocked++; }
    else { cleanN++; if (blocked.has(k)) cleanBlocked++; }
  });
  let txnFalse = 0, txnLegit = 0, txnCaught = 0, txnFraud = 0;
  for (let i = 0; i < scores.length; i++) {
    if (labels[i] === 1) { txnFraud++; if (dec[i] === 1) txnCaught++; }
    else if (labels[i] === 0) { txnLegit++; if (dec[i] === 1) txnFalse++; }
  }
  return {
    dec,
    customerFalse: cleanN ? cleanBlocked / cleanN : 0,
    customerCaught: dirtyN ? dirtyBlocked / dirtyN : 0,
    txnFalse: txnLegit ? txnFalse / txnLegit : 0,
    txnCaught: txnFraud ? txnCaught / txnFraud : 0,
    cleanN, dirtyN, blockedCustomers: cleanBlocked + dirtyBlocked,
  };
}

/* ------------------------------------------------- the review desk, in JS */
function makeDesk(capacity, latencyDays, periodDays) {
  const resolved = new Map();
  const pending = new Map();
  const held = new Map();
  const blocked = new Set();
  let periodEnd = null, stopped = 0, periodsClosed = 0;

  function close() {
    const ranked = [];
    pending.forEach((s, k) => { if (!resolved.has(k)) ranked.push([s, k]); });
    ranked.sort((a, b) => b[0] - a[0]);
    const chosen = ranked.slice(0, capacity).map(r => r[1]);
    pending.clear();
    periodsClosed++;
    return chosen;
  }

  return {
    get stopped() { return stopped; },
    get periods() { return periodsClosed; },
    pendingCount: () => held.size,
    decide(t, key, score) {
      if (periodEnd === null) periodEnd = t + periodDays;
      while (t >= periodEnd) {
        for (const k of close()) {
          if (blocked.has(k) || resolved.get(k) === false) continue;
          resolved.set(k, null);
          held.set(k, t + latencyDays);
          stopped++;
        }
        periodEnd += periodDays;
      }
      if (blocked.has(key)) return 2;
      if (held.has(key)) return 1;
      if (key && !resolved.has(key) && Number.isFinite(score)) {
        if (score > (pending.get(key) === undefined ? -Infinity : pending.get(key)))
          pending.set(key, score);
      }
      return 0;
    },
    due(t) {
      const out = [];
      held.forEach((at, k) => { if (at <= t) out.push(k); });
      return out;
    },
    verdict(key, isFraud) {
      held.delete(key);
      resolved.set(key, !!isFraud);
      if (isFraud) blocked.add(key); 
    },
  };
}

function runDesk(ds, scores, capacity, latencyHours, reviewAccuracy) {
  const n = ds.n;
  const latency = latencyHours / 24;
  const desk = makeDesk(capacity, latency, 1.0);
  const { keys } = customerKeys(ds);
  const truth = new Map();
  for (let i = 0; i < n; i++) {
    const k = keys[i];
    if (ds.y[i] === 1) truth.set(k, 1);
    else if (!truth.has(k)) truth.set(k, 0);
  }
  const acc = reviewAccuracy === undefined ? 1 : reviewAccuracy;
  let seed = 8675309;
  const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const hit = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const t = ds.sec[i] / DAY;
    for (const k of desk.due(t)) {
      let v = truth.get(k) === 1;
      if (rand() >= acc) v = !v;
      desk.verdict(k, v);
    }
    if (desk.decide(t, keys[i], scores[i]) !== 0) hit[i] = 1;
  }
  const clean = new Set(), fraudSet = new Set();
  for (let i = 0; i < n; i++) (ds.y[i] === 1 ? fraudSet : clean).add(keys[i]);
  fraudSet.forEach(k => clean.delete(k));
  const per = new Map();
  let cleanTxn = 0, caughtValue = 0;
  const caught = new Set();
  for (let i = 0; i < n; i++) {
    const k = keys[i];
    if (clean.has(k)) {
      cleanTxn++;
      if (hit[i]) per.set(k, (per.get(k) || 0) + 1);
    }
    if (hit[i] && ds.y[i] === 1) { caughtValue += ds.amt[i] * COST.usd; caught.add(k); }
  }
  let worst = 0, damaged = 0;
  per.forEach(v => { damaged += v; if (v > worst) worst = v; });
  const span = Math.max((ds.sec[n - 1] - ds.sec[0]) / DAY, 1e-9);
  return {
    hit, stopped: desk.stopped, innocentStopped: per.size, innocentPerDay: per.size / span,
    txnShare: cleanTxn ? damaged / cleanTxn : 0, worst,
    recall: fraudSet.size ? caught.size / fraudSet.size : 0,
    value: caughtValue, span, capacity, latencyHours,
    bound: latency * (n / span),
  };
}

function drawLive(pts, running, labelled) {
  const W = 900, H = 236, L = 54, R = 14, T = 16, B = 44;
  if (!pts.length) { el("live-chart").innerHTML = chart(W, H, ""); return; }
  const n = pts.length;
  const smooth = key => {
    const out = new Array(n).fill(-1);
    let e = -1;
    for (let i = 0; i < n; i++) {
      const v = pts[i][key];
      if (v < 0) continue;
      e = e < 0 ? v : e + 0.22 * (v - e);
      out[i] = e;
    }
    return out;
  };
  const SM = { f: smooth("f"), l: smooth("l") };
  const vals = [...SM.f, ...SM.l].filter(v => v >= 0);
  const max = Math.max(...vals, 1e-6) * 1.18;
  const X = i => L + (i / Math.max(n - 1, 1)) * (W - L - R);
  const Y = v => T + (1 - v / max) * (H - T - B);
  const path = key => {
    let d = "", open = false;
    SM[key].forEach((v, i) => {
      if (v < 0) { open = false; return; }
      d += (open ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1) + " ";
      open = true;
    });
    return d.trim();
  };
  const grid = [0, .5, 1].map(f => {
    const y = T + f * (H - T - B);
    return `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="var(--edge-2)"/>
      <text x="${L - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="var(--ink-3)">${((1 - f) * max).toFixed(2)}</text>`;
  }).join("");
  const span = Math.max(pts[n - 1].d, 1e-9);
  const unit = span >= 2 ? "d" : span >= 0.12 ? "h" : "min";
  const scale = unit === "d" ? 1 : unit === "h" ? 24 : 1440;
  const ticks = [0, .25, .5, .75, 1].map(f => {
    const i = Math.round(f * (n - 1)), v = pts[i].d * scale;
    return `<line x1="${X(i)}" y1="${H - B}" x2="${X(i)}" y2="${H - B + 4}" stroke="var(--edge)"/>
      <text x="${X(i)}" y="${H - B + 17}" text-anchor="middle" font-size="10" fill="var(--ink-3)">${v.toFixed(v >= 10 ? 0 : 1)}${unit}</text>`;
  }).join("");
  const hotMax = Math.max(...pts.map(p => p.c), 1);
  const rug = pts.map((p, i) => p.c ? `<rect x="${X(i) - 1.4}" y="${H - B + 27}" width="2.8" height="${(1.5 + 5 * p.c / hotMax).toFixed(1)}" fill="var(--r2)" opacity="${(0.16 + 0.4 * p.c / hotMax).toFixed(2)}" rx="1"/>` : "").join("");
  const area = labelled ? "" : `<path d="${path("l")} L${X(n - 1).toFixed(1)} ${H - B} L${L} ${H - B} Z" fill="url(#lg)"/>`;
  const legend = labelled
    ? `<text x="${L}" y="${T - 4}" font-size="10.5" fill="var(--r2)" font-weight="600">mean score · fraud</text>
       <text x="${L + 118}" y="${T - 4}" font-size="10.5" fill="var(--brand)">mean score · legitimate</text>`
    : `<text x="${L}" y="${T - 4}" font-size="10.5" fill="var(--brand)" font-weight="600">mean risk score</text>`;
  el("live-chart").innerHTML = chart(W, H, `${grid}
    <defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="var(--brand)" stop-opacity=".26"/>
      <stop offset="100%" stop-color="var(--brand)" stop-opacity="0"/></linearGradient></defs>
    ${area}
    <path d="${path("l")}" fill="none" stroke="var(--brand)" stroke-width="${labelled ? 1.7 : 2.2}" stroke-linejoin="round" opacity="${labelled ? .95 : 1}"/>
    ${labelled ? `<path d="${path("f")}" fill="none" stroke="var(--r2)" stroke-width="2.2" stroke-linejoin="round"/>` : ""}
    <line x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}" stroke="var(--edge)"/>
    ${ticks}${rug}${legend}
    <text x="${W - R}" y="${H - 5}" text-anchor="end" font-size="10.5" fill="var(--ink-3)">elapsed time · orange ticks are confirmed frauds arriving</text>`);
}

function drawPrecision(res) {
  const W = 440, H = 240, L = 44, R = 14, T = 16, B = 34;
  const depths = res.depths;
  const X = i => L + (i + .5) * ((W - L - R) / depths.length);
  const Y = v => T + (1 - v) * (H - T - B);
  const grid = [0, .25, .5, .75, 1].map(f => {
    const y = T + f * (H - T - B);
    return `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="var(--edge-2)"/>
      <text x="${L - 7}" y="${y + 4}" text-anchor="end" font-size="10" fill="var(--ink-3)">${((1 - f) * 100).toFixed(0)}%</text>`;
  }).join("");
  const series = (vals, colour, wide) =>
    vals.map((v, i) => (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1)).join(" ")
    && `<path d="${vals.map((v, i) => (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1)).join(" ")}"
        fill="none" stroke="${colour}" stroke-width="${wide ? 2.4 : 1.8}"/>` +
    vals.map((v, i) => `<circle cx="${X(i)}" cy="${Y(v)}" r="${wide ? 4 : 3}" fill="${colour}"/>`).join("");
  const ticks = depths.map((d, i) => `<text x="${X(i)}" y="${H - 12}" text-anchor="middle" font-size="10" fill="var(--ink-3)">${d}</text>`).join("");
  el("prec-chart").innerHTML = chart(W, H, `${grid}
    <line x1="${L}" y1="${Y(res.baseRate)}" x2="${W - R}" y2="${Y(res.baseRate)}" stroke="var(--ink-3)" stroke-dasharray="3 3"/>
    ${series(res.precPlain, "var(--brand)", false)}
    ${series(res.prec, "var(--r2)", true)}
    ${ticks}
    <text x="${L}" y="${T - 3}" font-size="10.5" fill="var(--r2)" font-weight="600">with contagion</text>
    <text x="${L + 108}" y="${T - 3}" font-size="10.5" fill="var(--brand)">without</text>
    <text x="${W - R}" y="${T - 3}" text-anchor="end" font-size="10.5" fill="var(--ink-3)">base rate</text>`);
}

function drawDist(res) {
  const W = 440, H = 240, L = 40, R = 14, T = 16, B = 34, NB = 22;
  const bins = (arr) => {
    const h = new Array(NB).fill(0);
    arr.forEach(s => h[Math.min(NB - 1, Math.floor(s * NB))]++);
    const t = arr.length || 1;
    return h.map(v => v / t);
  };
  const f = bins(res.fraudScores), l = bins(res.legitScores);
  const max = Math.max(...f, ...l, 1e-6) * 1.1;
  const bw = (W - L - R) / NB;
  const Y = v => T + (1 - v / max) * (H - T - B);
  let body = `<line x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}" stroke="var(--edge)"/>`;
  for (let i = 0; i < NB; i++) {
    body += `<rect x="${L + i * bw + 1}" y="${Y(l[i])}" width="${bw - 2}" height="${H - B - Y(l[i])}" fill="var(--brand)" opacity=".28" rx="2"/>`;
    body += `<rect x="${L + i * bw + 1}" y="${Y(f[i])}" width="${bw - 2}" height="${H - B - Y(f[i])}" fill="var(--r2)" opacity=".85" rx="2"/>`;
  }
  body += `<text x="${L}" y="${H - 12}" font-size="10" fill="var(--ink-3)">low risk</text>
    <text x="${W - R}" y="${H - 12}" text-anchor="end" font-size="10" fill="var(--ink-3)">high risk</text>
    <text x="${L}" y="${T - 3}" font-size="10.5" fill="var(--r2)" font-weight="600">fraud</text>
    <text x="${L + 44}" y="${T - 3}" font-size="10.5" fill="var(--brand)">legitimate</text>`;
  el("dist-chart").innerHTML = chart(W, H, body);
}

/* -------------------------------------------------------------- data page */
function initData() {
  const D = FACTS.data;
  el("d-rows").textContent = fmtInt(D.rows);
  el("d-fraud").textContent = fmtInt(D.frauds);
  el("d-rate").textContent = (100 * D.rate).toFixed(2) + "% base rate";

  const use = { train: "training the model", stop: "early stopping only", policy: "choosing the policy",
                test: "reporting every number", demo: "the live stream in the Model tab" };
  const rows = [["train", "0 – 105"], ["stop", "105 – 120"], ["test", "120 – 182"], ["demo", "120 – 150"]];
  el("split-rows").innerHTML = rows.map(([k, d]) => {
    const s = D.splits[k];
    return `<tr${k === "test" ? ' class="win"' : ""}><td>${k === "demo" ? "Live demo window" : k[0].toUpperCase() + k.slice(1)}</td>
      <td class="mono">${d}</td><td class="r">${fmtInt(s.rows)}</td><td class="r">${fmtInt(s.frauds)}</td>
      <td class="r">${(100 * s.rate).toFixed(2)}%</td><td>${use[k]}</td></tr>`;
  }).join("");

  const BECOMES = {
    TransactionDT: "the clock every decay runs on",
    TransactionAmt: "amount, log amount, and the cents fraction",
    card1: "card identity, contagion and history",
    addr1: "address identity, contagion and history",
    P_emaildomain: "email identity, popularity-weighted",
    DeviceInfo: "device identity, contagion and history",
    isFraud: "the label, visible only 7 days late",
  };
  el("schema-rows").innerHTML = D.schema.map(c => `<tr>
    <td class="mono">${esc(c.name)}</td><td class="mono" style="color:var(--ink-3)">${c.dtype}</td>
    <td class="r">${fmtInt(c.distinct)}</td>
    <td class="r"${c.missing > 0.5 ? ' style="color:var(--r2);font-weight:600"' : ""}>${(100 * c.missing).toFixed(1)}%</td>
    <td class="mono" style="color:var(--ink-3)">${esc(c.example).slice(0, 22)}</td>
    <td style="color:var(--ink-2)">${BECOMES[c.name] || ""}</td></tr>`).join("");

  el("sample-table").innerHTML = `<thead><tr>${D.sample_cols.map(c =>
    `<th class="${c === "TransactionAmt" ? "r" : ""}">${esc(c)}</th>`).join("")}</tr></thead><tbody>${
    D.sample_rows.map(r => `<tr>${r.map((v, i) => {
      const last = i === r.length - 1;
      return `<td class="${i === 1 ? "r" : ""} ${i > 1 && !last ? "mono" : ""}">${
        last ? (v === 1 ? '<span class="chip hit">fraud</span>' : '<span class="chip miss">legit</span>')
             : (v === "" ? '<span style="color:var(--ink-3)">—</span>' : esc(v))}</td>`;
    }).join("")}</tr>`).join("")}</tbody>`;

  const W = 900, H = 190, L = 46, R = 14, T = 14, B = 34;
  const vol = D.daily.volume, fr = D.daily.frauds;
  const maxV = Math.max(...vol);
  const X = d => L + (d / 182) * (W - L - R);
  const Y = v => T + (1 - v / (maxV * 1.08)) * (H - T - B);
  const bars = vol.map((v, d) => {
    const h = (H - T - B) * (v / (maxV * 1.08));
    const fh = (H - T - B) * (fr[d] / (maxV * 1.08)) * 12;
    return `<rect x="${X(d).toFixed(1)}" y="${(H - B - h).toFixed(1)}" width="${((W - L - R) / 182 - 0.6).toFixed(1)}"
      height="${h.toFixed(1)}" fill="var(--brand)" opacity=".28"/>
      <rect x="${X(d).toFixed(1)}" y="${(H - B - fh).toFixed(1)}" width="${((W - L - R) / 182 - 0.6).toFixed(1)}"
      height="${Math.min(fh, H - T - B).toFixed(1)}" fill="var(--r2)" opacity=".85"/>`;
  }).join("");
  const marks = [[105, "train ends"], [120, "test begins"], [150, "demo window ends"]].map(([d, t]) =>
    `<line x1="${X(d)}" y1="${T - 4}" x2="${X(d)}" y2="${H - B}" stroke="var(--ink)" stroke-dasharray="3 3" opacity=".55"/>
     <text x="${X(d) + 5}" y="${T + 6}" font-size="10" fill="var(--ink-2)" font-weight="600">${t}</text>`).join("");
  el("daily-chart").innerHTML = chart(W, H, `
    ${[0, .5, 1].map(f => { const y = T + f * (H - T - B);
      return `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="var(--edge-2)"/>
      <text x="${L - 7}" y="${y + 4}" text-anchor="end" font-size="10" fill="var(--ink-3)">${fmtInt((1 - f) * maxV * 1.08)}</text>`; }).join("")}
    ${bars}${marks}
    <line x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}" stroke="var(--edge)"/>
    ${[0, 60, 120, 180].map(d => `<text x="${X(d)}" y="${H - B + 16}" text-anchor="middle" font-size="10" fill="var(--ink-3)">day ${d}</text>`).join("")}
    <text x="${L}" y="${H - 4}" font-size="10.5" fill="var(--brand)">transactions per day</text>
    <text x="${L + 132}" y="${H - 4}" font-size="10.5" fill="var(--r2)">frauds per day (×12 for visibility)</text>`);

  const W2 = 420, H2 = 150, L2 = 96, R2 = 22, T2 = 20, B2 = 32;
  const X2 = v => L2 + (v / 0.75) * (W2 - L2 - R2);
  const bars2 = [
    { n: "IEEE-CIS", s: "590,540 rows", v: FACTS.r0.ieee, lo: FACTS.r0.ieee_lo, hi: FACTS.r0.ieee_hi, y: T2 + 22 },
    { n: "ULB Europe", s: "284,807 rows", v: FACTS.r0.ulb, lo: FACTS.r0.ulb_lo, hi: FACTS.r0.ulb_hi, y: T2 + 74 },
  ].map(b => `<text x="${L2 - 12}" y="${b.y + 1}" text-anchor="end" font-size="12" font-weight="600" fill="var(--ink)">${b.n}</text>
    <text x="${L2 - 12}" y="${b.y + 15}" text-anchor="end" font-size="10" fill="var(--ink-3)">${b.s}</text>
    <line x1="${X2(b.lo)}" y1="${b.y - 4}" x2="${X2(b.hi)}" y2="${b.y - 4}" stroke="var(--r2)" stroke-width="3" stroke-linecap="round" opacity=".45"/>
    <circle cx="${X2(b.v)}" cy="${b.y - 4}" r="5" fill="var(--r2)"/>
    <text x="${X2(b.hi) + 10}" y="${b.y}" font-size="12" font-weight="600" fill="var(--r2)" class="num">${b.v.toFixed(3)}</text>`).join("");
  el("data-r0-chart").innerHTML = chart(W2, H2, `
    ${[0, .25, .5, .75].map(v => `<line x1="${X2(v)}" y1="${T2}" x2="${X2(v)}" y2="${H2 - B2}" stroke="var(--edge-2)"/>
      <text x="${X2(v)}" y="${H2 - B2 + 16}" text-anchor="middle" font-size="10" fill="var(--ink-3)">${v}</text>`).join("")}
    <line x1="${L2}" y1="${H2 - B2}" x2="${W2 - R2}" y2="${H2 - B2}" stroke="var(--edge)"/>${bars2}
    <text x="${W2 - R2}" y="${H2 - 4}" text-anchor="end" font-size="10" fill="var(--ink-3)">events caused per event</text>`);
}

/* ------------------------------------------------------- experiments page */
const EXPERIMENTS = [
  { v: "confirmed", t: "Is fraud actually a branching process?",
    q: "Fit the Hawkes intensity by maximum likelihood on real transaction times, then shuffle those times and refit as a null.",
    r: [["Branching ratio", "0.438"], ["Half-life", "3.3 min"], ["Shuffled null, max of 50", "0.043"], ["Likelihood ratio", "7,379"]],
    s: "The clustering is in the data, not in the estimator. A shuffled stream never came close." },
  { v: "confirmed", t: "Does it replicate on a different dataset?",
    q: "Re-estimate from scratch on the ULB European card dataset. Different continent, different years, anonymised features, 0.17% fraud rate.",
    r: [["IEEE-CIS", "0.438"], ["ULB Europe", "0.574"], ["Estimator changes between runs", "none"]],
    s: "Different magnitude, same shape, both below 1. Not a quirk of one file." },
  { v: "confirmed", t: "Does contagion actually lift a strong detector?",
    q: "Train the same model with and without the 27 contagion features. Everything else identical.",
    r: [["PR-AUC with", "0.466"], ["PR-AUC without", "0.232"], ["Precision@100 with", "0.89"], ["Precision@100 without", "0.09"]],
    s: "Roughly double, on 62 days the model never saw. This is the headline, and the next three experiments exist to attack it." },
  { v: "confirmed", t: "Is the lift leakage?",
    q: "Rebuild the identical features from randomly shuffled labels and retrain. Structure that leaks survives this. A real signal cannot.",
    r: [["Real labels", "0.401"], ["Shuffled labels", "0.196"], ["No contagion at all", "0.202"]],
    s: "The entire gain vanishes and lands on top of the no-contagion model. This is the experiment that made the result trustworthy." },
  { v: "confirmed", t: "How fast must confirmations arrive?",
    q: "Delay the moment a fraud becomes visible to the model and re-measure. If it only works at zero delay it is a laboratory result.",
    r: [["Same day (cheating)", "0.652"], ["7 days, what we report", "0.401"], ["21 days", "0.387"], ["45 days", "0.259"]],
    s: "Degrades gracefully rather than collapsing. Every reported number uses the 7-day figure." },
  { v: "confirmed", t: "What if the feedback loop dies entirely?",
    q: "Deploy, then never tell the system about another fraud. The worst realistic operational failure.",
    r: [["Live feedback", "0.401"], ["Feedback frozen", "0.303"], ["No contagion", "0.202"], ["Benefit retained", "51%"]],
    s: "Half the value survives with a dead feed. That belongs in a model card, not buried." },
  { v: "failed", t: "Do velocity features help?",
    q: "Add 72 causal transaction-history features. Extra information should not hurt.",
    r: [["Base only", "0.229"], ["Base + velocity", "0.202"], ["Worst drift", "4.0 sd"]],
    s: "It hurt. This dataset already ships engineered velocity columns, and age-like features grow without bound, so their test values sit outside anything seen in training. Removed." },
  { v: "failed", t: "Does Wald's theorem hold on a real stream?",
    q: "Apply the sequential probability ratio test with its closed-form boundary for a 1% false-alarm rate.",
    r: [["Target", "1.00%"], ["Delivered", "10.64%"], ["After calibrating on held-out data", "2.14%"]],
    s: "The proof assumes independent evidence, and one customer's five payments in a row are not independent. Calibrating the boundary on held-out data got it to 2.14% — which turned out to be the wrong thing to fix." },
  { v: "failed", t: "Does the genetic algorithm beat random search?",
    q: "NSGA-II against plain random search at an equal evaluation budget, over the same policy space.",
    r: [["NSGA-II operating points", "60"], ["Random search points", "6"], ["Better policies found", "none"]],
    s: "It does not. We narrowed the claim to what is true: the GA buys coverage of the frontier, not better policies. Kept in the README rather than deleted." },
  { v: "failed", t: "Eight attempts to save the sequential decision layer",
    q: "Wald's SPRT, Page's CUSUM with reset and with decay, adaptive conformal control on the quantile level, direct threshold control, a precision-locked integrator, a budgeted rate governor, and a conformal test martingale under Ville's inequality.",
    r: [["Attempts", "8"], ["That held their target", "0"], ["False alarms from one account", "1,172"], ["That account's share", "32%"]],
    s: "Every method failed on the same handful of customers. The model is confidently and persistently wrong about them, so from its point of view the evidence is real and keeps arriving. A cleverer stopping rule cannot fix a miscalibrated likelihood." },
  { v: "confirmed", t: "Why none of them could have worked",
    q: "Measure the lifetime false-alarm rate against the number of transactions a customer makes.",
    r: [["1 transaction", "0.00%"], ["6-20", "8.97%"], ["21-100", "11.32%"], ["101+", "100%"]],
    s: "A per-decision guarantee applied 1,175 times is a per-customer guarantee of 1-(1-α)^n, which at α=1% and n=1,175 is 99.996%. The theorem was never violated. It was read as though it applied once." },
  { v: "confirmed", t: "Deleting the layer and bounding the damage instead",
    q: "Replace the test with a review desk: rank by score, send the day's worst to a human, and let a wrong call last only until somebody looks at it.",
    r: [["Innocent payments blocked", "2.265% → 0.234%"], ["Worst single customer", "1,172 → 5"], ["Recall", "21.1% → 21.3%"], ["Calibration constants", "0"]],
    s: "At matched recall: 9.7× less damage and a 234× smaller worst case. At 200 reviews a day it beats the old layer on every axis at once. Nothing is calibrated, so nothing has to transfer — the ceiling is your desk capacity and the damage is capped by your review latency." },
  { v: "confirmed", t: "Does the new guarantee survive somebody else's data?",
    q: "Ten synthetic stream shapes — heavy-tailed entities, a single whale, 0.05% fraud, 45% fraud, drifting base rate, bursty arrivals, all fraud, no fraud, and one where the model is deliberately inverted.",
    r: [["Runs", "30"], ["Stream shapes", "10"], ["Budget violations", "0"], ["Latency-bound violations", "0"]],
    s: "The bound is arithmetic rather than statistical — capacity × latency × transaction rate — so there is no distribution it can be wrong about. 47 of the 145 tests exist purely to attack it." },
  { v: "confirmed", t: "Does the browser really run the same model?",
    q: "Score all 83,571 transactions of the demo window in JavaScript and compare against LightGBM, transaction by transaction.",
    r: [["Largest disagreement", "2.22e-16"], ["Transactions checked", "83,571"], ["Models checked", "both"]],
    s: "Machine precision. Getting there needed two fixes: NaN where Python gives zero, and tree thresholds rounded to six decimals destroying splits on small contagion values." },
];

function initExperiments() {
  el("exp-list").innerHTML = EXPERIMENTS.map((e, i) => `
    <article class="exp ${e.v}">
      <div class="exp-head">
        <span class="num idx">${String(i + 1).padStart(2, "0")}</span>
        <div><h3>${esc(e.t)}</h3><p class="q">${esc(e.q)}</p></div>
        <span class="chip ${e.v === "confirmed" ? "ok" : "no"}">${e.v === "confirmed" ? "held up" : "failed"}</span>
      </div>
      <div class="exp-res">${e.r.map(([k, v]) =>
        `<div><b class="num">${esc(v)}</b><span>${esc(k)}</span></div>`).join("")}</div>
      <p class="exp-s">${esc(e.s)}</p>
    </article>`).join("");

  const F = FACTS.family_share;
  const W = 420, H = 150, T = 22, B = 40, L = 12, R = 12;
  const segs = [["base", F.base, "var(--brand)"], ["velocity", F.velocity, "var(--ink-3)"], ["contagion", F.contagion, "var(--r2)"]];
  let x = L, body = "";
  segs.forEach(([n, v, c]) => {
    const w = v * (W - L - R);
    body += `<rect x="${x.toFixed(1)}" y="${T}" width="${(w - 2).toFixed(1)}" height="46" rx="7" fill="${c}"/>
      <text x="${(x + w / 2).toFixed(1)}" y="${T + 29}" text-anchor="middle" font-size="13" font-weight="600" fill="#fff" class="num">${(100 * v).toFixed(0)}%</text>
      <text x="${(x + w / 2).toFixed(1)}" y="${T + 66}" text-anchor="middle" font-size="11" fill="var(--ink-2)">${n}</text>`;
    x += w;
  });
  el("fam-chart").innerHTML = chart(W, H, body +
    `<text x="${L}" y="14" font-size="10.5" fill="var(--ink-3)">27 contagion features earn 37% of the model's total gain</text>`);

  const imp = Object.entries(FACTS.importance).slice(0, 9);
  const max = imp[0][1];
  const W3 = 420, rowH = 24, H3 = 14 + imp.length * rowH;
  el("imp-chart").innerHTML = chart(W3, H3, imp.map(([k, v], i) => {
    const y = 10 + i * rowH, w = (v / max) * (W3 - 170);
    const hot = k.includes("contagion");
    return `<rect x="164" y="${y}" width="${Math.max(w, 2).toFixed(1)}" height="14" rx="3" fill="${hot ? "var(--r2)" : "var(--brand)"}" opacity="${hot ? .9 : .45}"/>
      <text x="158" y="${y + 11}" text-anchor="end" font-size="10.5" font-family="IBM Plex Mono, monospace"
        fill="${hot ? "var(--r2)" : "var(--ink-2)"}" font-weight="${hot ? 600 : 400}">${esc(k)}</text>`;
  }).join(""));
}

/* ------------------------------------------------------ architecture page */
function initArch() {
  const W = 900, H = 210, L = 20, R = 20, T = 40, rowH = 34;
  const D = FACTS.data.splits;
  const X = d => L + (d / 182) * (W - L - R);
  const bands = [
    { a: 0, b: 105, c: "var(--brand)", t: "learns", o: .8 },
    { a: 105, b: 120, c: "var(--ink-3)", t: "stops early", o: .55 },
    { a: 120, b: 182, c: "var(--r2)", t: "scored, never fitted on", o: .85 },
  ];
  const modelRow = (y, label, spans) => {
    let s = `<text x="${L}" y="${y - 8}" font-size="11.5" font-weight="600" fill="var(--ink)">${label}</text>`;
    spans.forEach(sp => {
      s += `<rect x="${X(sp.a)}" y="${y}" width="${(X(sp.b) - X(sp.a) - 2).toFixed(1)}" height="22" rx="5"
        fill="${sp.c}" opacity="${sp.o}"/>`;
      if (X(sp.b) - X(sp.a) > 84)
        s += `<text x="${(X(sp.a) + X(sp.b)) / 2}" y="${y + 15}" text-anchor="middle" font-size="10.5"
          fill="#fff" font-weight="600">${sp.t}</text>`;
    });
    return s;
  };
  const ticks = [0, 75, 90, 105, 120, 150, 182].map(d =>
    `<line x1="${X(d)}" y1="${T - 12}" x2="${X(d)}" y2="${H - 34}" stroke="var(--edge-2)"/>
     <text x="${X(d)}" y="${H - 18}" text-anchor="middle" font-size="10" fill="var(--ink-3)">day ${d}</text>`).join("");
  el("proto-chart").innerHTML = `<figure class="fig"><svg viewBox="0 0 ${W} ${H}" role="img"
    aria-label="Two models are trained on different windows so that every scored period was never used for fitting or early stopping.">
    ${ticks}
    ${modelRow(T, "Model A  →  scores days 90–120", [
      { a: 0, b: 75, c: "var(--brand)", t: "learns", o: .8 },
      { a: 75, b: 90, c: "var(--ink-3)", t: "stops early", o: .5 },
      { a: 90, b: 120, c: "var(--r2)", t: "scored", o: .85 }])}
    ${modelRow(T + rowH * 2, "Model B  →  scores days 120–182", [
      { a: 0, b: 105, c: "var(--brand)", t: "learns", o: .8 },
      { a: 105, b: 120, c: "var(--ink-3)", t: "stops early", o: .5 },
      { a: 120, b: 182, c: "var(--r2)", t: "scored, never fitted on", o: .85 }])}
    ${modelRow(T + rowH * 4, "Policy", [
      { a: 90, b: 120, c: "var(--ok)", t: "evolved here", o: .75 },
      { a: 120, b: 182, c: "var(--ok)", t: "applied untouched", o: .35 }])}
    </svg><figcaption>Every period is scored by a model that never saw it in any capacity, including for early
    stopping. The policy is chosen on Model A's scores and applied to Model B's without further tuning.</figcaption></figure>`;

  const PATHS = [
    { n: 1, h: "As a streaming object", s: "The one most teams would actually use.",
      code: `<span class="kw">from</span> rzero.stream <span class="kw">import</span> ContagionState

state = ContagionState([<span class="st">"card"</span>, <span class="st">"address"</span>,
                        <span class="st">"email"</span>, <span class="st">"device"</span>])

<span class="c"># before you score, on every transaction</span>
f = state.observe(txn.timestamp, ids, amount=txn.amt)

<span class="c"># when a chargeback lands, days later</span>
state.confirm(fraud.timestamp, ids_of(fraud))`,
      note: `<b>44 extra columns</b> for the model you already have, at <b>70,000 transactions a second</b> in plain
        Python. <span class="mono">snapshot()</span> and <span class="mono">restore()</span> survive a restart.` },
    { n: 2, h: "As a sidecar service", s: "If your scoring path is not Python.",
      code: `$ uvicorn service:app

POST /score    <span class="c"># → features + risk</span>
POST /confirm  <span class="c"># → chargeback arrives</span>
GET  /health   <span class="c"># → events seen, identities alight</span>`,
      note: `About sixty lines of FastAPI over the same object. It runs beside your model rather than in front of
        it, so nothing in the decision path has to move while you evaluate it.` },
    { n: 3, h: "As columns in the warehouse", s: "The lowest-risk way to find out if it works.",
      code: `<span class="kw">from</span> rzero.features <span class="kw">import</span> build_features

X, fam = build_features(frame, day, is_fraud,
                        confirmation_delay_days=<span class="st">7.0</span>)
X[fam[<span class="st">"contagion"</span>]]   <span class="c"># 27 columns, join and retrain</span>`,
      note: `Run it over history, join, retrain, compare. No service, no new dependency in the payment path, and if
        the columns do not earn their place you drop them and nothing was disturbed.` },
    { n: 4, h: "As a portable model file", s: "Any language, no runtime.",
      code: `web/web_model.json
  features: [ <span class="st">"amount"</span>, <span class="st">"card_contagion_1h"</span>, ... ]
  trees:    [ { f, t, l, r }, ... ]   <span class="c"># 225 of them</span>`,
      note: `This page is the proof: it walks that exact file and lands within <b>2.22e-16</b> of LightGBM on all
        83,571 transactions. <span class="mono">node web/verify.js</span> checks it in under two seconds.` },
  ];
  el("paths").innerHTML = PATHS.map(p => `<article class="path">
    <div class="path-head"><span class="i">${p.n}</span><div><h4>${p.h}</h4><p>${p.s}</p></div></div>
    <code class="f">${p.code}</code><p class="path-note">${p.note}</p></article>`).join("");
}

/* ------------------------------------------------------------- model page */
const EXAMPLE_CSV = `timestamp,amount,card,address,email,device,isFraud
3600,249.00,4032,204,gmail.com,SM-G930V,0
7200,88.50,7781,325,yahoo.com,Windows,0
10800,19.99,9143,881,anonymous.com,Trident/7.0,1
11040,19.99,9207,881,anonymous.com,Trident/7.0,1
11280,24.50,9366,881,anonymous.com,Trident/7.0,1
11520,19.99,9143,881,anonymous.com,Trident/7.0,1
90000,64.20,4032,204,gmail.com,SM-G930V,0
176400,120.00,7781,325,yahoo.com,Windows,0
262800,31.00,5510,118,hotmail.com,MacOS,0
349200,74.00,4032,204,gmail.com,SM-G930V,0
435600,58.00,5510,118,hotmail.com,MacOS,0
522000,143.00,7781,325,yahoo.com,Windows,0
608400,92.00,4032,204,gmail.com,SM-G930V,0
619200,340.00,8815,325,yahoo.com,Windows,0
619800,320.00,6602,881,anonymous.com,Trident/7.0,1
702000,41.00,4032,204,gmail.com,SM-G930V,0`;

const LABELS = { timestamp: "Time", amount: "Amount", card: "Card", address: "Address",
                 email: "Email", device: "Device", label: "Outcome" };
let source = "sample", table = null, mapping = null, rawText = "";

function describe() {
  if (!table) { el("src-note").textContent = "your CSV"; return; }
  const known = FIELDS.filter(f => mapping[f] >= 0).length;
  el("src-note").textContent = `${fmtInt(table.rows.length)} rows · ${known} of 7 columns matched`;
}

function renderMapping() {
  const grid = el("map-grid");
  if (!table) { el("map-wrap").hidden = true; return; }
  el("map-wrap").hidden = false;
  el("has-header").checked = table.hasHeader;
  grid.innerHTML = FIELDS.map(f => `
    <div class="map-row ${mapping[f] < 0 ? "unset" : ""}">
      <label for="map-${f}">${LABELS[f]}</label>
      <select id="map-${f}" data-field="${f}">
        <option value="-1"${mapping[f] < 0 ? " selected" : ""}>not in my file</option>
        ${table.header.map((h, i) => `<option value="${i}"${mapping[f] === i ? " selected" : ""}>${esc(h)}</option>`).join("")}
      </select></div>`).join("");
  grid.querySelectorAll("select").forEach(sel => sel.addEventListener("change", () => {
    mapping[sel.dataset.field] = Number(sel.value);
    sel.closest(".map-row").classList.toggle("unset", Number(sel.value) < 0);
    describe();
  }));
  describe();
}

function load(text, name, forceHeader) {
  rawText = text;
  const parsed = sniff(text, forceHeader);
  if (parsed.error) {
    table = null; mapping = null;
    el("map-wrap").hidden = true; el("loaded").hidden = true;
    el("csv-err").textContent = parsed.error; el("csv-err").hidden = false;
    describe(); return false;
  }
  el("csv-err").hidden = true;
  table = parsed;
  mapping = guessMapping(parsed.header, !parsed.hasHeader);
  el("loaded").hidden = !name;
  if (name) {
    el("loaded-name").textContent = name;
    el("loaded-rows").textContent = parsed.truncated
      ? `${fmtInt(parsed.total)} rows, first ${fmtInt(MAX_ROWS)} used` : `${fmtInt(parsed.rows.length)} rows`;
  }
  renderMapping();
  return true;
}

function readFile(f) {
  if (f.size > 80 * 1024 * 1024) {
    el("csv-err").textContent = "That file is over 80 MB. Try a slice of it.";
    el("csv-err").hidden = false; return;
  }
  const reader = new FileReader();
  reader.onload = () => load(String(reader.result), f.name);
  reader.onerror = () => {
    el("csv-err").textContent = "Could not read that file.";
    el("csv-err").hidden = false;
  };
  reader.readAsText(f);
}

function initModelInputs() {
  document.querySelectorAll(".seg button").forEach(b => b.addEventListener("click", () => {
    source = b.dataset.src;
    document.querySelectorAll(".seg button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    ["sample", "simulate", "paste"].forEach(p => el("pane-" + p).hidden = p !== source);
    el("lag-field").hidden = source === "sample";
    if (source === "paste") describe();
    else el("src-note").textContent = source === "sample" ? "83,571 real transactions" : "synthetic stream";
  }));
  const syncLabels = () => {
    el("v-n").textContent = fmtInt(Number(el("s-n").value));
    el("v-rate").textContent = (Number(el("s-rate").value) / 10).toFixed(1) + "%";
    const r = Number(el("s-ring").value);
    el("v-ring").textContent = r === 1 ? "1 card (lone)" : r + " cards";
    const b = Number(el("s-burst").value);
    el("v-burst").textContent = b >= 60 ? (b / 60).toFixed(1) + " h" : b + " min";
  };
  ["s-n", "s-rate", "s-ring", "s-burst"].forEach(i => el(i).addEventListener("input", syncLabels));
  syncLabels();
  const LAGTEXT = { "0.0417": "1 hour", "0.25": "6 hours", "1": "1 day", "3": "3 days", "7": "7 days", "21": "21 days" };
  const syncLag = () => {
    const t = LAGTEXT[el("s-lag").value] || el("s-lag").value + " days";
    el("v-lag").textContent = t;
    el("lag-note").innerHTML = `Confirmed frauds enter the contagion state <b>${t}</b> after they occur.
      Nothing inside that window can influence a score.`;
  };
  el("s-lag").addEventListener("change", syncLag); syncLag();
  const LATTEXT = ["15 minutes", "1 hour", "4 hours", "12 hours", "1 day", "3 days", "1 week", "never (an automatic block)"];
  const syncDesk = () => {
    el("v-cap").textContent = el("s-cap").value + " / day";
    el("v-lat").textContent = LATTEXT[Number(el("s-lat").value)];
  };
  el("s-cap").addEventListener("input", syncDesk);
  el("s-lat").addEventListener("input", syncDesk);
  syncDesk();

  el("s-csv").value = EXAMPLE_CSV;
  load(EXAMPLE_CSV, null);
  let typing = null;
  el("s-csv").addEventListener("input", () => {
    clearTimeout(typing);
    typing = setTimeout(() => { el("loaded").hidden = true; load(el("s-csv").value, null); }, 250);
  });
  el("pick").addEventListener("click", () => el("file").click());
  el("file").addEventListener("change", e => {
    const f = e.target.files && e.target.files[0]; if (f) readFile(f); e.target.value = "";
  });
  el("has-header").addEventListener("change", e =>
    load(rawText, el("loaded").hidden ? null : el("loaded-name").textContent, e.target.checked));
  el("clear-file").addEventListener("click", () => {
    el("s-csv").value = EXAMPLE_CSV; el("loaded").hidden = true; load(EXAMPLE_CSV, null);
  });
  const drop = el("drop");
  ["dragenter", "dragover"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", e => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) readFile(f);
  });
  el("run").addEventListener("click", run);
}

function tiles(list) {
  el("tiles").innerHTML = list.map(t => `
    <div class="tile ${t.accent ? "hot" : ""}">
      <div class="k">${t.k}</div><div class="v num">${t.v}</div><div class="n">${t.n}</div></div>`).join("");
}

function stepState(n, state, note) {
  const box = el("step-" + n);
  box.className = "stepbox" + (state === "on" ? " on" : state === "done" ? " done" : "");
  el("s" + n).textContent = note;
}

function customerKeys(ds) {
  for (const j of [0, 1, 3, 2]) {
    let named = 0;
    for (let i = 0; i < ds.n; i++) if (ds.code[j][i] > 0) named++;
    if (named > ds.n * 0.5) {
      const out = new Array(ds.n);
      for (let i = 0; i < ds.n; i++) out[i] = ds.code[j][i] > 0 ? j + ":" + ds.code[j][i] : "row:" + i;
      return { keys: out, family: ENTS[j] };
    }
  }
  return { keys: Array.from({ length: ds.n }, (_, i) => "row:" + i), family: null };
}

function run() {
  const btn = el("run");
  btn.disabled = true;
  el("result-charts").hidden = true;
  el("result-table").hidden = true;
  el("queue-wrap").hidden = true;
  el("pip").className = "pip live";
  el("pip-text").textContent = "streaming";
  el("cal-out").hidden = true;
  stepState(1, "on", "running"); stepState(2, "", "waiting"); stepState(3, "", "waiting");

  const lag = Number(el("s-lag").value);
  let ds;
  if (source === "sample") ds = datasetFromPayload();
  else if (source === "simulate") ds = datasetFromRows(simulate(Number(el("s-n").value),
    Number(el("s-rate").value) / 1000, Number(el("s-ring").value), Number(el("s-burst").value)), lag);
  else ds = datasetFromRows(table ? rowsFrom(table, mapping) : [], lag);

  if (ds.n < 4) {
    el("pip").className = "pip"; el("pip-text").textContent = "need at least 4 rows";
    btn.disabled = false; return;
  }

  const engine = makeEngine(ds);
  const n = ds.n;
  let desk = null;
  const v = new Float64Array(MODEL.features.length);
  const pv = new Float64Array(NP);
  const scores = new Float64Array(n), plainScores = new Float64Array(n);
  const hotFam = new Int8Array(n), hotVal = new Float64Array(n);
  const NF = MODEL.features.length;
  const keepAll = n <= 400, keepTop = 40;
  const kept = new Map(), ranked = [];
  const remember = (row, score, vec) => {
    if (keepAll) { kept.set(row, Float32Array.from(vec)); return; }
    if (ranked.length < keepTop) {
      ranked.push({ row, score }); kept.set(row, Float32Array.from(vec));
    } else if (score > ranked[ranked.length - 1].score) {
      kept.delete(ranked.pop().row);
      ranked.push({ row, score }); kept.set(row, Float32Array.from(vec));
    } else return;
    ranked.sort((a, b) => b.score - a.score);
  };
  const pts = [];
  const entities = ds.vsize.reduce((a, s) => a + s - 1, 0);
  let i = 0, nfr = 0, peakAll = 0, engineMs = 0;
  let bf = 0, bnf = 0, bl = 0, bnl = 0, bc = 0;
  let sumF = 0, sumL = 0, cntF = 0, cntL = 0;
  const bucket = Math.max(1, Math.floor(n / 190));
  const stride = Math.max(60, Math.floor(n / 70));
  const t0 = ds.sec[0] / DAY;

  function chunk() {
    const end = Math.min(i + stride, n);
    const t0ms = performance.now();
    for (; i < end; i++) {
      const peak = engine.step(i, v);
      hotFam[i] = engine.hot.fam; hotVal[i] = engine.hot.share;
      scores[i] = evalTrees(MODEL.trees, v);
      for (let q = 0; q < NP; q++) pv[q] = v[plainIdx[q]];
      plainScores[i] = evalTrees(MODEL.plainTrees, pv);
      remember(i, scores[i], v);
      if (ds.y[i] === 1) { nfr++; engine.confirm(i); bc++; }
      if (peak > peakAll) peakAll = peak;
      if (ds.y[i] === 1) { bf += scores[i]; bnf++; sumF += scores[i]; cntF++; }
      else if (ds.y[i] === 0) { bl += scores[i]; bnl++; sumL += scores[i]; cntL++; }
      else { bl += scores[i]; bnl++; sumL += scores[i]; cntL++; }
      if (i % bucket === bucket - 1) {
        pts.push({ f: bnf ? bf / bnf : -1, l: bnl ? bl / bnl : -1, c: bc, d: ds.sec[i] / DAY - t0 });
        bf = bnf = bl = bnl = bc = 0;
      }
    }
    engineMs += performance.now() - t0ms;
    el("bar").style.width = (100 * i / n) + "%";
    drawLive(pts, true, ds.labelled);
    const sep = cntF && cntL && sumL > 0 ? (sumF / cntF) / (sumL / cntL) : 0;
    tiles([
      { k: "Transactions", v: fmtInt(i), n: "streamed so far" },
      { k: "Confirmed frauds", v: fmtInt(nfr), n: "queued into the contagion state" },
      { k: "Throughput", v: engineMs > 0 ? fmtInt(Math.round(1000 * i / engineMs)) + "/s" : "—", n: "features, decay and 374 trees, in this browser" },
      ds.labelled
        ? { k: "Separation", v: sep ? sep.toFixed(2) + "×" : "—", n: "mean score on fraud vs the rest", accent: true }
        : { k: "Peak intensity", v: peakAll.toFixed(3), n: "highest contagion seen", accent: true },
    ]);
    if (i < n) requestAnimationFrame(chunk); else { stepState(1, "done", fmtInt(n) + " scored"); calibrateThen(); }
  }

  function calibrateThen() {
    const capacity = Number(el("s-cap").value);
    const LATS = [0.25, 1, 4, 12, 24, 72, 168, 24 * 365];
    const latency = LATS[Number(el("s-lat").value)];
    if (!ds.labelled) {
      stepState(2, "done", "no outcomes");
      el("s2n").textContent = "No outcomes were supplied, so no analyst verdicts can come back. "
        + "The queue below is still ranked; the desk simply has nobody to learn from.";
      desk = null;
      finish(); return;
    }
    stepState(2, "on", "allocating");
    setTimeout(() => {
      desk = runDesk(ds, scores, capacity, latency);
      renderDesk();
      stepState(2, "done", fmtInt(desk.stopped) + " sent to review");
      finish();
    }, 40);
  }

  function renderDesk() {
    const d = desk;
    const perDay = d.stopped / d.span;
    const withinBudget = perDay <= d.capacity * 1.02;
    el("s2n").innerHTML = `Over ${d.span.toFixed(0)} days the desk sent
      <b>${fmtInt(d.stopped)}</b> customers to a human, <b>${perDay.toFixed(1)} a day</b> against a
      capacity of ${d.capacity}. Nothing here was calibrated: the ceiling is the capacity you set,
      and the damage a mistake can do is capped by how fast somebody looks at it.`;
    el("cal-out").innerHTML = `<div class="calgrid">
      <div><b>${d.innocentPerDay.toFixed(2)}</b><span>innocent customers stopped per day</span></div>
      <div class="${d.txnShare > 0.01 ? "hot" : ""}"><b>${(100 * d.txnShare).toFixed(3)}%</b><span>of their transactions actually blocked</span></div>
      <div><b>${fmtInt(d.worst)}</b><span>worst case, one customer</span></div>
      <div><b>${(100 * d.recall).toFixed(1)}%</b><span>fraudulent customers caught</span></div>
      </div>
      <p class="hint" style="margin-top:11px">Worst case by arithmetic:
      ${d.latencyHours}h &#215; ${fmtInt(d.span ? ds.n / d.span : 0)} transactions/day =
      <span class="mono">${fmtInt(Math.ceil(d.bound))}</span> transactions, and the measured worst
      was <span class="mono">${fmtInt(d.worst)}</span>. On our own held-out month the old sequential
      test put <span class="mono">1,172</span> transactions of one innocent customer on the floor,
      because a block with no human behind it never ends.</p>`;
    el("cal-out").hidden = false;
  }

  function detailFor(row) {
    const vec = kept.get(row);
    const num = x => x < 0 ? "—" : x >= 100 ? x.toFixed(0) : x >= 1 ? x.toFixed(2) : x.toFixed(4);
    const dur = d => d < 0 ? "—" : d < 1 / 24 ? (d * 1440).toFixed(0) + " min"
      : d < 1 ? (d * 24).toFixed(1) + " h" : d.toFixed(1) + " d";
    const rows = ENTS.map((e, j) => {
      const g = SLOT[j], seen = vec[g.count];
      const key = ds.keys ? ds.keys[j][ds.code[j][row]] : "—";
      return `<tr>
        <th scope="row">${e}<span class="mono idk" title="${esc(key)}">${esc(key)}</span></th>
        <td class="r mono">${seen < 0 ? "unknown" : fmtInt(seen)}</td>
        <td class="r mono">${dur(vec[g.age])}</td>
        <td class="r mono">${dur(vec[g.gap])}</td>
        ${g.con.map(c => `<td class="r mono ${vec[c] > 0 ? "lit" : ""}">${num(vec[c])}</td>`).join("")}
      </tr>`;
    }).join("");
    return `<div class="scroll"><table class="inner">
      <thead><tr><th>Identity</th><th class="r">Seen before</th><th class="r">Known for</th>
      <th class="r">Last seen</th><th class="r">Contagion 1h</th><th class="r">1d</th><th class="r">7d</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <p class="detail-note">Amount ₹${fmtInt(Math.round(ds.amt[row] * COST.usd))} ·
      ${String(Math.floor(vec[SH])).padStart(2, "0")}:${String(Math.floor((vec[SH] % 1) * 60)).padStart(2, "0")} · every number above was computed from transactions
      that had already happened and frauds that had already been confirmed.</p></div>`;
  }

  function finish() {
    el("pip").className = "pip"; el("pip-text").textContent = "complete";
    stepState(3, "done", "ranked");
    if (bnf || bnl) pts.push({ f: bnf ? bf / bnf : -1, l: bnl ? bl / bnl : -1, c: bc, d: ds.sec[n - 1] / DAY - t0 });
    drawLive(pts, false, ds.labelled);
    const warm = Math.floor(n * ds.warm);
    const live = [];
    for (let k = warm; k < n; k++) live.push(k);
    const depths = [50, 100, 250, 500, 1000].filter(d => d <= live.length);
    if (!depths.length) depths.push(Math.max(1, Math.floor(live.length / 2)));

    if (!ds.labelled) {
      const top = live.slice().sort((a, b) => scores[b] - scores[a]);
      tiles([
        { k: "Transactions", v: fmtInt(n), n: "scored" },
        { k: "Flagged at 1%", v: fmtInt(Math.max(1, Math.round(n * .01))), n: "highest-risk transactions" },
        { k: "Top score", v: scores[top[0]].toFixed(3), n: "model probability" },
        { k: "Precision", v: "n/a", n: "no outcomes supplied to score against", accent: true },
      ]);
      el("check").innerHTML = "";
      btn.disabled = false; return;
    }

    const y = ds.y;
    const nf = live.reduce((a, k) => a + (y[k] === 1 ? 1 : 0), 0);
    const base = nf / live.length;
    const rank = arr => live.slice().sort((a, b) => arr[b] - arr[a]);
    const ord = rank(scores), ordP = rank(plainScores);
    const prec = depths.map(d => ord.slice(0, d).reduce((a, k) => a + (y[k] === 1 ? 1 : 0), 0) / d);
    const precPlain = depths.map(d => ordP.slice(0, d).reduce((a, k) => a + (y[k] === 1 ? 1 : 0), 0) / d);
    const ap = o => {
      let hits = 0, sum = 0;
      o.forEach((k, r) => { if (y[k] === 1) { hits++; sum += hits / (r + 1); } });
      return sum / Math.max(nf, 1);
    };
    const prAuc = ap(ord), prAucP = ap(ordP);
    const at100 = depths.indexOf(100) >= 0 ? depths.indexOf(100) : Math.min(1, depths.length - 1);

    const cap = Math.max(1, Math.round(live.length * 0.10));
    const bset = new Set(ord.slice(0, Math.max(1, Math.round(live.length * 0.01))));
    const rset = new Set(ord.slice(0, cap));
    let prevented = 0, fb = 0, revCost = 0, exposure = 0;
    for (const k of live) {
      const val = ds.amt[k] * COST.usd + COST.fee;
      if (y[k] === 1) exposure += val;
      if (bset.has(k)) { if (y[k] === 1) prevented += val; else fb++; }
      else if (rset.has(k)) { revCost += COST.review; if (y[k] === 1) prevented += COST.catch * val; }
    }
    const net = prevented - revCost - fb * COST.falseBlock;

    const hotMax = live.reduce((a, k) => Math.max(a, hotVal[k]), 0);
    tiles(live.length >= 200 ? [
      { k: "Scored", v: fmtInt(live.length), n: fmtInt(nf) + " fraudulent · " + (100 * base).toFixed(2) + "% base rate · " + fmtInt(Math.round(1000 * n / Math.max(engineMs, 1e-6))) + " txn/s" },
      { k: "Precision, top " + fmtInt(depths[at100]), v: prec[at100].toFixed(2), n: "share genuinely fraudulent" },
      { k: "PR-AUC", v: prAuc.toFixed(4), n: "vs " + prAucP.toFixed(4) + " with contagion deleted · " + (prAuc / Math.max(base, 1e-9)).toFixed(1) + "× the base rate" },
      { k: "Net saved", v: money(net), n: "of " + money(exposure) + " exposed", accent: true },
    ] : [
      { k: "Streamed", v: fmtInt(n), n: fmtInt(nf) + " confirmed fraudulent" },
      { k: "Throughput", v: engineMs > 0 ? fmtInt(Math.round(1000 * n / engineMs)) + "/s" : "—", n: "features, decay and 374 trees, in this browser" },
      { k: "Identities alight", v: fmtInt(engine.live()), n: "carrying live contagion at the end" },
      { k: "Hottest neighbourhood", v: hotMax > 0 ? (100 * hotMax).toFixed(0) + "%" : "—", n: "highest share of an identity's week that was confirmed fraud", accent: true },
    ]);

    const meaningful = live.length >= 200;
    el("result-charts").hidden = !meaningful;
    el("result-table").hidden = !meaningful;
    if (meaningful) {
    drawPrecision({ depths, prec, precPlain, baseRate: base });
    drawDist({
      fraudScores: live.filter(k => y[k] === 1).map(k => scores[k]),
      legitScores: live.filter(k => y[k] !== 1).map(k => scores[k]),
    });
    el("result-table").innerHTML = `<div class="scroll"><table>
      <thead><tr><th>Queue depth</th><th class="r">With contagion</th><th class="r">Contagion removed</th><th class="r">Random</th><th class="r">Lift over random</th></tr></thead>
      <tbody>${depths.map((d, k) => `<tr class="${k === at100 ? "win" : ""}">
        <td>top ${fmtInt(d)}</td><td class="r">${prec[k].toFixed(3)}</td>
        <td class="r">${precPlain[k].toFixed(3)}</td><td class="r">${base.toFixed(3)}</td>
        <td class="r">${(prec[k] / Math.max(base, 1e-9)).toFixed(1)}×</td></tr>`).join("")}
        <tr><td>PR-AUC (all depths)</td><td class="r">${prAuc.toFixed(4)}</td>
        <td class="r">${prAucP.toFixed(4)}</td><td class="r">${base.toFixed(4)}</td>
        <td class="r">${(prAuc / Math.max(base, 1e-9)).toFixed(1)}×</td></tr>
      </tbody></table></div>`;
    }

    const q = meaningful ? ord.slice(0, 12) : live.slice(0, 24);
    const when = k => {
      const dd = (ds.sec[k] - ds.sec[0]) / DAY;
      return dd >= 1 ? "day " + dd.toFixed(2) : (dd * 24).toFixed(2) + " h";
    };
    el("queue").innerHTML = `<div class="scroll"><table>
      <thead><tr><th>#</th><th>When</th><th class="r">Amount</th><th>Card</th>
      <th>Hottest identity</th><th class="r">Fraud share, 7d</th><th class="r">Score</th>
      <th class="r">Without contagion</th><th class="r">Outcome</th></tr></thead>
      <tbody>${q.map((k, r) => `<tr class="row ${kept.has(k) ? "open" : ""}" data-row="${k}" data-rank="${r}"${kept.has(k) ? ' tabindex="0" role="button" aria-expanded="false"' : ""}>
        <td class="mono">${r + 1}</td><td>${when(k)}</td>
        <td class="r">₹${fmtInt(Math.round(ds.amt[k] * COST.usd))}</td>
        <td class="mono">${esc(ds.keys[0][ds.code[0][k]])}</td>
        <td>${hotFam[k] >= 0 ? ENTS[hotFam[k]] + " <span class=\"mono idk\" title=\"" + esc(ds.keys[hotFam[k]][ds.code[hotFam[k]][k]]) + "\">" + esc(ds.keys[hotFam[k]][ds.code[hotFam[k]][k]]) + "</span>" : "<span style=\"color:var(--ink-3)\">none alight</span>"}</td>
        <td class="r mono">${hotVal[k] > 0 ? (100 * hotVal[k]).toFixed(1) + "%" : "—"}</td>
        <td class="r"><b>${scores[k].toFixed(3)}</b></td>
        <td class="r" style="color:var(--ink-3)">${plainScores[k].toFixed(3)}</td>
        <td class="r">${y[k] === 1 ? '<span class="chip hit">fraud</span>' : y[k] === 0 ? '<span class="chip miss">legit</span>' : "—"}</td>
      </tr>${kept.has(k) ? `<tr class="detail" id="detail-${r}" hidden><td colspan="9">${detailFor(k)}</td></tr>` : ""}`).join("")}</tbody></table></div>`;
    el("queue").querySelectorAll("tr.row.open").forEach(tr => {
      const toggle = () => {
        const d = el("detail-" + tr.dataset.rank);
        d.hidden = !d.hidden;
        tr.setAttribute("aria-expanded", String(!d.hidden));
        tr.classList.toggle("expanded", !d.hidden);
      };
      tr.addEventListener("click", toggle);
      tr.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
      });
    });
    el("queue-note").textContent = meaningful
      ? "the twelve highest-risk transactions, and the identity that lit each one up"
      : "every transaction in time order — watch the contagion column wake up";
    el("queue-wrap").hidden = false;

    if (!meaningful) {
      el("check").innerHTML = `<p class="note warn" style="margin-top:22px"><strong>Too few rows
        to measure anything.</strong> ${fmtInt(n)} transactions are enough to watch the mechanism
        work — the queue above shows which identity lit each transaction up, and how much of that
        identity's week had already been confirmed fraudulent. They are nowhere near enough for a
        precision number to mean anything, and the model was trained where a card has been seen
        dozens of times, so scores on a handful of invented rows sit outside everything it has
        seen. Paste a few thousand real rows, or use the simulator, and the charts come back.</p>`;
      btn.disabled = false; return;
    }

    if (ds.ref) {
      const d1 = Math.abs(prAuc - ds.ref.full.pr), d2 = Math.abs(prec[at100] - ds.ref.full.p100);
      const ok = d1 < 5e-4 && d2 < 5e-4;
      el("check").innerHTML = `<p class="note ${ok ? "" : "warn"}" style="margin-top:22px">
        <strong>${ok ? "Reproduced." : "Diverged."}</strong> The reference run of this model —
        Python, LightGBM, offline — scores this exact window at PR-AUC
        <span class="mono">${ds.ref.full.pr.toFixed(4)}</span> and top-100 precision
        <span class="mono">${ds.ref.full.p100.toFixed(2)}</span>.
        Your browser just computed <span class="mono">${prAuc.toFixed(4)}</span> and
        <span class="mono">${prec[at100].toFixed(2)}</span> from the raw stream.
        ${ok ? "Nothing on this page is replayed from a cache." : "That gap is a bug, not a rounding difference."}</p>`;
    } else {
      el("check").innerHTML = `<p class="note" style="margin-top:22px"><strong>Cold start.</strong>
        This stream begins with an empty entity table, so the first
        ${(100 * ds.warm).toFixed(0)}% is used to warm it and is excluded from the scores above —
        a model that has never seen a card cannot know its neighbours.</p>`;
    }
    btn.disabled = false;
  }
  requestAnimationFrame(chunk);
}

/* ------------------------------------------------------------------- boot */
initModelInputs();
initBranching(); initDecay(); initPopularity(); initGraph();
initLag(); initLatency(); initPareto(); initQueue();
onShow.data = initData;
onShow.experiments = initExperiments;
onShow.architecture = initArch;

(function showcase() {
  const ds = datasetFromPayload();
  const engine = makeEngine(ds);
  const v = new Float64Array(MODEL.features.length);
  const rows = [];
  const want = new Set([400, 900, 1500, 2600, 4200, 6000]);
  for (let i = 0; i < 6100 && i < ds.n; i++) {
    engine.step(i, v);
    const sc = evalTrees(MODEL.trees, v);
    if (want.has(i)) rows.push({ i, v: Float64Array.from(v), score: sc });
    if (ds.y[i] === 1) engine.confirm(i);
  }
  SHOWCASE = rows;
})();
initTree();
tiles([
  { k: "Transactions", v: "—", n: "press run to start the stream" },
  { k: "Precision, top 100", v: "—", n: "share genuinely fraudulent" },
  { k: "PR-AUC", v: "—", n: "against the base rate" },
  { k: "Net saved", v: "—", n: "after review and friction costs" },
]);
show(location.hash.slice(1) || "home");
