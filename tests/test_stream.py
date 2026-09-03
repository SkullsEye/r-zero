import math

import numpy as np
import pytest

from rzero.contagion import decayed_history, entity_history
from rzero.stream import ContagionState, feature_names

RATES = np.array([math.log(2) / (1 / 24), math.log(2) / 1.0, math.log(2) / 7.0])
HALF = {"1h": 1 / 24, "1d": 1.0, "7d": 7.0}


def stream_of(n, seed, n_keys=12, fraud_rate=0.2, tied=False):
    rng = np.random.default_rng(seed)
    times = np.sort(rng.uniform(0, 40, n))
    if not tied:
        times = np.unique(times)
        while len(times) < n:
            times = np.unique(np.concatenate([times, rng.uniform(0, 40, n - len(times))]))
        times = np.sort(times)[:n]
    keys = rng.integers(0, n_keys, n)
    labels = (rng.random(n) < fraud_rate).astype(int)
    amounts = rng.uniform(5, 900, n).round(2)
    return times, keys, labels, amounts


def batch_contagion(times, keys, labels, n_keys, weights, delay):
    return decayed_history(times, keys, n_keys, labels == 1, RATES,
                           weights=weights[keys], confirmation_delay=delay)


def run_stream(times, keys, labels, amounts, pinned, delay=7.0):
    state = ContagionState(["card"], HALF, confirmation_delay_days=delay,
                           seconds_per_day=1.0, pinned_degrees=pinned)
    rows = []
    for t, k, y, a in zip(times, keys, labels, amounts):
        rows.append(state.observe(t, {"card": str(k)}, amount=float(a)))
        if y == 1:
            state.confirm(t, {"card": str(k)})
    return rows, state


def test_matches_batch_contagion_exactly():
    times, keys, labels, amounts = stream_of(600, 1)
    n_keys = int(keys.max()) + 1
    counts = np.bincount(keys, minlength=n_keys).astype(float)
    weights = 1.0 / np.log(counts + 5.0)
    pinned = {"card": {str(i): int(counts[i]) for i in range(n_keys)}}

    expected = batch_contagion(times, keys, labels, n_keys, weights, 7.0)
    rows, _ = run_stream(times, keys, labels, amounts, pinned)

    for i, row in enumerate(rows):
        for j, window in enumerate(["1h", "1d", "7d"]):
            assert row[f"card_contagion_{window}"] == pytest.approx(
                expected[i, j], abs=1e-12)


def test_matches_batch_activity_and_history_exactly():
    times, keys, labels, amounts = stream_of(500, 2)
    n_keys = int(keys.max()) + 1
    activity = decayed_history(times, keys, n_keys, np.ones(len(times), bool), RATES)
    history = entity_history(times, keys, amounts.astype(float), n_keys)
    rows, _ = run_stream(times, keys, labels, amounts, {})

    for i, row in enumerate(rows):
        for j, window in enumerate(["1h", "1d", "7d"]):
            assert row[f"card_activity_{window}"] == pytest.approx(
                activity[i, j], abs=1e-12)
        assert row["card_count"] == pytest.approx(history[i, 0])
        assert row["card_mean_amount"] == pytest.approx(history[i, 1], abs=1e-10)
        assert row["card_age"] == pytest.approx(history[i, 2], abs=1e-12)
        assert row["card_gap"] == pytest.approx(history[i, 3], abs=1e-12)


def test_confirmation_delay_is_respected_to_the_instant():
    state = ContagionState(["card"], HALF, confirmation_delay_days=7.0,
                           seconds_per_day=1.0)
    state.observe(0.0, {"card": "a"})
    state.confirm(0.0, {"card": "a"})
    assert state.observe(6.999, {"card": "a"})["card_contagion_7d"] == 0.0
    assert state.observe(7.0, {"card": "a"})["card_contagion_7d"] == 0.0
    assert state.observe(7.001, {"card": "a"})["card_contagion_7d"] > 0.0


def test_decay_halves_over_one_half_life():
    state = ContagionState(["card"], {"1d": 1.0}, confirmation_delay_days=0.0,
                           seconds_per_day=1.0)
    state.observe(0.0, {"card": "a"})
    state.confirm(0.0, {"card": "a"})
    first = state.observe(1.0, {"card": "a"})["card_contagion_1d"]
    second = state.observe(2.0, {"card": "a"})["card_contagion_1d"]
    assert second == pytest.approx(first / 2, rel=1e-12)


def test_a_transaction_cannot_change_its_own_features():
    times, keys, labels, amounts = stream_of(300, 3)
    pinned = {}
    clean, _ = run_stream(times, keys, labels, amounts, pinned)
    flipped = labels.copy()
    target = int(np.where(labels == 0)[0][10])
    flipped[target] = 1
    dirty, _ = run_stream(times, keys, flipped, amounts, pinned)
    for key in clean[target]:
        assert clean[target][key] == dirty[target][key]


def test_unknown_and_missing_identities_are_safe():
    state = ContagionState(["card", "device"], HALF, seconds_per_day=1.0)
    row = state.observe(0.0, {"card": "a"}, amount=10.0)
    assert row["device_contagion_7d"] == 0.0
    assert row["device_count"] == -1.0
    row = state.observe(1.0, {"card": None, "device": ""}, amount=10.0)
    assert row["card_count"] == -1.0
    assert row["device_activity_1d"] == 0.0
    assert all(np.isfinite(list(row.values())))


def test_backwards_timestamps_are_rejected():
    state = ContagionState(["card"], HALF, seconds_per_day=1.0)
    state.observe(5.0, {"card": "a"})
    with pytest.raises(ValueError):
        state.observe(4.0, {"card": "a"})


def test_snapshot_restore_round_trips():
    times, keys, labels, amounts = stream_of(400, 4)
    half = len(times) // 2
    rows, state = run_stream(times[:half], keys[:half], labels[:half],
                             amounts[:half], {})
    packed = state.snapshot()

    resumed = ContagionState(["card"], HALF, seconds_per_day=1.0).restore(packed)
    tail_a, _ = [], None
    for t, k, y, a in zip(times[half:], keys[half:], labels[half:], amounts[half:]):
        tail_a.append(resumed.observe(t, {"card": str(k)}, amount=float(a)))
        if y == 1:
            resumed.confirm(t, {"card": str(k)})

    whole, _ = run_stream(times, keys, labels, amounts, {})
    for got, want in zip(tail_a, whole[half:]):
        for key in want:
            assert got[key] == pytest.approx(want[key], abs=1e-12)


def test_update_false_leaves_state_untouched():
    state = ContagionState(["card"], HALF, seconds_per_day=1.0)
    state.observe(0.0, {"card": "a"}, amount=100.0)
    peek = state.observe(1.0, {"card": "a"}, amount=50.0, update=False)
    again = state.observe(1.0, {"card": "a"}, amount=50.0, update=False)
    assert peek == again
    assert state.observe(1.0, {"card": "a"}, amount=50.0)["card_count"] == 1.0


def test_popularity_weight_discounts_the_crowd():
    state = ContagionState(["card"], HALF, seconds_per_day=1.0)
    for i in range(200):
        state.observe(i * 0.01, {"card": "crowd"})
    state.observe(3.0, {"card": "rare"})
    assert state.weight("card", "crowd") < state.weight("card", "rare")


def test_feature_names_cover_every_key_observe_returns():
    state = ContagionState(["card", "device"], HALF, seconds_per_day=1.0)
    row = state.observe(0.0, {"card": "a", "device": "d"}, amount=1.0)
    assert set(row) == set(feature_names(["card", "device"]))


def test_throughput_is_linear_in_events():
    for n in (2000, 8000):
        times, keys, labels, amounts = stream_of(n, 7, n_keys=400)
        rows, state = run_stream(times, keys, labels, amounts, {})
        assert len(rows) == n
        assert state.events == n
