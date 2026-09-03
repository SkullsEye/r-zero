
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
