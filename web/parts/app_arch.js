
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
