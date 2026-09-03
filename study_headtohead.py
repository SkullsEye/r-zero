"""
Head to head, at MATCHED alarm volume: is the sequential statistic actually
better than just using the model score?
"""
import sys
import numpy as np, pandas as pd
sys.path.insert(0, "/root/ship")
from rzero.sequential import EvidenceScale

d = pd.read_csv("/root/data/ieee_slim.csv", low_memory=False)
t0 = d.TransactionDT.min(); day = (d.TransactionDT.values - t0)/86400.0
y = d.isFraud.values.astype(int)
amt = d.TransactionAmt.values.astype(float) * 83.0
d["D1n"] = (day - d.D1.fillna(-999).values).round(0)
client = (d.card1.astype(str)+"_"+d.addr1.astype(str)+"_"+d.D1n.astype(str)).astype(str).values
val_m=(day>=90)&(day<120); test_m=day>=120
sv, st = np.load("final_scores_val.npy"), np.load("final_scores_test.npy")
yv, yt = y[val_m], y[test_m]; cv, ct = client[val_m], client[test_m]
dv, dt = day[val_m], day[test_m]; at_ = amt[test_m]
rank = lambda v: v.argsort().argsort()/max(len(v)-1,1)
rv, rt = rank(sv), rank(st)
ev_t = EvidenceScale(n_bins=25).fit(rv, yv)(rt)

def running_llr(evidence, ents, times, lower=-2.2):
    order = np.argsort(times, kind="stable")
    tot, cleared = {}, set()
    out = np.zeros(len(evidence))
    for pos in order:
        k = ents[pos]
        if k in cleared: out[pos] = tot[k]; continue
        s = tot.get(k, 0.0) + evidence[pos]
        tot[k] = s; out[pos] = s
        if s <= lower: cleared.add(k)
    return out

def cusum(evidence, ents, times, half_life=7.0):
    order = np.argsort(times, kind="stable")
    rate = np.log(2)/half_life
    S, last = {}, {}
    out = np.zeros(len(evidence))
    for pos in order:
        k = ents[pos]; t = times[pos]
        s = S.get(k, 0.0)
        if k in last and s: s *= np.exp(-rate*(t-last[k]))
        s = max(0.0, s + evidence[pos])
        S[k] = s; last[k] = t; out[pos] = s
    return out

llr = running_llr(ev_t, ct, dt)
cus = cusum(ev_t, ct, dt)

print("At MATCHED alarm volume, precision and value stopped by each statistic.")
print("(top-K transactions by the statistic, over the whole 62-day period)\n")
print(f"  {'K':>7}{'raw model score':>22}{'accumulated LLR':>20}{'CUSUM':>14}{'contagion only':>18}")
print("  " + "-" * 84)
cands = {"score": rt, "llr": llr, "cusum": cus}
for K in (100, 250, 500, 1000, 2500, 5000):
    row = f"  {K:>7}"
    for nm in ("score", "llr", "cusum"):
        o = np.argsort(-cands[nm])[:K]
        row += f"{yt[o].mean():>22.3f}" if nm == "score" else f"{yt[o].mean():>20.3f}" if nm == "llr" else f"{yt[o].mean():>14.3f}"
    print(row)

print("\nValue of fraud stopped at matched volume (₹M):")
print(f"  {'K':>7}{'raw model score':>22}{'accumulated LLR':>20}{'CUSUM':>14}")
print("  " + "-" * 66)
for K in (100, 500, 1000, 5000):
    row = f"  {K:>7}"
    for nm, w in (("score", 22), ("llr", 20), ("cusum", 14)):
        o = np.argsort(-cands[nm])[:K]
        v = at_[o][yt[o] == 1].sum()/1e6
        row += f"{('₹%.1fM' % v):>{w}}"
    print(row)

print("\nSame question at the CUSTOMER level (rank customers by their peak statistic):")
dfc = pd.DataFrame({"c": ct, "y": yt, "s": rt, "l": llr, "u": cus, "a": at_})
g = dfc.groupby("c").agg(y=("y","max"), s=("s","max"), l=("l","max"), u=("u","max"), a=("a","sum"))
print(f"  {'top-K customers':>17}{'by best score':>16}{'by LLR':>12}{'by CUSUM':>12}")
print("  " + "-" * 58)
for K in (50, 100, 250, 500, 1000):
    row = f"  {K:>17}"
    for col in ("s", "l", "u"):
        o = g.sort_values(col, ascending=False).head(K)
        row += f"{o.y.mean():>16.3f}" if col == "s" else f"{o.y.mean():>12.3f}"
    print(row)
