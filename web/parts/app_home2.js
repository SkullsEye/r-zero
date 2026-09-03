
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
