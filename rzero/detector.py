import numpy as np
import lightgbm as lgb
from sklearn.metrics import average_precision_score, roc_auc_score

DEFAULT_PARAMS = {
    "objective": "binary",
    "learning_rate": 0.05,
    "num_leaves": 96,
    "min_data_in_leaf": 100,
    "feature_fraction": 0.7,
    "bagging_fraction": 0.8,
    "bagging_freq": 1,
    "lambda_l2": 5.0,
    "is_unbalance": True,
    "verbose": -1,
}


class Detector:
    def __init__(self, feature_names, params=None, max_rounds=2000,
                 patience=80):
        self.feature_names = list(feature_names)
        self.params = {**DEFAULT_PARAMS, **(params or {})}
        self.max_rounds = max_rounds
        self.patience = patience
        self.booster = None

    def fit(self, features, labels, train_mask, stop_mask):
        train = lgb.Dataset(features.loc[train_mask, self.feature_names],
                            label=labels[train_mask])
        stop = lgb.Dataset(features.loc[stop_mask, self.feature_names],
                           label=labels[stop_mask])
        self.booster = lgb.train(
            self.params, train, num_boost_round=self.max_rounds,
            valid_sets=[stop],
            callbacks=[lgb.early_stopping(self.patience, verbose=False)])
        return self

    def score(self, features, mask=None):
        rows = features if mask is None else features.loc[mask]
        return self.booster.predict(rows[self.feature_names])

    def gain_by_feature(self):
        gains = self.booster.feature_importance("gain")
        total = gains.sum()
        return {name: float(g / total)
                for name, g in zip(self.feature_names, gains)}

    def gain_by_family(self, families):
        per_feature = self.gain_by_feature()
        return {family: float(sum(per_feature.get(f, 0.0) for f in names))
                for family, names in families.items()}


def percentile_rank(values):
    values = np.asarray(values, float)
    return values.argsort().argsort() / max(len(values) - 1, 1)


def queue_precision(labels, scores, depths=(100, 500, 1000, 5000)):
    order = np.argsort(-np.asarray(scores))
    labels = np.asarray(labels)
    return {depth: float(labels[order[:depth]].mean()) for depth in depths}


def evaluate(labels, scores):
    labels = np.asarray(labels)
    order = np.argsort(-np.asarray(scores))
    top_one_percent = order[:max(int(0.01 * len(labels)), 1)]
    return {
        "pr_auc": float(average_precision_score(labels, scores)),
        "roc_auc": float(roc_auc_score(labels, scores)),
        "base_rate": float(labels.mean()),
        "precision_at": queue_precision(labels, scores),
        "recall_at_one_percent": float(labels[top_one_percent].sum()
                                       / max(labels.sum(), 1)),
    }
