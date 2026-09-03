import numpy as np

BLOCK = 1
CLEAR = -1
WATCH = 0


def wald_boundaries(false_alarm_rate, miss_rate):
    if not (0 < false_alarm_rate < 1 and 0 < miss_rate < 1):
        raise ValueError("rates must lie strictly between 0 and 1")
    upper = np.log((1.0 - miss_rate) / false_alarm_rate)
    lower = np.log(miss_rate / (1.0 - false_alarm_rate))
    return lower, upper


class EvidenceScale:
    def __init__(self, n_bins=25, smoothing=1.0, clip=6.0):
        self.n_bins = n_bins
        self.smoothing = smoothing
        self.clip = clip
        self.edges = None
        self.log_ratio = None

    def fit(self, scores, labels):
        scores = np.asarray(scores, float)
        labels = np.asarray(labels).astype(int)

        quantiles = np.quantile(scores, np.linspace(0, 1, self.n_bins + 1))
        quantiles[0], quantiles[-1] = -np.inf, np.inf
        self.edges = np.unique(quantiles)

        bins = self._bin(scores)
        n_bins = len(self.edges) - 1
        fraud = np.bincount(bins[labels == 1], minlength=n_bins) + self.smoothing
        legit = np.bincount(bins[labels == 0], minlength=n_bins) + self.smoothing

        self.log_ratio = np.clip(
            np.log((fraud / fraud.sum()) / (legit / legit.sum())),
            -self.clip, self.clip)
        return self

    def _bin(self, scores):
        return np.clip(np.digitize(scores, self.edges[1:-1]),
                       0, len(self.edges) - 2)

    def __call__(self, scores):
        if self.log_ratio is None:
            raise RuntimeError("fit the evidence scale first")
        return self.log_ratio[self._bin(np.asarray(scores, float))]


class SequentialTest:
    def __init__(self, evidence_scale, upper, lower):
        self.evidence = evidence_scale
        self.upper = upper
        self.lower = lower

    @classmethod
    def from_target_rates(cls, evidence_scale, false_alarm_rate=0.01,
                          miss_rate=0.10):
        lower, upper = wald_boundaries(false_alarm_rate, miss_rate)
        return cls(evidence_scale, upper, lower)

    @classmethod
    def calibrated(cls, evidence_scale, scores, labels, entities, times,
                   false_alarm_rate=0.01, miss_rate=0.10):
        lower = np.log(miss_rate / (1.0 - false_alarm_rate))
        running = _accumulate(evidence_scale, scores, entities, times, lower)
        legitimate = running[np.asarray(labels) == 0]
        if not len(legitimate):
            _, upper = wald_boundaries(false_alarm_rate, miss_rate)
            return cls(evidence_scale, upper, lower), float("nan")
        upper = float(np.quantile(legitimate, 1.0 - false_alarm_rate))
        achieved = float((legitimate >= upper).mean())
        return cls(evidence_scale, upper, lower), achieved

    def run(self, scores, entities, times):
        scores = np.asarray(scores, float)
        entities = np.asarray(entities)
        order = np.argsort(np.asarray(times), kind="stable")
        evidence = self.evidence(scores[order])
        ordered_entities = entities[order]

        totals = {}
        settled = {}
        decisions = np.zeros(len(scores), dtype=int)
        statistics = np.zeros(len(scores))

        for position in range(len(order)):
            entity = ordered_entities[position]
            row = order[position]

            if entity in settled:
                decisions[row] = settled[entity]
                statistics[row] = totals[entity]
                continue

            total = totals.get(entity, 0.0) + evidence[position]
            totals[entity] = total
            statistics[row] = total

            if total >= self.upper:
                decisions[row] = settled[entity] = BLOCK
            elif total <= self.lower:
                decisions[row] = settled[entity] = CLEAR
            else:
                decisions[row] = WATCH

        return decisions, statistics


def _accumulate(evidence_scale, scores, entities, times, lower):
    order = np.argsort(np.asarray(times), kind="stable")
    evidence = evidence_scale(np.asarray(scores, float)[order])
    ordered_entities = np.asarray(entities)[order]

    totals = {}
    cleared = set()
    running = np.empty(len(order))

    for position in range(len(order)):
        entity = ordered_entities[position]
        if entity in cleared:
            running[position] = totals[entity]
            continue
        total = totals.get(entity, 0.0) + evidence[position]
        totals[entity] = total
        running[position] = total
        if total <= lower:
            cleared.add(entity)

    return running
