# R-Zero

Fraud is not a set of independent bad transactions. It is a branching process with a half-life of
minutes, and measuring that half-life produces a feature family that stacks on top of whatever
detector you already run.

**89 of the top 100 flagged transactions are genuinely fraudulent**, in a stream where 3.4% are.
Without the contagion features, 9 of 100. Which means an analyst spends about an hour a day on
false alarms instead of eight and a half.

Measured on days 120–182 of IEEE-CIS, 590,540 real transactions. The model trains on days 0–105,
the policy is chosen on days 105–120, and the test window is never used in any fitting step.

| | Full system | Same model, no contagion | Random |
|---|---|---|---|
| Precision, top 100 | **0.890** | 0.090 | 0.034 |
| PR-AUC | **0.466** | 0.232 | 0.034 |
| Net saved | **₹58.5M** | ₹46.7M | ₹9.9M |

---

## 1. Setup on Windows

Install [Python 3.11+](https://www.python.org/downloads/) and tick **"Add python.exe to PATH"** in
the installer, then open PowerShell in the project folder:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m pytest tests -q
```

If PowerShell refuses to run the activate script, run
`Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` once and try again.

You should see **145 passed**. That is the whole install verified, including 47 tests that try to
break the system on data it has never seen.

## 2. Setup on macOS

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m pytest tests -q
```

Same **145 passed**. If `python3` is missing, `brew install python@3.11` first.

## 3. Running the full model

**The fastest way, and the one that needs nothing installed at all:** open `web/index.html` in any
browser. It streams 83,571 real transactions from days 120–150 and computes every feature, every
score and every decision in the tab, live. Nothing is uploaded and nothing is replayed from a
cache; you can drop your own CSV on it and it will do the same thing to your data.

To confirm the browser is not cheating, run:

```bash
node web/verify.js
```

which scores all 83,571 transactions in JavaScript and compares them against the offline LightGBM
model transaction by transaction. It should report a largest disagreement of **2.22e-16**, which is
machine precision, and then **PASS**.

**To reproduce the headline numbers from raw data**, you need the IEEE-CIS Fraud Detection dataset
(Kaggle, `train_transaction.csv` joined to `train_identity.csv`). Put it at `data/ieee_slim.csv`
and run:

```bash
python -m rzero data/ieee_slim.csv        # the full nine-family system, end to end
python web/build_payload.py               # retrain the six-column browser model
python web/assemble.py                    # rebuild web/index.html, byte-identically
```

The first command takes a few minutes and prints the precision, PR-AUC and rupee figures in the
table above. The last two are deterministic: the rebuilt `index.html` is byte-for-byte the file
that ships in this repo.

---

## What broke, and what we did about it

**The result was too good, which scared me.** Adding the contagion features nearly doubled PR-AUC,
and instead of celebrating I got suspicious, because a jump that size usually means the model has
quietly seen the future rather than learnt anything real. So I rebuilt the exact same features from
randomly shuffled labels and retrained; the entire gain vanished and landed back on top of the
model that has no contagion at all. Something that was leaking would have survived that test, hence
I now trust the number, and the experiment ships in the repo rather than sitting in my notes.

**The maths that is guaranteed on paper was not guaranteed on real data.** Wald's sequential test
promises a 1% false-alarm rate; ours delivered 10.64%, because the proof assumes every piece of
evidence is independent and one customer's five payments in a row are obviously not. Calibrating
the boundary on held-out data got it to 2.14%, and I thought that was the end of it.

## The 2 a.m. one

It was not the end of it. Late one night I broke the 2.14% down by customer instead of by
transaction, and found that **1,172 of those false alarms, 32% of every false alarm in the entire
test period, came from one single innocent account.** I spent the rest of that night trying to fix
it properly, and failing: CUSUM with reset, CUSUM with decay, adaptive conformal control,
precision-locked integrators, a budgeted rate governor, and finally a conformal test martingale
under Ville's inequality, which is about as strong a guarantee as statistics offers. Every one of
them failed on the same two customers. The diagnosis, when it finally came, was that a per-decision
guarantee applied 1,175 times is a per-customer guarantee of 1−(1−α)ⁿ, which at 1% and 1,175 is
99.996%; the theorem was never violated, I had just been reading it as though it applied once.
So the threshold was never the thing to fix. What actually bounds the damage is how long a wrong
decision is allowed to stand, and once a human sits between the decision and its permanence, one
mistake costs a handful of payments instead of 1,172. Innocent payments blocked went from 2.265% to
**0.234%** at the same recall, the worst single customer went from 1,172 to **5**, and none of it
is calibrated, so there is nothing that has to transfer to anybody else's data.

---

Data: IEEE-CIS Fraud Detection (Vesta Corporation), replicated on the ULB European card dataset.
Method after Ogata's epidemic-type aftershock model, Wald's sequential probability ratio test,
Hooi et al.'s camouflage-resistant weighting and Deb et al.'s NSGA-II. Cost parameters are
illustrative defaults; every rupee figure moves with them.
