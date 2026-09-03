
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
