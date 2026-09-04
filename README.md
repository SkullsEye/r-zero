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

Install [Python 3.10 or newer](https://www.python.org/downloads/) and tick
**"Add python.exe to PATH"** in the installer, then open PowerShell in the project folder:

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

Nothing here is pinned to a Python version and there is no optional dependency you need to chase:
`numba` would make the offline reproduction about 14x faster on its hot loop, but every number in
this repo is produced without it, so it stays out of `requirements.txt` rather than risking an
install that fails on a Python it has no wheel for.

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


---

Data: IEEE-CIS Fraud Detection (Vesta Corporation), replicated on the ULB European card dataset.
Method after Ogata's epidemic-type aftershock model, Wald's sequential probability ratio test,
Hooi et al.'s camouflage-resistant weighting and Deb et al.'s NSGA-II. Cost parameters are
illustrative defaults; every rupee figure moves with them.
