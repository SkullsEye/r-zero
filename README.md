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

## 1. The website

The whole project is also a website, and the website is one file. Open `web/index.html` in any
browser, on any machine, with nothing installed and no internet connection, and the entire system
runs inside the tab: the identity graph, the contagion decay, the calibration and every line of
the scoring logic, on 83,571 real transactions, live. Nothing is uploaded anywhere and nothing is
replayed from a cache, which means what you are watching is the model actually working rather than
a recording of it having worked.

**To open it:** double-click `web/index.html`. That is the entire setup. If you would rather do it
from a terminal, `open web/index.html` on macOS or `start web\index.html` on Windows.

There are five tabs across the top.

**Home** is the nine ideas the system rests on, one at a time, each with a diagram and something
you can pull on rather than only read: why fraud is a branching process, how an exponential kernel
makes that O(1) per event, why the crowd has to be discounted, why a fraud is invisible until it is
confirmed, and why the damage is a clock rather than a threshold. The main pieces of code are in
there too, each shown as an idea next to the thing it does.

**Data** is volume and fraud day by day, the six columns the browser model uses, a slice of the raw
rows going in, and the second dataset we replicated on. It also lists what we could not use and
why, since a dataset that is structurally unable to answer the question is worth saying out loud
rather than leaving out.

**Experiments** is fourteen of them. Four failed, and one of the failures changed the design, so
all fourteen are in there instead of the ten that worked.

**Model** is the live one. Feed it the real sample, a simulated stream, or your own CSV, and it
calibrates first and then scores, in one pass, in front of you. The top of the tab states the
numbers this page is trying to earn, so you can watch it either hit them or miss them.

**Architecture** is the request path end to end: read-before-write ordering at a tied timestamp,
the exact state each entity carries, the cost per event, and the four ways this can sit in front of
a real system. It closes with what we would fix first, which is the honest version of a roadmap.

## 2. Setup on Windows

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

## 3. Setup on macOS

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

## 4. Running the full model

**The fastest way, and the one that needs nothing installed at all:** open `web/index.html` in any
browser, as above. It streams 83,571 real transactions from days 120–150 and computes every
feature, every score and every decision in the tab; you can drop your own CSV on it and it will do
the same thing to your data.

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

Data: IEEE-CIS Fraud Detection (Vesta Corporation), replicated on the ULB European card dataset.
Method after Ogata's epidemic-type aftershock model, Wald's sequential probability ratio test,
Hooi et al.'s camouflage-resistant weighting and Deb et al.'s NSGA-II. Cost parameters are
illustrative defaults; every rupee figure moves with them.
