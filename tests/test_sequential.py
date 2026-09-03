import numpy as np
import pytest
from scipy.stats import norm

from rzero.sequential import (BLOCK, CLEAR, WATCH, EvidenceScale,
                              SequentialTest, wald_boundaries)


def calibrated_evidence(n_sequences, length, separation, is_fraud, rng,
                        overconfidence=1.0):
    centre = np.where(np.full(n_sequences, is_fraud), separation, 0.0)[:, None]
    draws = rng.normal(centre, 1.0, (n_sequences, length))
    return overconfidence * (separation * draws - separation ** 2 / 2)


def run_sequences(evidence, upper, lower):
    outcomes = []
    for sequence in evidence:
        total = 0.0
        verdict = WATCH
        for value in sequence:
            total += value
            if total >= upper:
                verdict = BLOCK
                break
            if total <= lower:
                verdict = CLEAR
                break
        outcomes.append(verdict)
    return np.array(outcomes)


def test_boundaries_match_the_closed_form():
    lower, upper = wald_boundaries(0.01, 0.10)
    assert upper == pytest.approx(np.log(0.90 / 0.01))
    assert lower == pytest.approx(np.log(0.10 / 0.99))


@pytest.mark.parametrize("bad", [(0, 0.1), (0.5, 1.0), (-0.1, 0.2)])
def test_invalid_rates_are_rejected(bad):
    with pytest.raises(ValueError):
        wald_boundaries(*bad)


@pytest.mark.parametrize("false_alarm,miss", [(0.01, 0.10), (0.05, 0.20)])
def test_designed_error_rates_are_honoured(false_alarm, miss):
    rng = np.random.default_rng(1)
    lower, upper = wald_boundaries(false_alarm, miss)

    legitimate = calibrated_evidence(4000, 400, 1.0, False, rng)
    fraudulent = calibrated_evidence(4000, 400, 1.0, True, rng)

    assert (run_sequences(legitimate, upper, lower) == BLOCK).mean() <= false_alarm * 1.35
    assert (run_sequences(fraudulent, upper, lower) == CLEAR).mean() <= miss * 1.35


def test_overconfident_evidence_silently_breaks_the_guarantee():
    rng = np.random.default_rng(2)
    lower, upper = wald_boundaries(0.01, 0.10)

    honest = calibrated_evidence(4000, 400, 1.0, False, rng, overconfidence=1.0)
    inflated = calibrated_evidence(4000, 400, 1.0, False, rng, overconfidence=4.0)

    assert (run_sequences(honest, upper, lower) == BLOCK).mean() <= 0.0135
    assert (run_sequences(inflated, upper, lower) == BLOCK).mean() > 0.03


def test_sequential_needs_fewer_observations_than_a_fixed_test():
    rng = np.random.default_rng(3)
    separation = 0.5
    lower, upper = wald_boundaries(0.01, 0.10)
    fraudulent = calibrated_evidence(2000, 2000, separation, True, rng)

    lengths = []
    for sequence in fraudulent:
        total = 0.0
        for index, value in enumerate(sequence, start=1):
            total += value
            if total >= upper or total <= lower:
                break
        lengths.append(index)

    fixed_size = ((norm.ppf(0.99) + norm.ppf(0.90)) / separation) ** 2
    assert np.mean(lengths) < fixed_size


def correlated_population(n_entities, per_entity, separation, rng):
    is_fraud = rng.random(n_entities) < 0.2
    shared = rng.normal(0, 2.0, n_entities)
    centre = np.where(is_fraud, separation, 0.0)[:, None]
    draws = rng.normal(centre, 1.0, (n_entities, per_entity)) + shared[:, None]
    scores = 1 / (1 + np.exp(-draws.ravel()))
    entities = np.repeat(np.arange(n_entities), per_entity)
    return scores, np.repeat(is_fraud.astype(int), per_entity), entities


def test_calibrated_boundary_restores_the_target_when_evidence_correlates():
    rng = np.random.default_rng(21)
    fit_scores, fit_labels, fit_entities = correlated_population(2000, 20, 1.2, rng)
    new_scores, new_labels, new_entities = correlated_population(2000, 20, 1.2, rng)
    times = np.arange(len(fit_entities))

    evidence = EvidenceScale().fit(fit_scores, fit_labels)

    textbook = SequentialTest.from_target_rates(evidence, 0.01, 0.10)
    textbook_decisions, _ = textbook.run(new_scores, new_entities, times)
    textbook_rate = (textbook_decisions[new_labels == 0] == BLOCK).mean()

    calibrated, _ = SequentialTest.calibrated(
        evidence, fit_scores, fit_labels, fit_entities, times)
    calibrated_decisions, _ = calibrated.run(new_scores, new_entities, times)
    calibrated_rate = (calibrated_decisions[new_labels == 0] == BLOCK).mean()

    assert textbook_rate > 0.03
    assert calibrated_rate < 0.03
    assert calibrated_rate < textbook_rate / 2


def test_decisions_depend_on_arrival_order():
    rng = np.random.default_rng(4)
    n = 4000
    entities = rng.integers(0, 400, n)
    times = rng.random(n)
    labels = (rng.random(n) < 0.1).astype(int)
    scores = np.clip(rng.normal(np.where(labels == 1, 0.7, 0.3), 0.15), 0, 1)

    test = SequentialTest.from_target_rates(EvidenceScale().fit(scores, labels))
    in_order, _ = test.run(scores, entities, times)
    shuffled, _ = test.run(scores, entities, rng.permutation(times))

    assert np.mean(in_order != shuffled) > 0.01


def test_batch_run_is_deterministic():
    rng = np.random.default_rng(9)
    n = 5000
    entities = rng.integers(0, 300, n)
    times = rng.random(n)
    labels = (rng.random(n) < 0.1).astype(int)
    scores = np.clip(rng.normal(np.where(labels == 1, 0.7, 0.3), 0.15), 0, 1)

    test = SequentialTest.from_target_rates(EvidenceScale().fit(scores, labels))
    first, first_stats = test.run(scores, entities, times)
    second, second_stats = test.run(scores, entities, times)

    assert np.array_equal(first, second)
    assert np.allclose(first_stats, second_stats)
