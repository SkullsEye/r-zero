
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
