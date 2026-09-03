from dataclasses import dataclass, field

import numpy as np

ALLOW = 0
REVIEW = 1
BLOCK = 2


@dataclass
class CostModel:
    chargeback_fee: float = 1200.0
    review_cost: float = 40.0
    block_friction: float = 250.0
    churn_probability: float = 0.08
    customer_lifetime_value: float = 9000.0
    review_catch_rate: float = 0.90

    @property
    def false_block_cost(self):
        return self.block_friction + self.churn_probability * self.customer_lifetime_value

    def evaluate(self, labels, amounts, actions):
        labels = np.asarray(labels).astype(int)
        amounts = np.asarray(amounts, float)
        actions = np.asarray(actions).astype(int)

        allowed_fraud = (actions == ALLOW) & (labels == 1)
        blocked_fraud = (actions == BLOCK) & (labels == 1)
        blocked_legit = (actions == BLOCK) & (labels == 0)
        reviewed_fraud = (actions == REVIEW) & (labels == 1)
        reviewed_legit = (actions == REVIEW) & (labels == 0)

        reviewed_fraud_value = (amounts[reviewed_fraud].sum()
                                + self.chargeback_fee * reviewed_fraud.sum())
        caught = self.review_catch_rate

        prevented = (amounts[blocked_fraud].sum()
                     + self.chargeback_fee * blocked_fraud.sum()
                     + caught * reviewed_fraud_value)
        missed = (amounts[allowed_fraud].sum()
                  + self.chargeback_fee * allowed_fraud.sum()
                  + (1 - caught) * reviewed_fraud_value)
        review_spend = self.review_cost * (reviewed_fraud.sum() + reviewed_legit.sum())
        friction_spend = self.false_block_cost * blocked_legit.sum()
        exposure = amounts[labels == 1].sum() + self.chargeback_fee * (labels == 1).sum()

        return {
            "prevented": float(prevented),
            "missed": float(missed),
            "review_spend": float(review_spend),
            "friction_spend": float(friction_spend),
            "net_saved": float(prevented - review_spend - friction_spend),
            "exposure": float(exposure),
            "blocked": int((actions == BLOCK).sum()),
            "reviewed": int((actions == REVIEW).sum()),
            "false_blocks": int(blocked_legit.sum()),
            "recall": float((blocked_fraud.sum() + reviewed_fraud.sum())
                            / max(int((labels == 1).sum()), 1)),
            "block_precision": float(blocked_fraud.sum()
                                     / max(int((actions == BLOCK).sum()), 1)),
        }


@dataclass
class Policy:
    thresholds_by_band: dict = field(default_factory=dict)
    review_capacity: int = 0
    max_block_fraction: float = 0.01

    BAND_NAMES = ("low", "mid", "high")


def apply_policy(scores, amounts, policy, band_edges):
    scores = np.asarray(scores, float)
    amounts = np.asarray(amounts, float)
    actions = np.zeros(len(scores), dtype=int)
    band = np.digitize(amounts, band_edges)

    for index, name in enumerate(Policy.BAND_NAMES):
        in_band = band == index
        if not in_band.any():
            continue
        review_at, block_at = policy.thresholds_by_band[name]
        actions[in_band & (scores >= review_at)] = REVIEW
        actions[in_band & (scores >= block_at)] = BLOCK

    queued = np.where(actions == REVIEW)[0]
    if len(queued) > policy.review_capacity:
        overflow = queued[np.argsort(scores[queued])[:len(queued) - policy.review_capacity]]
        actions[overflow] = ALLOW

    blocked = np.where(actions == BLOCK)[0]
    allowance = int(policy.max_block_fraction * len(scores))
    if len(blocked) > allowance:
        demoted = blocked[np.argsort(scores[blocked])[:len(blocked) - allowance]]
        actions[demoted] = ALLOW

    return actions
