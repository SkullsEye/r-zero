import numpy as np
import pandas as pd

from rzero.detector import Detector, evaluate, percentile_rank
from rzero.economics import CostModel, apply_policy
from rzero.features import build_features
from rzero.frontier import decode_policy, evolve_frontier, frontier_quality
from rzero.sequential import BLOCK, EvidenceScale, SequentialTest

RUPEES_PER_USD = 83.0
SPLIT = {"train_end": 75, "stop_end": 90, "policy_end": 120}


def load(path):
    frame = pd.read_csv(path, low_memory=False)
    origin = frame.TransactionDT.min()
    day = (frame.TransactionDT.values - origin) / 86400.0
    frame["D1n"] = (day - frame.D1.fillna(-999).values).round(0)
    frame["client"] = (frame.card1.astype(str) + "_" + frame.addr1.astype(str)
                       + "_" + frame.D1n.astype(str))
    labels = frame.isFraud.values.astype(int)
    amounts = frame.TransactionAmt.values.astype(float) * RUPEES_PER_USD
    return frame, day, labels, amounts


def run(path, seed=7, verbose=True):
    frame, day, labels, amounts = load(path)
    features, families = build_features(frame, day, labels)
    all_features = families["base"] + families["velocity"] + families["contagion"]

    policy_window = (day >= SPLIT["stop_end"]) & (day < SPLIT["policy_end"])
    live_window = day >= SPLIT["policy_end"]

    policy_scores = Detector(all_features).fit(
        features, labels, day < SPLIT["train_end"],
        (day >= SPLIT["train_end"]) & (day < SPLIT["stop_end"])
    ).score(features, policy_window)

    detector = Detector(all_features).fit(
        features, labels, day < SPLIT["policy_end"] - 15,
        (day >= SPLIT["policy_end"] - 15) & (day < SPLIT["policy_end"]))
    live_scores = detector.score(features, live_window)

    baseline = Detector(families["base"]).fit(
        features, labels, day < SPLIT["policy_end"] - 15,
        (day >= SPLIT["policy_end"] - 15) & (day < SPLIT["policy_end"])
    ).score(features, live_window)

    policy_labels, live_labels = labels[policy_window], labels[live_window]
    policy_amounts, live_amounts = amounts[policy_window], amounts[live_window]
    policy_rank, live_rank = percentile_rank(policy_scores), percentile_rank(live_scores)

    evidence = EvidenceScale().fit(policy_rank, policy_labels)
    test, achieved = SequentialTest.calibrated(
        evidence, policy_rank, policy_labels,
        frame["client"].values[policy_window], day[policy_window])
    decisions, _ = test.run(live_rank, frame["client"].values[live_window],
                            day[live_window])

    cost = CostModel()
    policy_bands = np.quantile(policy_amounts, [1 / 3, 2 / 3])
    live_bands = np.quantile(live_amounts, [1 / 3, 2 / 3])

    def fitness(genes):
        policy = decode_policy(genes, len(policy_labels))
        actions = apply_policy(policy_rank, policy_amounts, policy, policy_bands)
        outcome = cost.evaluate(policy_labels, policy_amounts, actions)
        return np.array([-outcome["net_saved"], float(outcome["false_blocks"])])

    genomes, objectives, front = evolve_frontier(fitness, 10, seed=seed)
    ordered = [front[i] for i in np.argsort(objectives[front, 1])]
    chosen = {"conservative": ordered[0],
              "balanced": ordered[len(ordered) // 2],
              "aggressive": ordered[-1]}

    outcomes = {}
    for name, index in chosen.items():
        policy = decode_policy(genomes[index], len(live_labels))
        actions = apply_policy(live_rank, live_amounts, policy, live_bands)
        outcomes[name] = cost.evaluate(live_labels, live_amounts, actions)

    report = {
        "detector": evaluate(live_labels, live_scores),
        "baseline": evaluate(live_labels, baseline),
        "gain_by_family": detector.gain_by_family(families),
        "sequential": {
            "upper": float(test.upper),
            "calibrated_rate": float(achieved),
            "observed_rate": float((decisions[live_labels == 0] == BLOCK).mean()),
            "fraud_rate_when_blocked": float(live_labels[decisions == BLOCK].mean()),
        },
        "frontier": frontier_quality(objectives, front),
        "policies": outcomes,
    }

    if verbose:
        report_to_console(report)

    return report, {"scores": live_scores, "labels": live_labels,
                    "amounts": live_amounts, "objectives": objectives[front],
                    "genomes": genomes[front]}


def report_to_console(report):
    detector, baseline = report["detector"], report["baseline"]
    print(f"PR-AUC      {detector['pr_auc']:.4f}   "
          f"baseline {baseline['pr_auc']:.4f}   "
          f"base rate {detector['base_rate']:.4f}")
    print(f"ROC-AUC     {detector['roc_auc']:.4f}")
    for depth, value in detector["precision_at"].items():
        print(f"top {depth:<7,} {value:.2f}   "
              f"baseline {baseline['precision_at'][depth]:.2f}")
    print(f"\nfalse alarms {100*report['sequential']['observed_rate']:.2f}%   "
          f"fraud rate when blocked "
          f"{100*report['sequential']['fraud_rate_when_blocked']:.1f}%")
    print(f"frontier     {report['frontier']['count']} operating points\n")
    for name, outcome in report["policies"].items():
        print(f"{name:<14} net Rs {outcome['net_saved']/1e6:6.1f}M   "
              f"{100*outcome['net_saved']/outcome['exposure']:5.1f}% of exposure   "
              f"recall {outcome['recall']:.2f}   "
              f"false blocks {outcome['false_blocks']:,}")
