import numpy as np
import pytest

from rzero.economics import ALLOW, BLOCK, REVIEW, CostModel, Policy, apply_policy


def band_policy(review_at, block_at, capacity=10 ** 9, block_fraction=1.0):
    return Policy(
        thresholds_by_band={name: (review_at, block_at)
                            for name in Policy.BAND_NAMES},
        review_capacity=capacity,
        max_block_fraction=block_fraction)


def population(n=20000, seed=6):
    rng = np.random.default_rng(seed)
    labels = (rng.random(n) < 0.04).astype(int)
    amounts = rng.gamma(2, 2500, n)
    scores = np.clip(rng.normal(np.where(labels == 1, 0.7, 0.3), 0.15), 0, 1)
    return labels, amounts, scores, np.quantile(amounts, [1 / 3, 2 / 3])


def test_every_rupee_is_accounted_for():
    labels, amounts, scores, bands = population()
    cost = CostModel()

    for review_at, block_at in [(0.0, 0.0), (0.3, 0.7), (0.9, 0.95), (1.1, 1.2)]:
        actions = apply_policy(scores, amounts, band_policy(review_at, block_at), bands)
        outcome = cost.evaluate(labels, amounts, actions)
        assert outcome["prevented"] + outcome["missed"] == pytest.approx(
            outcome["exposure"])


def test_review_capacity_binds_and_keeps_the_highest_scores():
    labels, amounts, scores, bands = population(50000)

    for capacity in (0, 100, 1000):
        actions = apply_policy(scores, amounts,
                               band_policy(0.20, 0.95, capacity), bands)
        assert (actions == REVIEW).sum() <= capacity

    actions = apply_policy(scores, amounts, band_policy(0.20, 0.95, 200), bands)
    queued = scores[actions == REVIEW]
    eligible = np.sort(scores[(scores >= 0.20) & (scores < 0.95)])
    assert queued.min() >= eligible[-200]


def test_block_allowance_binds():
    labels, amounts, scores, bands = population(50000)
    actions = apply_policy(scores, amounts,
                           band_policy(0.2, 0.4, 10 ** 9, 0.01), bands)
    assert (actions == BLOCK).sum() <= int(0.01 * len(scores))


def optimal_threshold(cost, labels, amounts, scores, bands):
    candidates = np.linspace(0.05, 0.99, 60)
    values = [cost.evaluate(labels, amounts,
                            apply_policy(scores, amounts,
                                         band_policy(t, t), bands))["net_saved"]
              for t in candidates]
    return candidates[int(np.argmax(values))]


def test_costlier_misses_make_the_policy_more_aggressive():
    labels, amounts, scores, bands = population(30000, seed=7)
    thresholds = [optimal_threshold(CostModel(chargeback_fee=fee), labels,
                                    amounts, scores, bands)
                  for fee in (200, 1200, 6000, 30000)]
    assert thresholds[-1] <= thresholds[0]


def test_costlier_false_alarms_make_the_policy_more_cautious():
    labels, amounts, scores, bands = population(30000, seed=7)
    thresholds = [optimal_threshold(CostModel(churn_probability=p), labels,
                                    amounts, scores, bands)
                  for p in (0.0, 0.08, 0.25, 0.60)]
    assert thresholds[-1] >= thresholds[0]


def test_false_block_cost_includes_lost_customers():
    cheap = CostModel(churn_probability=0.0, block_friction=250.0)
    dear = CostModel(churn_probability=0.20, customer_lifetime_value=9000.0)
    assert cheap.false_block_cost == 250.0
    assert dear.false_block_cost > cheap.false_block_cost


def test_empty_input_is_handled():
    actions = apply_policy(np.array([]), np.array([]), band_policy(0.3, 0.7),
                           np.array([1.0, 2.0]))
    assert len(actions) == 0
