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
