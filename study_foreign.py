"""
Will it hold on data that is not ours?

The old answer was a calibrated constant, so the honest answer was "no". The new
answer is arithmetic -- damage <= capacity x latency x transaction rate -- so it
should hold on anything. This tries hard to break it.
"""
import os
import sys
import numpy as np, pandas as pd
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from rzero.queue import ReviewDesk

def synth(kind, n, seed):
    rng = np.random.default_rng(seed)
    span = 40.0
    t = np.sort(rng.uniform(0, span, n))
    if kind == "uniform":
        ents = ["c%d" % i for i in rng.integers(0, n // 4 + 1, n)]
        y = (rng.random(n) < 0.03).astype(int)
    elif kind == "heavy tail":
        w = 1.0 / np.power(np.arange(1, n // 8 + 2), 1.1)
        ents = ["c%d" % i for i in rng.choice(len(w), n, p=w / w.sum())]
        y = (rng.random(n) < 0.03).astype(int)
    elif kind == "one whale":
        ents = ["whale" if rng.random() < 0.35 else "c%d" % rng.integers(0, 500) for _ in range(n)]
        y = (rng.random(n) < 0.03).astype(int)
    elif kind == "rare fraud":
        ents = ["c%d" % i for i in rng.integers(0, n // 4 + 1, n)]
        y = (rng.random(n) < 0.0005).astype(int)
    elif kind == "fraud epidemic":
        ents = ["c%d" % i for i in rng.integers(0, n // 4 + 1, n)]
        y = (rng.random(n) < 0.45).astype(int)
    elif kind == "drifting":
        ents = ["c%d" % i for i in rng.integers(0, n // 4 + 1, n)]
        y = (rng.random(n) < np.linspace(0.005, 0.20, n)).astype(int)
    elif kind == "burst then silence":
        t = np.sort(np.concatenate([rng.uniform(0, 2, n // 2), rng.uniform(2, span, n - n // 2)]))
        ents = ["c%d" % i for i in rng.integers(0, n // 4 + 1, n)]
        y = (rng.random(n) < 0.03).astype(int)
    elif kind == "all fraud":
        ents = ["c%d" % i for i in rng.integers(0, n // 4 + 1, n)]
        y = np.ones(n, int)
    elif kind == "no fraud":
        ents = ["c%d" % i for i in rng.integers(0, n // 4 + 1, n)]
        y = np.zeros(n, int)
    elif kind == "adversarial":
        ents = ["c%d" % i for i in rng.integers(0, n // 4 + 1, n)]
        y = (rng.random(n) < 0.03).astype(int)
    ents = np.array(ents)
    if kind == "adversarial":
        s = np.where(y == 1, rng.beta(2, 6, n), rng.beta(6, 2, n))
    else:
        s = np.where(y == 1, rng.beta(5, 2, n), rng.beta(2, 5, n))
    if kind in ("degenerate scores",):
        s = np.full(n, 0.5)
    return t, ents, s, y

CASES = ["uniform", "heavy tail", "one whale", "rare fraud", "fraud epidemic",
         "drifting", "burst then silence", "all fraud", "no fraud", "adversarial"]

CAP, LAT = 20, 4 / 24
print(f"Desk: {CAP} customers/day, a human within 4 hours. Nothing is calibrated.\n")
print(f"  {'stream':<22}{'rows':>8}{'base':>8}{'stopped/day':>13}{'budget':>8}"
      f"{'txns hit':>10}{'worst':>8}{'recall':>9}{'holds?':>9}")
print("  " + "-" * 96)
violations = []
for kind in CASES:
    for seed in range(3):
        t, ents, s, y = synth(kind, 20000, seed)
        desk = ReviewDesk(CAP, LAT, 1.0, seconds_per_day=1.0)
        truth = pd.DataFrame({"c": ents, "y": y}).groupby("c").y.max().to_dict()
        hit = np.zeros(len(t), np.int8)
        for i in range(len(t)):
            d = desk.decide(t[i], ents[i], s[i])
            if d != "allow":
                hit[i] = 1
            for k in list(desk.held):
                if desk.held[k] <= t[i]:
                    desk.verdict(k, truth.get(k, 0) == 1)
        span = t.max() - t.min()
        g = pd.DataFrame({"c": ents, "h": hit, "y": y}).groupby("c").agg(h=("h","max"), f=("y","max"))
        clean = g[g.f == 0]
        stopped = int(clean.h.sum()) / span
        txn = float((hit[y == 0] == 1).mean()) if (y == 0).any() else 0.0
        vc = pd.Series(ents[(hit == 1) & (y == 0)]).value_counts()
        worst = int(vc.iloc[0]) if len(vc) else 0
        rec = float(g[g.f == 1].h.mean()) if (g.f == 1).any() else float("nan")
        budget_ok = stopped <= CAP * 1.05
        bound = LAT * (len(t) / span) + 5
        bound_ok = worst <= bound
        if seed == 0:
            ok = "yes" if (budget_ok and bound_ok) else "NO"
            print(f"  {kind:<22}{len(t):>8,}{y.mean():>8.3f}{stopped:>13.1f}{CAP:>8}"
                  f"{100*txn:>9.2f}%{worst:>8}{100*rec:>8.1f}%{ok:>9}")
        if not (budget_ok and bound_ok):
            violations.append((kind, seed, stopped, worst, bound))
print()
if violations:
    print("VIOLATIONS:")
    for v in violations: print("  ", v)
else:
    print("No violation of the budget or the latency bound on any of 30 runs across")
    print("10 stream shapes, including an adversarial one where the model is inverted.")
