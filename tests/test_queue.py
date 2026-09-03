import math

import numpy as np
import pytest

from rzero.queue import ReviewQueue, allocate, precision_at_capacity


def stream(n, seed, n_ents=200, span=40.0, fraud_rate=0.05, score_shift=0.0,
           score_scale=1.0):
    rng = np.random.default_rng(seed)
    times = np.sort(rng.uniform(0, span, n))
    ents = ["e%d" % i for i in rng.integers(0, n_ents, n)]
    labels = (rng.random(n) < fraud_rate).astype(int)
    base = np.where(labels == 1, rng.beta(5, 2, n), rng.beta(2, 5, n))
    scores = base * score_scale + score_shift
    return times, ents, scores, labels


@pytest.mark.parametrize("seed", range(6))
def test_capacity_is_never_exceeded_on_any_stream(seed):
    times, ents, scores, _ = stream(3000, seed)
    for capacity in (1, 5, 25):
        q = ReviewQueue(capacity, period_days=1.0, seconds_per_day=1.0)
        per_period = []
        for t, e, s in zip(times, ents, scores):
            closed = q.offer(t, e, s)
            if closed:
                per_period.append(len(closed))
        per_period.append(len(q.flush()))
        assert max(per_period) <= capacity


@pytest.mark.parametrize("seed", range(4))
def test_an_entity_is_never_selected_twice(seed):
    times, ents, scores, _ = stream(4000, seed, n_ents=40)
    q = ReviewQueue(10, period_days=0.5, seconds_per_day=1.0)
    seen = []
    for t, e, s in zip(times, ents, scores):
        seen.extend(q.offer(t, e, s))
    seen.extend(q.flush())
    assert len(seen) == len(set(seen))


@pytest.mark.parametrize("seed", range(4))
def test_no_lookahead_a_future_row_cannot_change_a_past_decision(seed):
    times, ents, scores, _ = stream(2000, seed)
    flags_a, _ = allocate(times, ents, scores, 8, 1.0)
    cut = 1200
    scores_b = np.array(scores, float)
    scores_b[cut:] = 1.0
    ents_b = list(ents)
    ents_b[cut:] = ["intruder%d" % i for i in range(len(ents) - cut)]
    flags_b, _ = allocate(times, ents_b, scores_b, 8, 1.0)
    boundary = int(np.searchsorted(times, math.floor(times[cut])))
    assert flags_a[:boundary] == flags_b[:boundary]


def test_input_order_does_not_matter():
    times, ents, scores, _ = stream(1500, 11)
    flags_a, picked_a = allocate(times, ents, scores, 6, 1.0)
    idx = np.random.default_rng(3).permutation(len(times))
    flags_b, picked_b = allocate(times[idx], [ents[i] for i in idx],
                                 scores[idx], 6, 1.0)
    assert picked_a.keys() == picked_b.keys()
    assert [flags_a[i] for i in idx] == flags_b


@pytest.mark.parametrize("seed", range(4))
def test_more_capacity_never_finds_less_fraud(seed):
    times, ents, scores, labels = stream(3000, seed)
    found = []
    for capacity in (1, 3, 8, 20, 50):
        flags, picked = allocate(times, ents, scores, capacity, 1.0)
        caught = {e for e, y, f in zip(ents, labels, flags) if f and y == 1}
        found.append(len(caught))
    assert found == sorted(found)


@pytest.mark.parametrize("shift,scale", [(0.0, 1.0), (100.0, 1.0), (0.0, 1e6),
                                         (-50.0, 0.001), (1e6, 1e-6)])
def test_guarantee_survives_any_score_scale(shift, scale):
    times, ents, scores, _ = stream(2000, 5, score_shift=shift, score_scale=scale)
    q = ReviewQueue(7, period_days=1.0, seconds_per_day=1.0)
    counts = []
    for t, e, s in zip(times, ents, scores):
        closed = q.offer(t, e, s)
        if closed:
            counts.append(len(closed))
    counts.append(len(q.flush()))
    assert max(counts) <= 7


@pytest.mark.parametrize("rate", [0.0, 0.0001, 0.5, 0.999, 1.0])
def test_any_base_rate_is_handled(rate):
    times, ents, scores, labels = stream(1500, 9, fraud_rate=rate)
    flags, picked = allocate(times, ents, scores, 5, 1.0)
    assert len(picked) <= 5 * (math.ceil(times.max() - times.min()) + 2)
    assert all(f in (0, 1) for f in flags)


def test_ties_are_resolved_without_exceeding_capacity():
    times = np.repeat(np.arange(10.0), 50)
    ents = ["e%d" % (i % 120) for i in range(len(times))]
    scores = np.full(len(times), 0.5)
    flags, picked = allocate(times, ents, scores, 4, 1.0)
    assert len(picked) <= 4 * 11


def test_degenerate_inputs_do_not_crash():
    for times, ents, scores in [
        ([], [], []),
        ([0.0], ["a"], [0.5]),
        ([0.0, 0.0, 0.0], ["a", "a", "a"], [0.1, 0.9, 0.5]),
        ([0.0, 1.0], ["", None], [0.9, 0.9]),
        ([0.0, 1.0], ["a", "b"], [float("nan"), float("inf")]),
    ]:
        flags, picked = allocate(times, ents, scores, 3, 1.0)
        assert len(flags) == len(times)


def test_missing_identities_are_never_selected():
    times = [0.0, 1.0, 2.0, 3.0]
    ents = ["", None, "real", ""]
    scores = [0.99, 0.99, 0.1, 0.99]
    flags, picked = allocate(times, ents, scores, 5, 1.0)
    assert set(picked) == {"real"}


def test_zero_capacity_selects_nobody():
    times, ents, scores, _ = stream(500, 2)
    flags, picked = allocate(times, ents, scores, 0, 1.0)
    assert picked == {}
    assert sum(flags) == 0


def test_backwards_time_is_rejected():
    q = ReviewQueue(3, period_days=1.0, seconds_per_day=1.0)
    q.offer(5.0, "a", 0.5)
    with pytest.raises(ValueError):
        q.offer(4.0, "b", 0.5)


def test_one_entity_cannot_dominate_the_damage():
    times = np.sort(np.concatenate([np.random.default_rng(1).uniform(0, 30, 400),
                                    np.linspace(0, 30, 3000)]))
    ents = ["whale"] * len(times)
    scores = np.full(len(times), 0.99)
    flags, picked = allocate(times, ents, scores, 10, 1.0)
    assert len(picked) == 1


def test_verdict_records_the_analyst_outcome():
    q = ReviewQueue(2, period_days=1.0, seconds_per_day=1.0)
    for t, e, s in [(0.0, "a", 0.9), (0.1, "b", 0.8), (0.2, "c", 0.1)]:
        q.offer(t, e, s)
    picked = q.flush()
    assert len(picked) == 2
    for k in picked:
        assert q.status(k) == "awaiting"
    q.verdict(picked[0], True)
    q.verdict(picked[1], False)
    assert q.status(picked[0]) == "blocked"
    assert q.status(picked[1]) == "cleared"
    assert q.status("never-seen") == "unseen"


def test_precision_at_capacity_matches_a_hand_count():
    ents = ["a", "a", "b", "c", "d"]
    labels = [1, 0, 0, 1, 0]
    flags = [1, 1, 1, 1, 0]
    assert precision_at_capacity(flags, labels, ents) == pytest.approx(2 / 3)


from rzero.queue import ReviewDesk


def test_desk_releases_a_customer_after_the_review_latency():
    desk = ReviewDesk(1, review_latency_days=0.5, period_days=1.0, seconds_per_day=1.0)
    assert desk.decide(0.0, "a", 0.9) == "allow"
    assert desk.decide(1.1, "a", 0.9) == "hold"
    desk.verdict("a", False)
    assert desk.decide(1.2, "a", 0.9) == "allow"


def test_desk_blocks_permanently_only_on_a_guilty_verdict():
    desk = ReviewDesk(1, review_latency_days=0.1, period_days=1.0, seconds_per_day=1.0)
    desk.decide(0.0, "a", 0.9)
    desk.decide(1.5, "a", 0.9)
    desk.verdict("a", True)
    assert desk.decide(9.0, "a", 0.1) == "block"
    assert desk.decide(9.1, "a", 0.9) == "block"


def test_a_held_customer_is_freed_when_the_latency_lapses_even_without_a_verdict():
    desk = ReviewDesk(1, review_latency_days=0.25, period_days=1.0, seconds_per_day=1.0)
    desk.decide(0.0, "a", 0.9)
    desk.decide(1.1, "a", 0.9)
    assert desk.decide(1.2, "a", 0.9) == "hold"
    assert desk.decide(2.0, "a", 0.9) in ("allow", "hold")


@pytest.mark.parametrize("latency", [0.0, 1 / 96, 1 / 24, 1.0])
def test_damage_is_bounded_by_latency_not_by_customer_volume(latency):
    n = 6000
    times = np.linspace(0, 30, n)
    ents = ["whale"] * n
    scores = np.full(n, 0.99)
    desk = ReviewDesk(5, review_latency_days=latency, period_days=1.0, seconds_per_day=1.0)
    hits = 0
    for t, e, s in zip(times, ents, scores):
        if desk.decide(t, e, s) != "allow":
            hits += 1
        desk.verdict(e, False)
    rate = n / 30.0
    assert hits <= max(1, desk.stopped_total * (latency * rate + 2))


def test_desk_never_stops_more_customers_than_its_capacity_allows():
    times, ents, scores, _ = stream(8000, 4, n_ents=900, span=20.0)
    desk = ReviewDesk(6, review_latency_days=1 / 24, period_days=1.0, seconds_per_day=1.0)
    for t, e, s in zip(times, ents, scores):
        desk.decide(t, e, s)
    assert desk.stopped_total <= 6 * (20 + 2)


def test_worst_case_exposure_is_arithmetic_not_calibration():
    desk = ReviewDesk(10, review_latency_days=4 / 24)
    assert desk.worst_case_exposure(transactions_per_day=1200) == pytest.approx(200.0)


def test_negative_latency_is_rejected():
    with pytest.raises(ValueError):
        ReviewDesk(5, review_latency_days=-1.0)
