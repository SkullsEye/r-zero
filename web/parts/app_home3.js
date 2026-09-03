
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
