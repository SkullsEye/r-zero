
function makeHeap() {
  const at = [], fam = [], ent = [], wt = [];
  const swap = (i, j) => {
    let x = at[i]; at[i] = at[j]; at[j] = x;
    x = fam[i]; fam[i] = fam[j]; fam[j] = x;
    x = ent[i]; ent[i] = ent[j]; ent[j] = x;
    x = wt[i]; wt[i] = wt[j]; wt[j] = x;
  };
  return {
    size: () => at.length,
    top: () => at[0],
    push(a, f, e, w) {
      at.push(a); fam.push(f); ent.push(e); wt.push(w);
      let i = at.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (at[p] <= at[i]) break; swap(p, i); i = p; }
    },
    pop(out) {
      out.at = at[0]; out.fam = fam[0]; out.ent = ent[0]; out.w = wt[0];
      const n = at.length - 1;
      swap(0, n); at.pop(); fam.pop(); ent.pop(); wt.pop();
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < n && at[l] < at[m]) m = l;
        if (r < n && at[r] < at[m]) m = r;
        if (m === i) break;
        swap(m, i); i = m;
      }
      return out;
    }
  };
}

function datasetFromRows(rows, lag) {
  rows.sort((a, b) => a[0] - b[0]);
  const n = rows.length;
  const sec = new Float64Array(n), amt = new Float64Array(n), y = new Int8Array(n);
  const code = ENTS.map(() => new Int32Array(n));
  const maps = ENTS.map(() => new Map());
  const counts = ENTS.map(() => [0]);
  const keys = ENTS.map(() => ["—"]);
  let labelled = false;
  for (let i = 0; i < n; i++) {
    sec[i] = rows[i][0]; amt[i] = rows[i][1]; y[i] = rows[i][6];
    if (rows[i][6] >= 0) labelled = true;
    for (let j = 0; j < ENTS.length; j++) {
      const k = rows[i][2 + j];
      if (k === undefined || k === null || k === "") { code[j][i] = 0; continue; }
      let c = maps[j].get(k);
      if (c === undefined) { c = counts[j].length; maps[j].set(k, c); counts[j].push(0); keys[j].push(k); }
      code[j][i] = c; counts[j][c]++;
    }
  }
  return {
    n, sec, amt, y, code, seed: null, pending: null, labelled, keys, lag,
    warm: rows.length >= 500 ? WARMUP : 0,
    vsize: counts.map(c => c.length), deg: counts.map(c => Float64Array.from(c)),
    seeded: false, t0: 0,
  };
}

function datasetFromPayload() {
  const C = PAY.cols, n = PAY.n;
  const su = unb64(C.sec, Uint32Array), au = unb64(C.amt, Uint32Array);
  const sec = new Float64Array(n), amt = new Float64Array(n);
  for (let i = 0; i < n; i++) { sec[i] = su[i]; amt[i] = au[i] / 1000; }
  const y = Int8Array.from(unb64(C.y, Uint8Array));
  const code = ENTS.map(e => Int32Array.from(
    PAY.vocab[e].length > 254 ? unb64(C[e], Uint16Array) : unb64(C[e], Uint8Array)));
  const seed = ENTS.map(e => {
    const s = PAY.seed[e];
    return {
      cnt: Float64Array.from(unb64(s.cnt, Uint32Array)),
      tot: unb64(s.tot, Float64Array),
      first: unb64(s.first, Int32Array), prev: unb64(s.prev, Int32Array),
      act: unb64(s.act, Float64Array), acc: unb64(s.acc, Float64Array),
      deg: Float64Array.from(unb64(s.deg, Uint32Array)),
    };
  });
  const p = PAY.pending;
  return {
    n, sec, amt, y, code, seed, labelled: true, warm: 0, seeded: true,
    pending: {
      at: unb64(p.at, Float64Array), fam: unb64(p.fam, Uint8Array),
      ent: unb64(p.ent, Uint32Array), w: unb64(p.w, Float64Array),
    },
    vsize: ENTS.map(e => PAY.vocab[e].length + 1),
    deg: seed.map(s => s.deg),
    keys: ENTS.map(e => ["—"].concat(PAY.vocab[e])),
    t0: PAY.t0Sec / DAY, ref: PAY.ref,
  };
}

function makeEngine(ds) {
  const F = ENTS.length, T0 = ds.t0 || 0;
  const S = [];
  for (let j = 0; j < F; j++) {
    const V = ds.vsize[j];
    const s = {
      cnt: new Float64Array(V), tot: new Float64Array(V),
      first: new Float64Array(V), prev: new Float64Array(V),
      act: new Float64Array(V * NR), acc: new Float64Array(V * NR),
      aT: new Float64Array(V), cT: new Float64Array(V),
    };
    s.first.fill(-1); s.prev.fill(-1);
    if (ds.seed) {
      const z = ds.seed[j];
      s.cnt.set(z.cnt); s.tot.set(z.tot); s.act.set(z.act); s.acc.set(z.acc);
      for (let c = 0; c < V; c++) {
        s.first[c] = z.first[c] < 0 ? -1 : z.first[c] / DAY;
        s.prev[c] = z.prev[c] < 0 ? -1 : z.prev[c] / DAY;
      }
      s.aT.fill(T0); s.cT.fill(T0);
    }
    S.push(s);
  }
  const heap = makeHeap(), slot = { at: 0, fam: 0, ent: 0, w: 0 };
  const lag = ds.lag === undefined ? LAG : ds.lag;
  if (ds.pending) {
    for (let i = 0; i < ds.pending.at.length; i++)
      heap.push(ds.pending.at[i] / DAY, ds.pending.fam[i], ds.pending.ent[i], ds.pending.w[i]);
  }
  const dj = [], dc = [], hot = { fam: -1, val: 0, share: 0 };
  let cur = -1;

  function drain() {
    for (let i = 0; i < dj.length; i++) {
      const s = S[dj[i]], b = dc[i] * NR;
      for (let k = 0; k < NR; k++) s.act[b + k] += 1;
    }
    dj.length = 0; dc.length = 0;
  }

  return {
    state: S,
    hot,
    live() {
      let n = 0;
      for (let j = 0; j < F; j++) {
        const s = S[j];
        for (let c = 1; c < ds.vsize[j]; c++) if (s.acc[c * NR + 2] > 1e-4) n++;
      }
      return n;
    },
    step(i, v) {
      const t = ds.sec[i] / DAY, a = ds.amt[i];
      if (t !== cur) { drain(); cur = t; }
      while (heap.size() && heap.top() < t) {
        const p = heap.pop(slot), s = S[p.fam], b = p.ent * NR;
        const dt = p.at - s.cT[p.ent];
        if (dt > 0) {
          for (let k = 0; k < NR; k++) s.acc[b + k] *= Math.exp(-RATES[k] * dt);
          s.cT[p.ent] = p.at;
        }
        for (let k = 0; k < NR; k++) s.acc[b + k] += p.w;
      }
      v[SA] = a;
      v[SL] = Math.log1p(Math.max(a, 0));
      v[SF] = Math.round((a - Math.floor(a)) * 1000) / 1000;
      v[SH] = (t * 24) % 24;
      let peak = 0;
      hot.fam = -1; hot.val = 0; hot.share = 0;
      for (let j = 0; j < F; j++) {
        const g = SLOT[j], c = ds.code[j][i], s = S[j];
        if (c <= 0) {
          v[g.count] = -1; v[g.mean] = -1; v[g.age] = -1; v[g.gap] = -1; v[g.avm] = -1;
          for (let k = 0; k < NR; k++) { v[g.act[k]] = 0; v[g.con[k]] = 0; }
          continue;
        }
        const b = c * NR;
        let dt = t - s.aT[c];
        if (dt > 0) {
          for (let k = 0; k < NR; k++) s.act[b + k] *= Math.exp(-RATES[k] * dt);
          s.aT[c] = t;
        }
        dt = t - s.cT[c];
        if (dt > 0) {
          for (let k = 0; k < NR; k++) s.acc[b + k] *= Math.exp(-RATES[k] * dt);
          s.cT[c] = t;
        }
        const cnt = s.cnt[c], mean = cnt > 0 ? s.tot[c] / cnt : -1;
        v[g.count] = cnt;
        v[g.mean] = mean;
        v[g.age] = s.first[c] >= 0 ? t - s.first[c] : -1;
        v[g.gap] = s.prev[c] >= 0 ? t - s.prev[c] : -1;
        v[g.avm] = mean > 0 ? a / mean : -1;
        for (let k = 0; k < NR; k++) {
          v[g.act[k]] = s.act[b + k];
          v[g.con[k]] = s.acc[b + k];
        }
        const con = s.acc[b + NR - 1], share = con / (s.act[b + NR - 1] + 1);
        if (con > peak) peak = con;
        if (share > hot.share) { hot.fam = j; hot.val = con; hot.share = share; }
        s.cnt[c] = cnt + 1; s.tot[c] += a;
        if (s.first[c] < 0) s.first[c] = t;
        s.prev[c] = t;
        dj.push(j); dc.push(c);
      }
      return peak;
    },
    confirm(i) {
      const t = ds.sec[i] / DAY;
      for (let j = 0; j < F; j++) {
        const c = ds.code[j][i];
        if (c > 0) heap.push(t + lag, j, c, 1 / Math.log(ds.deg[j][c] + 5));
      }
    }
  };
}

const SYNONYMS = {
  timestamp: ["timestamp", "time", "datetime", "date", "created_at", "createdat",
              "transactiondt", "txn_time", "ts", "event_time", "occurred_at"],
  amount: ["amount", "amt", "value", "transactionamt", "price", "total",
           "order_value", "txn_amount"],
  card: ["card", "card1", "card_id", "cardid", "cardnumber", "card_number",
         "pan", "account", "account_id", "customer", "customer_id", "user_id"],
  address: ["address", "addr", "addr1", "billing", "billing_address", "zip",
            "zipcode", "postcode", "pincode", "city"],
  email: ["email", "emaildomain", "p_emaildomain", "email_domain", "mail",
          "domain", "email_address"],
  device: ["device", "deviceinfo", "device_info", "device_id", "useragent",
           "user_agent", "ua", "fingerprint", "browser"],
  label: ["isfraud", "is_fraud", "fraud", "label", "target", "class",
          "chargeback", "is_chargeback", "outcome"],
};
const FIELDS = ["timestamp", "amount", "card", "address", "email", "device", "label"];
const MAX_ROWS = 300000;

function splitLine(line, delimiter) {
  const out = [];
  let cell = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; }
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) { out.push(cell); cell = ""; }
    else cell += c;
  }
  out.push(cell);
  return out.map(s => s.trim());
}

function sniff(text, forceHeader) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter(l => l.trim().length);
  if (!lines.length) return { error: "That file has no rows in it." };
  const delimiter = [",", ";", "\t", "|"]
    .map(d => ({ d, n: splitLine(lines[0], d).length }))
    .sort((a, b) => b.n - a.n)[0].d;
  const first = splitLine(lines[0], delimiter);
  const numeric = c => c !== "" && Number.isFinite(Number(c));
  const sample = lines.slice(1, 51).map(l => splitLine(l, delimiter));
  let hasHeader;
  if (!sample.length) {
    hasHeader = !first.some(numeric);
  } else {
    let agrees = 0;
    first.forEach((cell, i) => {
      const seen = sample.filter(r => r[i] !== undefined && r[i] !== "");
      if (!seen.length) { agrees++; return; }
      const mostlyNumeric = seen.filter(r => numeric(r[i])).length > seen.length / 2;
      if (numeric(cell) === mostlyNumeric) agrees++;
    });
    hasHeader = agrees < first.length;
  }
  if (forceHeader !== undefined && forceHeader !== null) hasHeader = !!forceHeader;
  const header = hasHeader ? first : first.map((_, i) => "column " + (i + 1));
  const body = lines.slice(hasHeader ? 1 : 0);
  if (!body.length) return { error: "That file has a header but no data rows." };
  const truncated = body.length > MAX_ROWS;
  const rows = (truncated ? body.slice(0, MAX_ROWS) : body).map(l => splitLine(l, delimiter));
  return { header, rows, hasHeader, delimiter, truncated, total: body.length };
}

function guessMapping(header, positional) {
  if (positional) {
    const mapping = {};
    FIELDS.forEach((f, i) => { mapping[f] = i < header.length ? i : -1; });
    return mapping;
  }
  const norm = header.map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const used = new Set();
  const mapping = {};
  for (const field of FIELDS) {
    let best = -1, bestRank = 1e9;
    SYNONYMS[field].forEach((syn, rank) => {
      const key = syn.replace(/[^a-z0-9]/g, "");
      norm.forEach((h, i) => {
        if (used.has(i)) return;
        const score = h === key ? rank : h.includes(key) || key.includes(h) ? rank + 40 : -1;
        if (score >= 0 && score < bestRank) { bestRank = score; best = i; }
      });
    });
    if (best >= 0) { mapping[field] = best; used.add(best); }
    else mapping[field] = -1;
  }
  return mapping;
}

function parseTime(raw, index) {
  const n = Number(raw);
  if (raw !== "" && Number.isFinite(n)) return n > 3e10 ? n / 1000 : n;
  const t = Date.parse(raw);
  if (Number.isFinite(t)) return t / 1000;
  return index;
}

function parseAmount(raw) {
  let v = String(raw).trim().replace(/[^0-9.,\-]/g, "");
  if (/^-?\d{1,3}(\.\d{3})+,\d{1,2}$/.test(v)) v = v.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d+,\d{1,2}$/.test(v)) v = v.replace(",", ".");
  else v = v.replace(/,/g, "");
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const TRUE_WORDS = new Set(["1", "true", "yes", "y", "fraud", "chargeback", "bad"]);
const FALSE_WORDS = new Set(["0", "false", "no", "n", "legit", "legitimate", "good", "ok"]);

function parseLabel(raw) {
  if (raw === undefined || raw === "") return -1;
  const v = String(raw).trim().toLowerCase();
  if (TRUE_WORDS.has(v)) return 1;
  if (FALSE_WORDS.has(v)) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? (n ? 1 : 0) : -1;
}

function rowsFrom(parsed, mapping) {
  const at = f => mapping[f];
  const cell = (r, f) => (at(f) >= 0 && r[at(f)] !== undefined ? r[at(f)] : "");
  const out = [];
  parsed.rows.forEach((r, i) => {
    const ts = parseTime(cell(r, "timestamp"), i);
    if (!Number.isFinite(ts)) return;
    out.push([ts, parseAmount(cell(r, "amount")),
      cell(r, "card"), cell(r, "address"), cell(r, "email"), cell(r, "device"),
      parseLabel(cell(r, "label"))]);
  });
  return out;
}

function parseCSV(text) {
  const parsed = sniff(text);
  if (parsed.error) return [];
  return rowsFrom(parsed, guessMapping(parsed.header, !parsed.hasHeader));
}

function simulate(n, rate, ring, burstMin) {
  const rng = (s => () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)(20260901);
  const rows = [], span = 40 * DAY;
  const devices = ["iOS 14.2", "Windows", "SM-G973F", "MacOS", "SM-A505F", "Trident/7.0"];
  const mails = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "anonymous.com"];
  const nFraud = Math.round(n * rate);
  const nRings = Math.max(1, Math.round(nFraud / Math.max(ring * 3, 1)));
  const legit = n - nFraud;
  for (let i = 0; i < legit; i++) {
    rows.push([Math.floor(rng() * span), Math.round((10 + rng() * rng() * 900) * 100) / 100,
      "c" + Math.floor(rng() * 4000), "a" + Math.floor(rng() * 300),
      mails[Math.floor(rng() * mails.length)], devices[Math.floor(rng() * devices.length)], 0]);
  }
  let made = 0;
  for (let r = 0; r < nRings && made < nFraud; r++) {
    const cards = Array.from({ length: ring }, (_, k) => "R" + r + "c" + k);
    const dev = "R" + r + "dev", addr = "R" + r + "addr";
    const start = Math.floor(rng() * span * 0.92);
    const burst = burstMin * 60;
    const size = Math.min(nFraud - made, Math.max(2, Math.round(ring * 3 + rng() * ring * 3)));
    for (let k = 0; k < size; k++) {
      rows.push([Math.floor(start + rng() * burst * (1 + k * 0.35)),
        Math.round((20 + rng() * 1400) * 100) / 100,
        cards[Math.floor(rng() * cards.length)], addr,
        rng() < 0.7 ? "anonymous.com" : mails[Math.floor(rng() * mails.length)],
        rng() < 0.8 ? dev : devices[Math.floor(rng() * devices.length)], 1]);
      made++;
    }
  }
  return rows.sort((a, b) => a[0] - b[0]);
}
