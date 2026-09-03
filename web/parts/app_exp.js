
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
