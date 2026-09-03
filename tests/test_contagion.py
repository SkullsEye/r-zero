import numpy as np
import pytest
from sklearn.metrics import roc_auc_score

from rzero.contagion import decayed_history, entity_history
from rzero.features import DECAY_RATES


def clustered_fraud(n=4000, n_entities=200, seed=0):
    rng = np.random.default_rng(seed)
    times = np.sort(rng.uniform(0, 60, n))
    entities = rng.integers(0, n_entities, n).astype(np.int64)
    compromised = set(rng.choice(n_entities, 20, replace=False).tolist())
    labels = np.array([
        1 if (e in compromised and rng.random() < 0.35)
        else (1 if rng.random() < 0.01 else 0) for e in entities])
    return times, entities, labels, n_entities


def test_own_outcome_never_reaches_own_features():
    times, entities, labels, n_entities = clustered_fraud()
    reference = decayed_history(times, entities, n_entities, labels == 1,
                                DECAY_RATES, confirmation_delay=0.0)

    for row in np.where(labels == 1)[0][:25]:
        altered = labels.copy()
        altered[row] = 0
        recomputed = decayed_history(times, entities, n_entities, altered == 1,
                                     DECAY_RATES, confirmation_delay=0.0)
        assert np.array_equal(reference[row], recomputed[row])


def test_shuffled_labels_destroy_the_signal():
    times, entities, labels, n_entities = clustered_fraud()
    real = decayed_history(times, entities, n_entities, labels == 1,
                           DECAY_RATES, confirmation_delay=1.0)
    assert roc_auc_score(labels, real[:, 1]) > 0.65

    rng = np.random.default_rng(1)
    for _ in range(5):
        shuffled = rng.permutation(labels)
        noise = decayed_history(times, entities, n_entities, shuffled == 1,
                                DECAY_RATES, confirmation_delay=1.0)
        assert abs(roc_auc_score(shuffled, noise[:, 1]) - 0.5) < 0.05


def test_simultaneous_events_are_read_before_written():
    times = np.array([1.0, 1.0, 1.0, 2.0])
    entities = np.zeros(4, np.int64)
    labels = np.array([1, 1, 0, 0])

    observed = decayed_history(times, entities, 1, labels == 1,
                               np.array([0.001]), confirmation_delay=0.0)

    assert observed[0, 0] == 0.0
    assert observed[1, 0] == 0.0
    assert observed[2, 0] == 0.0
    assert observed[3, 0] > 1.9


def test_longer_confirmation_delay_weakens_the_feature():
    times, entities, labels, n_entities = clustered_fraud()
    scores = []
    for delay in (0.0, 1.0, 7.0, 30.0, 365.0):
        observed = decayed_history(times, entities, n_entities, labels == 1,
                                   DECAY_RATES, confirmation_delay=delay)
        scores.append(roc_auc_score(labels, observed[:, 1]))

    assert all(scores[i] >= scores[i + 1] - 0.02 for i in range(len(scores) - 1))
    assert scores[-1] < 0.55


def test_influence_decays_with_elapsed_time():
    times = np.array([0.0, 0.5, 1.0, 5.0, 30.0])
    entities = np.zeros(5, np.int64)
    labels = np.array([1, 0, 0, 0, 0])

    observed = decayed_history(times, entities, 1, labels == 1, DECAY_RATES,
                               confirmation_delay=0.0)

    assert observed[0, 0] == 0.0
    assert np.all(np.diff(observed[1:, 0]) < 0)


def test_missing_identities_contribute_nothing():
    times = np.array([0.0, 1.0, 2.0, 3.0])
    entities = np.array([-1, -1, 0, 0], np.int64)
    labels = np.array([1, 1, 1, 0])

    observed = decayed_history(times, entities, 1, labels == 1, np.array([0.5]))

    assert np.all(observed[:2] == 0.0)
    assert np.isfinite(observed).all()


def test_entity_history_is_strictly_backward_looking():
    times = np.array([0.0, 1.0, 2.0, 3.0])
    entities = np.zeros(4, np.int64)
    amounts = np.array([100.0, 200.0, 300.0, 400.0])

    history = entity_history(times, entities, amounts, 1)

    assert list(history[:, 0]) == [0, 1, 2, 3]
    assert history[0, 1] == -1.0
    assert history[1, 1] == pytest.approx(100.0)
    assert history[3, 1] == pytest.approx(200.0)


def test_identical_input_gives_identical_features():
    times, entities, labels, n_entities = clustered_fraud(seed=9)
    first = decayed_history(times, entities, n_entities, labels == 1, DECAY_RATES)
    second = decayed_history(times, entities, n_entities, labels == 1, DECAY_RATES)
    assert np.array_equal(first, second)
