
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
