
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
