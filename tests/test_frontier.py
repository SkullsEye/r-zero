import numpy as np
import pytest

from rzero.economics import CostModel, apply_policy
from rzero.frontier import (crowding_distance, decode_policy, dominates,
                            evolve_frontier, frontier_quality, hypervolume,
                            sort_into_fronts)


def zdt1(genes):
    leading = genes[0]
    spread = 1 + 9 * np.mean(genes[1:])
    return np.array([leading, spread * (1 - np.sqrt(leading / spread))])


def policy_objective(seed=11, n=30000):
    rng = np.random.default_rng(seed)
    labels = (rng.random(n) < 0.035).astype(int)
    scores = np.clip(rng.normal(np.where(labels == 1, 0.70, 0.30), 0.16), 0, 1)
    amounts = rng.gamma(2, 2500, n)
    bands = np.quantile(amounts, [1 / 3, 2 / 3])
    cost = CostModel()

    def objective(genes):
        policy = decode_policy(genes, n)
        actions = apply_policy(scores, amounts, policy, bands)
        outcome = cost.evaluate(labels, amounts, actions)
        return np.array([-outcome["net_saved"], float(outcome["false_blocks"])])

    return objective, n


@pytest.mark.parametrize("left,right,expected", [
    ([1.0, 1.0], [2.0, 2.0], True),
    ([1.0, 2.0], [1.0, 3.0], True),
    ([1.0, 3.0], [2.0, 2.0], False),
    ([1.0, 1.0], [1.0, 1.0], False),
])
def test_dominance_relation(left, right, expected):
    assert dominates(np.array(left), np.array(right)) is np.True_ or \
           dominates(np.array(left), np.array(right)) == expected


def test_reported_front_is_non_dominated():
    _, objectives, front = evolve_frontier(zdt1, 6, 50, 25, seed=0)
    for i in front:
        for j in range(len(objectives)):
            if i != j:
                assert not dominates(objectives[j], objectives[i])


def test_boundary_solutions_are_never_bred_out():
    objectives = np.array([[0.0, 5.0], [1.0, 3.0], [2.0, 2.0], [5.0, 0.0]])
    distance = crowding_distance(objectives, [0, 1, 2, 3])
    assert np.isinf(distance[0]) and np.isinf(distance[3])
    assert np.isfinite(distance[1]) and np.isfinite(distance[2])


def test_evolution_gives_a_wider_menu_than_random_search():
    objective, _ = policy_objective()
    population, objectives, front = evolve_frontier(objective, 10, 40, 25, seed=1)

    budget = 40 * 26
    random_objectives = np.array(
        [objective(g) for g in np.random.default_rng(99).random((budget, 10))])

    reference = np.vstack([objectives, random_objectives]).max(axis=0) + 1e-9
    evolved_area = hypervolume(objectives[front], reference)
    random_front = sort_into_fronts(random_objectives)[0]
    random_area = hypervolume(random_objectives[random_front], reference)

    evolved = frontier_quality(objectives, front)
    sampled = frontier_quality(random_objectives, random_front)

    assert evolved_area >= random_area * 0.98
    assert evolved["count"] >= sampled["count"]
    assert evolved["spacing"] <= sampled["spacing"]


def test_same_seed_reproduces_and_different_seed_explores():
    first = evolve_frontier(zdt1, 5, 30, 10, seed=7)
    repeat = evolve_frontier(zdt1, 5, 30, 10, seed=7)
    other = evolve_frontier(zdt1, 5, 30, 10, seed=8)

    assert np.allclose(first[1], repeat[1])
    assert not np.allclose(first[1], other[1])


def test_no_genome_can_encode_an_illegal_policy():
    rng = np.random.default_rng(3)
    for _ in range(4000):
        policy = decode_policy(rng.random(10), 100000)
        for review_at, block_at in policy.thresholds_by_band.values():
            assert block_at >= review_at
        assert 0 <= policy.review_capacity <= 0.10 * 100000
        assert 0.001 <= policy.max_block_fraction <= 0.05


def test_frontier_dominates_fixed_single_thresholds():
    objective, n = policy_objective(seed=4)
    _, objectives, front = evolve_frontier(objective, 10, 40, 25, seed=5)

    beaten = 0
    thresholds = np.linspace(0.3, 0.95, 14)
    for t in thresholds:
        genes = np.array([t, 0.0] * 3 + [1.0, 1.0, 0.5, 0.5])
        fixed = objective(genes)
        if any(dominates(objectives[i], fixed) for i in front):
            beaten += 1

    assert beaten >= len(thresholds) - 3


@pytest.mark.parametrize("size,generations", [(4, 0), (2, 3), (10, 3)])
def test_degenerate_runs_do_not_crash(size, generations):
    population, objectives, front = evolve_frontier(zdt1, 4, size, generations,
                                                    seed=0)
    assert len(front) >= 1
    assert np.isfinite(objectives).all()
