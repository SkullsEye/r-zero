import base64
import json
import os
import re
import sys

import lightgbm as lgb
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = HERE
DATA = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "data", "ieee_slim.csv")
sys.path.insert(0, os.path.join(HERE, ".."))

from sklearn.metrics import average_precision_score, roc_auc_score

from rzero.contagion import decayed_history, entity_history
from rzero.entities import encode_entity, popularity_weights

RATES = np.array([np.log(2)/(1/24), np.log(2)/1.0, np.log(2)/7.0])
NAMES = ["1h", "1d", "7d"]
ENTS = ["card", "address", "email", "device"]
SRC = {"card": "card1", "address": "addr1", "email": "P_emaildomain", "device": "DeviceInfo"}
LAG = 7.0
W_LO, W_HI = 120.0, 150.0

raw = pd.read_csv(DATA, low_memory=False)
t0 = raw.TransactionDT.min()
sec = (raw.TransactionDT.values - t0).astype(np.int64)
day = sec / 86400.0
amt = raw.TransactionAmt.values.astype(float)
y = raw.isFraud.values.astype(int)
d = pd.DataFrame({e: raw[SRC[e]].astype("string") for e in ENTS})

cols, names = {}, []
cols["amount"] = amt
cols["amount_log"] = np.log1p(np.maximum(amt, 0))
cols["amount_fraction"] = np.round(amt - np.floor(amt), 3)
cols["hour_of_day"] = (day * 24) % 24
names += ["amount", "amount_log", "amount_fraction", "hour_of_day"]

CODE, NENT, WT = {}, {}, {}
for e in ENTS:
    code, n = encode_entity(d, [e])
    CODE[e], NENT[e] = code, n
    hist = entity_history(day, code, amt, n)
    for off, sfx in enumerate(["count", "mean_amount", "age", "gap"]):
        k = f"{e}_{sfx}"; cols[k] = hist[:, off]; names.append(k)
    k = f"{e}_amount_vs_mean"
    cols[k] = np.where(hist[:, 1] > 0, amt / hist[:, 1], -1.0); names.append(k)
    act = decayed_history(day, code, n, np.ones(len(d), bool), RATES)
    for off, w in enumerate(NAMES):
        k = f"{e}_activity_{w}"; cols[k] = act[:, off]; names.append(k)
    wt = popularity_weights(code, n); WT[e] = wt
    con = decayed_history(day, code, n, y == 1, RATES,
                          weights=wt[np.maximum(code, 0)], confirmation_delay=LAG)
    for off, w in enumerate(NAMES):
        k = f"{e}_contagion_{w}"; cols[k] = con[:, off]; names.append(k)

X = pd.DataFrame(cols)
plain = [n for n in names if "contagion" not in n]

tr, es = day < 105, (day >= 105) & (day < 120)
win = (day >= W_LO) & (day < W_HI)
te = day >= 120
P = dict(objective="binary", learning_rate=0.08, num_leaves=24, max_depth=5,
         min_data_in_leaf=200, feature_fraction=0.8, bagging_fraction=0.8,
         bagging_freq=1, lambda_l2=5.0, is_unbalance=True, verbose=-1,
         num_threads=4, metric="average_precision")


def fit(use):
    m = lgb.train(P, lgb.Dataset(X.loc[tr, use], label=y[tr]), num_boost_round=400,
                  valid_sets=[lgb.Dataset(X.loc[es, use], label=y[es])],
                  callbacks=[lgb.early_stopping(60, verbose=False)])
    return m


def report(s, mask):
    yt = y[mask]; o = np.argsort(-s)
    return dict(pr=float(average_precision_score(yt, s)), roc=float(roc_auc_score(yt, s)),
                p50=float(yt[o[:50]].mean()), p100=float(yt[o[:100]].mean()),
                p250=float(yt[o[:250]].mean()), p500=float(yt[o[:500]].mean()),
                p1000=float(yt[o[:1000]].mean()), base=float(yt.mean()), n=int(mask.sum()))


full, base = fit(names), fit(plain)
sf_te, sb_te = full.predict(X.loc[te, names]), base.predict(X.loc[te, plain])
sf_w, sb_w = full.predict(X.loc[win, names]), base.predict(X.loc[win, plain])
rf_te, rb_te = report(sf_te, te), report(sb_te, te)
rf_w, rb_w = report(sf_w, win), report(sb_w, win)
print("test  full", {k: round(v, 4) for k, v in rf_te.items() if isinstance(v, float)})
print("test  plain", {k: round(v, 4) for k, v in rb_te.items() if isinstance(v, float)})
print("win   full", {k: round(v, 4) for k, v in rf_w.items() if isinstance(v, float)})
print("win   plain", {k: round(v, 4) for k, v in rb_w.items() if isinstance(v, float)})
print("trees", full.num_trees(), base.num_trees())


def node(nd):
    if "leaf_value" in nd:
        return {"v": nd["leaf_value"]}
    return {"f": nd["split_feature"], "t": nd["threshold"],
            "d": bool(nd["default_left"]),
            "l": node(nd["left_child"]), "r": node(nd["right_child"])}


def export(m):
    return [node(t["tree_structure"]) for t in m.dump_model()["tree_info"]]


json.dump({"features": names, "plainFeatures": plain,
           "trees": export(full), "plainTrees": export(base),
           "metrics": {"full": rf_te, "noContagion": rb_te,
                       "window": {"full": rf_w, "noContagion": rb_w}},
           "decayRates": list(RATES), "decayNames": NAMES,
           "entities": ENTS, "labelLagDays": LAG},
          open(OUT + "/web_model.json", "w"))

wi = np.where(win)[0]
T_sec = int(sec[wi[0]])
T = T_sec / 86400.0
prior = day < T
print(f"\nwindow rows {len(wi):,}  frauds {int(y[wi].sum()):,}  T = day {T:.4f}")

b64 = lambda a: base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()
payload = {"windowDays": [W_LO, W_HI], "n": int(len(wi)), "t0Sec": T_sec,
           "labelLagDays": LAG}
payload["cols"] = {
    "sec": b64(sec[wi].astype(np.uint32)),
    "amt": b64(np.round(amt[wi] * 1000).astype(np.uint32)),
    "y": b64(y[wi].astype(np.uint8))}

def clean(v):
    return v[:-2] if re.fullmatch(r"-?\d+\.0", v) else v


vocab, seed, pend = {}, {}, {"at": [], "fam": [], "ent": [], "w": []}
for j, e in enumerate(ENTS):
    col = d[e]
    present = col.notna().values
    vals = pd.unique(col[win & present])
    vals = np.sort(np.asarray(vals, dtype=object).astype(str))
    vals = np.array([v[:-2] if re.fullmatch(r"-?\d+\.0", v) else v for v in vals])
    lookup = {v: i + 1 for i, v in enumerate(vals)}
    V = len(vals)
    sv = col.astype(object).where(present, None)
    widx = np.zeros(len(wi), np.int64)
    for r, i in enumerate(wi):
        v = sv.iloc[i]
        if v is not None:
            widx[r] = lookup.get(clean(str(v)), 0)
    payload["cols"][e] = b64(widx.astype(np.uint16 if V > 254 else np.uint8))
    vocab[e] = list(vals)

    full_idx = np.zeros(len(d), np.int64)
    full_idx[present] = [lookup.get(clean(v), 0) for v in sv[present].astype(str).values]

    counts_all = {}
    for v, c in col.value_counts().items():
        counts_all[clean(str(v))] = counts_all.get(clean(str(v)), 0) + int(c)
    deg = np.array([0] + [counts_all.get(v, 0) for v in vals], float)

    act = np.zeros((V + 1, 3))
    acc = np.zeros((V + 1, 3))

    pm = prior & (full_idx > 0)
    pi = full_idx[pm]
    cnt = np.bincount(pi, weights=np.ones(pm.sum()), minlength=V + 1)
    tot = np.bincount(pi, weights=amt[pm], minlength=V + 1)
    order = np.argsort(sec[pm], kind="stable")
    fst_s = np.full(V + 1, -1, np.int64)
    prv_s = np.full(V + 1, -1, np.int64)
    for when, key in zip(sec[pm][order], pi[order]):
        if fst_s[key] < 0:
            fst_s[key] = when
        prv_s[key] = when
    el = T - day[pm]
    for k in range(3):
        act[:, k] = np.bincount(pi, weights=np.exp(-RATES[k] * el), minlength=V + 1)

    wt = 1.0 / np.log(deg + 5.0)
    fm = prior & (full_idx > 0) & (y == 1)
    arr = day[fm] + LAG
    fi = full_idx[fm]
    landed = arr < T
    if landed.any():
        elc = T - arr[landed]
        for k in range(3):
            acc[:, k] = np.bincount(fi[landed], weights=wt[fi[landed]] * np.exp(-RATES[k] * elc),
                                    minlength=V + 1)
    later = (~landed) & (arr < W_HI)
    pend["at"] += list((arr[later] * 86400.0))
    pend["fam"] += [j] * int(later.sum())
    pend["ent"] += list(fi[later])
    pend["w"] += list(wt[fi[later]])

    seed[e] = {"cnt": b64(cnt.astype(np.uint32)), "tot": b64(tot.astype(np.float64)),
               "first": b64(fst_s.astype(np.int64).astype(np.int32)),
               "prev": b64(prv_s.astype(np.int64).astype(np.int32)),
               "act": b64(act.astype(np.float64)), "acc": b64(acc.astype(np.float64)),
               "deg": b64(deg.astype(np.uint32))}
    print(f"  {e:<8} vocab {V:>6,}  warm {int((cnt>0).sum()):>6,}  "
          f"pending {int(later.sum()):>5,}  acc>0 {int((acc[:,2]>0).sum()):>5,}")

payload["vocab"] = vocab
payload["seed"] = seed
payload["pending"] = {"at": b64(np.array(pend["at"], np.float64)),
                      "fam": b64(np.array(pend["fam"], np.uint8)),
                      "ent": b64(np.array(pend["ent"], np.uint32)),
                      "w": b64(np.array(pend["w"], np.float64))}
payload["ref"] = {"full": rf_w, "noContagion": rb_w}

np.save(OUT + "/reference_scores.npy", np.column_stack([sf_w, sb_w]))
np.save(OUT + "/reference_features.npy", X.loc[win, names].values.astype(np.float64))
json.dump(payload, open(OUT + "/sample.json", "w"))
for f in ("web_model.json", "sample.json"):
    print(f, round(os.path.getsize(os.path.join(OUT, f)) / 1024, 1), "KB")
