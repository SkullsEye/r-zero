import os
import sys
import numpy as np, pandas as pd, lightgbm as lgb
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "data", "ieee_slim.csv")
sys.path.insert(0, HERE)
from sklearn.metrics import average_precision_score, roc_auc_score
from rzero.contagion import decayed_history, entity_history
from rzero.entities import encode_entity, popularity_weights

RATES = np.array([np.log(2)/(1/24), np.log(2)/1.0, np.log(2)/7.0])
NAMES = ["1h","1d","7d"]; ENTS = ["card","address","email","device"]
SRC = {"card":"card1","address":"addr1","email":"P_emaildomain","device":"DeviceInfo"}
LAG = 7.0

raw = pd.read_csv(DATA, low_memory=False)
t0 = raw.TransactionDT.min()
day = (raw.TransactionDT.values - t0)/86400.0
amt = raw.TransactionAmt.values.astype(float)
y = raw.isFraud.values.astype(int)
d = pd.DataFrame({e: raw[SRC[e]].astype("string") for e in ENTS})

def running_degree(codes):
    order = np.arange(len(codes))
    out = np.zeros(len(codes), float)
    seen = {}
    for i, c in enumerate(codes):
        if c < 0:
            out[i] = 0.0; continue
        seen[c] = seen.get(c, 0) + 1
        out[i] = seen[c]
    return out

def build(mode):
    cols, names = {}, []
    cols["amount"] = amt
    cols["amount_log"] = np.log1p(np.maximum(amt, 0))
    cols["amount_fraction"] = np.round(amt - np.floor(amt), 3)
    cols["hour_of_day"] = (day*24) % 24
    names += ["amount","amount_log","amount_fraction","hour_of_day"]
    for e in ENTS:
        code, n = encode_entity(d, [e])
        hist = entity_history(day, code, amt, n)
        for off, sfx in enumerate(["count","mean_amount","age","gap"]):
            k=f"{e}_{sfx}"; cols[k]=hist[:,off]; names.append(k)
        k=f"{e}_amount_vs_mean"; cols[k]=np.where(hist[:,1]>0, amt/hist[:,1], -1.0); names.append(k)
        act = decayed_history(day, code, n, np.ones(len(d),bool), RATES)
        for off,w in enumerate(NAMES):
            k=f"{e}_activity_{w}"; cols[k]=act[:,off]; names.append(k)
        if mode == "full":
            wt = popularity_weights(code, n)
            row_w = wt[np.maximum(code,0)]
        else:
            row_w = 1.0/np.log(running_degree(code) + 5.0)
        con = decayed_history(day, code, n, y==1, RATES, weights=row_w, confirmation_delay=LAG)
        for off,w in enumerate(NAMES):
            k=f"{e}_contagion_{w}"; cols[k]=con[:,off]; names.append(k)
    return pd.DataFrame(cols), names

tr, es, te = day < 105, (day>=105)&(day<120), day>=120
win = (day>=120)&(day<150)
P = dict(objective="binary", learning_rate=0.08, num_leaves=24, max_depth=5,
         min_data_in_leaf=200, feature_fraction=0.8, bagging_fraction=0.8,
         bagging_freq=1, lambda_l2=5.0, is_unbalance=True, verbose=-1,
         num_threads=4, metric="average_precision")

def report(X, names, mask, tag):
    m = lgb.train(P, lgb.Dataset(X.loc[tr, names], label=y[tr]), num_boost_round=400,
                  valid_sets=[lgb.Dataset(X.loc[es, names], label=y[es])],
                  callbacks=[lgb.early_stopping(60, verbose=False)])
    s = m.predict(X.loc[mask, names]); yt = y[mask]; o = np.argsort(-s)
    print(f"  {tag:<34} PR-AUC {average_precision_score(yt,s):.4f}  ROC {roc_auc_score(yt,s):.4f}"
          f"  P@100 {yt[o[:100]].mean():.3f}  P@1000 {yt[o[:1000]].mean():.3f}", flush=True)
    return average_precision_score(yt, s)

Xf, names = build("full")
Xr, _ = build("running")
plain = [n for n in names if "contagion" not in n]
print("\ndays 120-150 (the window the web console streams)")
a = report(Xf, names, win, "full-data popularity weight")
b = report(Xr, names, win, "running popularity weight (online)")
c = report(Xf, plain, win, "no contagion at all")
print(f"\n  difference from using only what is known at the time: {a-b:+.4f} PR-AUC")
print(f"  contagion is worth {b-c:+.4f} PR-AUC even with the online weight")
print("\ndays 120-182 (full held-out period)")
a2 = report(Xf, names, te, "full-data popularity weight")
b2 = report(Xr, names, te, "running popularity weight (online)")
c2 = report(Xf, plain, te, "no contagion at all")
print(f"\n  difference: {a2-b2:+.4f} PR-AUC   contagion worth {b2-c2:+.4f} online")
