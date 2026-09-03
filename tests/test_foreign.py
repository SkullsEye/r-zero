import numpy as np
import pytest

from rzero.queue import ReviewDesk

SHAPES = ["uniform", "heavy_tail", "one_whale", "rare_fraud", "epidemic",
          "drifting", "bursty", "all_fraud", "no_fraud", "inverted_model",
          "flat_scores", "single_entity", "one_per_entity"]


def synth(shape, n, seed, span=40.0):
    rng = np.random.default_rng(seed)
    times = np.sort(rng.uniform(0, span, n))
    ents = np.array(["c%d" % i for i in rng.integers(0, max(n // 4, 1), n)])
    labels = (rng.random(n) < 0.03).astype(int)

    if shape == "heavy_tail":
        w = 1.0 / np.power(np.arange(1, max(n // 8, 2) + 1), 1.1)
        ents = np.array(["c%d" % i for i in rng.choice(len(w), n, p=w / w.sum())])
    elif shape == "one_whale":
        ents = np.array(["whale" if rng.random() < 0.4 else "c%d" % rng.integers(0, 400)
                         for _ in range(n)])
    elif shape == "rare_fraud":
        labels = (rng.random(n) < 0.0005).astype(int)
    elif shape == "epidemic":
        labels = (rng.random(n) < 0.45).astype(int)
    elif shape == "drifting":
        labels = (rng.random(n) < np.linspace(0.002, 0.25, n)).astype(int)
    elif shape == "bursty":
        times = np.sort(np.concatenate([rng.uniform(0, 1, n // 2),
                                        rng.uniform(1, span, n - n // 2)]))
    elif shape == "all_fraud":
        labels = np.ones(n, int)
    elif shape == "no_fraud":
        labels = np.zeros(n, int)
    elif shape == "single_entity":
        ents = np.array(["only"] * n)
    elif shape == "one_per_entity":
        ents = np.array(["c%d" % i for i in range(n)])

    if shape == "inverted_model":
        scores = np.where(labels == 1, rng.beta(2, 6, n), rng.beta(6, 2, n))
    elif shape == "flat_scores":
        scores = np.full(n, 0.5)
    else:
        scores = np.where(labels == 1, rng.beta(5, 2, n), rng.beta(2, 5, n))
    return times, ents, scores, labels


def clean_entities(ents, labels):
    fraud = set()
    for e, y in zip(ents, labels):
        if y == 1:
            fraud.add(e)
    return set(ents) - fraud


def collateral(ents, hit, labels):
    clean = clean_entities(ents, labels)
    per = {}
    for e, h in zip(ents, hit):
        if h and e in clean:
            per[e] = per.get(e, 0) + 1
    return per


def drive(times, ents, scores, labels, capacity, latency, truthful=True):
    desk = ReviewDesk(capacity, latency, 1.0, seconds_per_day=1.0)
    truth = {}
    for e, y in zip(ents, labels):
        truth[e] = max(truth.get(e, 0), int(y))
    hit = np.zeros(len(times), np.int8)
    for i in range(len(times)):
        if desk.decide(times[i], ents[i], scores[i]) != "allow":
            hit[i] = 1
        for k in list(desk.held):
            if desk.held[k] <= times[i]:
                desk.verdict(k, truth.get(k, 0) == 1 if truthful else False)
    return desk, hit


@pytest.mark.parametrize("shape", SHAPES)
@pytest.mark.parametrize("seed", [0, 1])
def test_capacity_holds_on_every_stream_shape(shape, seed):
    times, ents, scores, labels = synth(shape, 4000, seed)
    desk, hit = drive(times, ents, scores, labels, 10, 4 / 24)
    span = times.max() - times.min()
    assert desk.stopped_total <= 10 * (span + 2)


@pytest.mark.parametrize("shape", SHAPES)
def test_damage_is_bounded_by_latency_times_rate(shape):
    times, ents, scores, labels = synth(shape, 4000, 3)
    latency = 4 / 24
    desk, hit = drive(times, ents, scores, labels, 10, latency)
    span = max(times.max() - times.min(), 1e-9)
    rate = len(times) / span
    per_entity = collateral(ents, hit, labels)
    worst = max(per_entity.values()) if per_entity else 0
    assert worst <= latency * rate + 10


def test_collateral_on_innocent_customers_grows_with_review_latency():
    times, ents, scores, labels = synth("one_whale", 5000, 2)
    damage = []
    for latency in (1 / 96, 1 / 24, 4 / 24, 1.0, 7.0):
        _, hit = drive(times, ents, scores, labels, 10, latency)
        damage.append(sum(collateral(ents, hit, labels).values()))
    assert damage == sorted(damage)
    assert damage[-1] > 5 * max(damage[0], 1)


def test_a_fast_desk_bounds_innocent_collateral_to_a_handful():
    times, ents, scores, labels = synth("one_whale", 5000, 2)
    _, hit = drive(times, ents, scores, labels, 10, 1 / 24)
    per = collateral(ents, hit, labels)
    assert max(per.values(), default=0) <= 3


def test_stopping_a_guilty_customer_is_not_counted_as_collateral():
    times, ents, scores, labels = synth("one_whale", 5000, 2)
    _, hit = drive(times, ents, scores, labels, 10, 0.0)
    clean = clean_entities(ents, labels)
    assert "whale" not in clean
    assert sum(collateral(ents, hit, labels).values()) < int((hit == 1).sum())


def test_no_calibration_constant_is_carried_between_datasets():
    a = synth("uniform", 3000, 1)
    b = synth("epidemic", 3000, 1)
    desk_a, _ = drive(*a, capacity=10, latency=4 / 24)
    desk_b, _ = drive(*b, capacity=10, latency=4 / 24)
    assert desk_a.queue.capacity == desk_b.queue.capacity
    assert desk_a.latency == desk_b.latency


def test_an_unhelpful_model_costs_recall_but_never_breaks_the_budget():
    times, ents, scores, labels = synth("inverted_model", 4000, 5)
    desk, hit = drive(times, ents, scores, labels, 10, 4 / 24)
    span = times.max() - times.min()
    assert desk.stopped_total <= 10 * (span + 2)


def test_a_silent_analyst_leaves_visible_pending_reviews_rather_than_failing_open():
    times, ents, scores, labels = synth("uniform", 3000, 6)
    desk = ReviewDesk(10, 1 / 24, 1.0, seconds_per_day=1.0)
    for i in range(len(times)):
        desk.decide(times[i], ents[i], scores[i])
    assert desk.stopped_total > 0
    assert len(desk.pending_reviews()) == desk.stopped_total
    assert len(desk.due(times[-1])) == desk.stopped_total


def test_a_grace_period_releases_customers_the_desk_never_got_to():
    times, ents, scores, labels = synth("uniform", 3000, 6)
    desk = ReviewDesk(10, 1 / 24, 1.0, seconds_per_day=1.0, grace_days=0.5)
    for i in range(len(times)):
        desk.decide(times[i], ents[i], scores[i])
    assert desk.abandoned > 0
    assert len(desk.pending_reviews()) < desk.stopped_total


def test_holding_forever_is_never_silent():
    desk = ReviewDesk(1, 1 / 24, 1.0, seconds_per_day=1.0)
    desk.decide(0.0, "a", 0.9)
    desk.decide(1.0, "b", 0.9)
    assert desk.abandoned == 0
    assert "a" in desk.pending_reviews()
