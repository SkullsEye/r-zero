# R-Zero

Fraud is not a set of independent bad transactions. It is a branching process with a
half-life of minutes. Measuring that half-life produces a feature family that doubles a
strong detector.

**89 of the top 100 flagged transactions are genuinely fraudulent**, in a stream where 3.4%
are. Without the contagion features, 9 of 100.

| | Full system | Same model, no contagion | Random |
|---|---|---|---|
| Precision, top 100 | **0.890** | 0.090 | 0.034 |
| Precision, top 1,000 | **0.804** | 0.028 | 0.034 |
| PR-AUC | **0.466** | 0.232 | 0.034 |
| ROC-AUC | **0.921** | 0.820 | 0.500 |
| Net saved | **₹58.5M** | ₹46.7M | ₹9.9M |

Measured on days 120–182 of IEEE-CIS, against ₹86.1M of fraud exposure. The model trains on
days 0–105, the policy is chosen on days 105–120, and the test window is never used in any
fitting step.

## The idea

Production fraud systems carry static graph features (who are you connected to) and temporal
velocity features (how many transactions this hour). Nobody multiplies them.

The reproduction number of card fraud is **R₀ = 0.438** with a half-life of **3.3 minutes** —
replicated at 0.574 on an unrelated European dataset. A device that touched fraud four minutes
ago and the same device four weeks later are entirely different risks, and no static graph
feature separates them.

So risk is propagated through the entity graph *and* decayed in time:

```
contagion(entity, t) = Σ  w(entity) · exp(-β · (t - t_fraud))
                       over frauds confirmed on that entity before t

w(entity) = 1 / log(degree + 5)
```

Nine entity families, three decay rates (1 hour, 1 day, 1 week), 27 features. Because the
kernel is exponential the running total needs one multiply and one add per event — O(1), so
it computes on a live stream rather than in a nightly batch.

## Is the lift real?

A doubling is when you should suspect yourself. Three attacks on our own result:

**Shuffled labels.** Rebuild the identical features from randomly permuted labels: PR-AUC
falls to 0.196, indistinguishable from removing the family entirely (0.202). Real labels give
0.401. A feature reading the future would survive this.

**Feedback delay.** A fraud enters the features only 7 days after it happened. Degrades
gracefully rather than collapsing: `0d → 0.652`, `7d → 0.401`, `21d → 0.387`, `45d → 0.259`.
Every reported number uses the 7-day figure.

**Feedback cut entirely.** Never tell the deployed system about another fraud: 51% of the
contagion benefit survives.

Plus 51 adversarial tests, including one that flips a single transaction's outcome and asserts
its own features do not change by a single bit.

## What failed

Recorded because a project whose every claim held was not tested hard enough.

- **Wald's sequential test broke.** Designed for a 1% false-alarm rate, delivered 10.6% — one
  client's transactions are not independent evidence. Fixed by calibrating the boundary on
  held-out data rather than the closed form: now 2.14%, described as an empirical bound.
- **The genetic algorithm does not find better policies.** Random search matches it at equal
  budget. What NSGA-II earns is 60 evenly spaced operating points against random search's six.
- **Velocity features made the model worse** (0.230 → 0.202). This dataset's own C and D
  columns are already engineered velocity features; ours were redundant.

## Using it without the browser page

The page is the demo. The product is one object with two methods.

```python
from rzero.stream import ContagionState

state = ContagionState(["card", "address", "email", "device"])

features = state.observe(txn.timestamp, {
    "card": txn.card_fingerprint, "address": txn.billing_address,
    "email": txn.email_domain,    "device": txn.device_id,
}, amount=txn.amount)

state.confirm(fraud.timestamp, identities_of(fraud))
```

`observe` returns 44 features and never mutates anything the current transaction can see.
`confirm` schedules a contribution that lands `confirmation_delay_days` later. `snapshot()` and
`restore()` survive a restart. Measured at **70,000 transactions per second in pure Python**,
14 microseconds each, because the decay is exponential and the update is one multiply and one add.

`tests/test_stream.py` asserts the online object reproduces the batch pipeline to 1e-12 on the
same stream, including a test that flips one transaction's outcome and checks that its own
features do not move.

Four ways in, in order of how little has to change on your side:

| | What you run | What changes for you |
|---|---|---|
| Columns in the warehouse | `build_features(...)` over history | 27 extra columns, retrain, compare |
| Streaming object | `ContagionState` in your scorer | 44 features handed to the model you have |
| Sidecar service | `uvicorn service:app` | `POST /score`, `POST /confirm`, `GET /health` |
| Portable model file | `web/web_model.json` | 12 lines of tree-walking in any language |

**Will it hold on data that is not ours?** The bound is arithmetic rather than statistical, so there
is no distribution it can be wrong about — but we tried to break it anyway, on ten synthetic stream
shapes: heavy-tailed entities, a single whale, 0.05% fraud, 45% fraud, a drifting base rate, bursty
arrivals, all fraud, no fraud, flat scores, and one where the model is deliberately inverted.
**30 runs, 0 violations of either the capacity budget or the latency bound.** 47 of the 145 tests
exist purely to attack it (`tests/test_foreign.py`, `tests/test_queue.py`).

**One honest difference between the offline pipeline and production.** The batch feature build
weights each identity by how often it appears in the whole dataset, which a live system cannot
know. `ContagionState` uses the count it has seen so far. That costs **0.004 PR-AUC** out of a
contagion lift of 0.027 on the 30-day window — measured, not assumed, in `study_online_weights.py`.

## Run it in a browser

`web/index.html` is the whole project as a single file — no server, no build step, no network.
Five tabs:

- **Home** — the nine ideas the build rests on, each with a live widget you can pull on: a branching-process
  simulator, the O(1) decay running in real time with an operation counter, the popularity weight, the identity
  graph, the confirmation-delay curve, the calibration dial computing rates live from held-out data, a real
  decision tree walking a real transaction, the Pareto frontier, and a 100-slot review queue.
- **Data** — schema, missingness, daily volume against the temporal splits, real sample rows, the replication dataset.
- **Experiments** — all eleven, including the four that failed and what each claim was narrowed to.
- **Model** — upload a CSV and watch it run, in three visible steps.
- **Architecture** — request path, the read-before-write invariant, the temporal protocol, the four integration paths.
The Model tab streams **83,571 real transactions from days 120–150**, a month the model was
never trained on and never validated against, scoring each one in the order a live system
would see it — about **55,000 transactions a second** in a browser tab. You can also generate a
synthetic ring attack, or upload a CSV of your own: it sniffs the delimiter, decides whether the
first row is a header, guesses which column is which, and lets you correct the mapping by hand.
Nothing is uploaded anywhere; the file is read in the page.

**Calibration happens first, automatically.** Whatever stream you give it, the system fits its own
false-alarm boundary on the earlier part before it makes a single decision, then holds that boundary
fixed over the rest and reports what it actually achieved on those held-out rows. It never inherits a
threshold from our data. The step also prints what Wald's closed form would have done on your stream,
which is the whole argument for calibrating in one line.

The engine boots from a state snapshot of day 120 — how often each card, address, email and
device had been seen, and which frauds were already confirmed — which is what a real
deployment holds in memory at start-up. A further 3,031 confirmations are still inside the
7-day chargeback window at that moment and arrive mid-stream.

The browser is not approximating the Python. It reproduces it:

```bash
node web/verify.js
```

```
83,571 transactions, 2,850 fraudulent, scored in 1776 ms

with contagion
  PR-AUC                browser   0.2166   python   0.2166   ok
  precision@50          browser   0.7600   python   0.7600   ok
  precision@100         browser   0.6500   python   0.6500   ok
  precision@1000        browser   0.3900   python   0.3900   ok

contagion removed
  PR-AUC                browser   0.1857   python   0.1857   ok
  precision@100         browser   0.5800   python   0.5800   ok

largest per-transaction disagreement with LightGBM: 2.22e-16

PASS
```

That is machine epsilon on all 83,571 transactions, for both models. Getting there needed two
fixes worth recording: LightGBM thresholds exported at six decimal places destroy every split
on the small-valued contagion features, and a missing entity must produce a contagion of
**zero**, not `NaN`, or the trees route it by their default branch instead of comparing it.

The in-browser model is deliberately smaller than the one above — it uses only the six columns
anyone can supply, so it reaches PR-AUC 0.208 on the held-out period where the full model
reaches 0.466. On the 30-day window it scores 0.217, against 0.186 for the identical model
with the contagion features deleted.

To rebuild from the dataset:

```bash
python web/build_payload.py data/ieee_slim.csv
python web/assemble.py
```

Both steps are deterministic; the assembled file is byte-identical to the one committed.

## Install and run

```bash
pip install -r requirements.txt
python -m pytest tests -q
python -m rzero data/ieee_slim.csv
```

The dataset is IEEE-CIS Fraud Detection. `data/ieee_slim.csv` is `train_transaction.csv`
joined to `train_identity.csv`, keeping 36 columns.

## Layout

```
rzero/
  contagion.py    decayed history over the entity graph, O(1) per event
  entities.py     identity construction and popularity weighting
  features.py     transaction, velocity and contagion families
  detector.py     gradient-boosted model and evaluation
  sequential.py   Wald's test, kept for the record and no longer in the decision path
  queue.py        the review desk that replaced it: ranked queue, capacity, review latency
  stream.py       the online integration surface, O(1) per identity per event
  economics.py    cost model and policy application
  frontier.py     NSGA-II over the policy space
  pipeline.py     end to end, temporal protocol fixed in one place
tests/            145 adversarial tests, ~28 seconds
service.py        ~60 lines of FastAPI over rzero.stream
docs/             system design document
console.html      operations console
web/
  index.html      the whole site, single file, runs anywhere
  parts/          shell, styles, one file per tab, one file per JS concern
  build_payload.py  trains the six-column model, exports it and the warm-start snapshot
  assemble.py     parts + model + data -> index.html
  verify.js       proves the browser engine matches LightGBM to 2e-16, and that calibration lands in budget
```

## Limits

Not state of the art as a detector — heavily tuned ensembles score higher on this dataset. The
claim is an independent source of lift that stacks on whatever detector already exists.

The false-alarm bound is empirical and drifts; production needs rolling recalibration. Roughly
half the benefit requires confirmed outcomes flowing back within days. Cost parameters are
illustrative defaults. Segment fairness is unmeasured and would need a disparate-impact audit
before deployment.

## Credits

Ogata's epidemic-type aftershock model; Wald's sequential probability ratio test; Hooi et
al.'s camouflage-resistant density measure; Deb et al.'s NSGA-II.
