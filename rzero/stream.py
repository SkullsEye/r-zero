import heapq
import math

from rzero.features import DECAY_NAMES, HALF_LIVES_IN_DAYS

SECONDS_PER_DAY = 86400.0
DEFAULT_SOFTENING = 5.0


class _Identity:
    __slots__ = ("contagion", "activity", "contagion_clock", "activity_clock",
                 "degree", "count", "total", "first_seen", "last_seen")

    def __init__(self, n_rates):
        self.contagion = [0.0] * n_rates
        self.activity = [0.0] * n_rates
        self.contagion_clock = 0.0
        self.activity_clock = 0.0
        self.degree = 0
        self.count = 0
        self.total = 0.0
        self.first_seen = None
        self.last_seen = None


class ContagionState:
    def __init__(self, families, half_lives_in_days=None,
                 confirmation_delay_days=7.0, softening=DEFAULT_SOFTENING,
                 seconds_per_day=SECONDS_PER_DAY, pinned_degrees=None):
        half_lives = half_lives_in_days or HALF_LIVES_IN_DAYS
        self.families = list(families)
        self.window_names = list(half_lives)
        self.decay_rates = [math.log(2.0) / h for h in half_lives.values()]
        self.confirmation_delay_days = float(confirmation_delay_days)
        self.softening = float(softening)
        self.seconds_per_day = float(seconds_per_day)
        self.pinned_degrees = pinned_degrees or {}
        self.tables = {family: {} for family in self.families}
        self.pending = []
        self.clock = 0.0
        self.events = 0

    def _identity(self, family, key):
        table = self.tables[family]
        record = table.get(key)
        if record is None:
            record = _Identity(len(self.decay_rates))
            record.contagion_clock = self.clock
            record.activity_clock = self.clock
            record.degree = self.pinned_degrees.get(family, {}).get(key, 0)
            table[key] = record
        return record

    def _release(self, now):
        while self.pending and self.pending[0][0] < now:
            at, family, key, weight = heapq.heappop(self.pending)
            record = self._identity(family, key)
            elapsed = at - record.contagion_clock
            if elapsed > 0:
                for i, rate in enumerate(self.decay_rates):
                    record.contagion[i] *= math.exp(-rate * elapsed)
                record.contagion_clock = at
            for i in range(len(self.decay_rates)):
                record.contagion[i] += weight

    def _decay(self, record, now):
        elapsed = now - record.contagion_clock
        if elapsed > 0:
            for i, rate in enumerate(self.decay_rates):
                record.contagion[i] *= math.exp(-rate * elapsed)
            record.contagion_clock = now
        elapsed = now - record.activity_clock
        if elapsed > 0:
            for i, rate in enumerate(self.decay_rates):
                record.activity[i] *= math.exp(-rate * elapsed)
            record.activity_clock = now

    def weight(self, family, key):
        degree = self.pinned_degrees.get(family, {}).get(key)
        if degree is None:
            record = self.tables[family].get(key)
            degree = record.degree if record is not None else 0
        return 1.0 / math.log(degree + self.softening)

    def observe(self, timestamp, identities, amount=None, update=True):
        now = float(timestamp) / self.seconds_per_day
        if now < self.clock:
            raise ValueError("timestamps must not go backwards")
        self.clock = now
        self._release(now)

        features = {}
        for family in self.families:
            key = identities.get(family)
            if key is None or key == "":
                for window in self.window_names:
                    features[f"{family}_contagion_{window}"] = 0.0
                    features[f"{family}_activity_{window}"] = 0.0
                features[f"{family}_count"] = -1.0
                features[f"{family}_mean_amount"] = -1.0
                features[f"{family}_age"] = -1.0
                features[f"{family}_gap"] = -1.0
                features[f"{family}_amount_vs_mean"] = -1.0
                continue

            record = self._identity(family, key)
            self._decay(record, now)
            for i, window in enumerate(self.window_names):
                features[f"{family}_contagion_{window}"] = record.contagion[i]
                features[f"{family}_activity_{window}"] = record.activity[i]

            mean = record.total / record.count if record.count else -1.0
            features[f"{family}_count"] = float(record.count)
            features[f"{family}_mean_amount"] = mean
            features[f"{family}_age"] = (now - record.first_seen
                                         if record.first_seen is not None else -1.0)
            features[f"{family}_gap"] = (now - record.last_seen
                                         if record.last_seen is not None else -1.0)
            features[f"{family}_amount_vs_mean"] = (
                amount / mean if amount is not None and mean > 0 else -1.0)

            if update:
                record.degree += 1
                record.count += 1
                if amount is not None:
                    record.total += float(amount)
                if record.first_seen is None:
                    record.first_seen = now
                record.last_seen = now
                for i in range(len(self.decay_rates)):
                    record.activity[i] += 1.0

        if update:
            self.events += 1
        return features

    def confirm(self, timestamp, identities, delay_days=None):
        at = (float(timestamp) / self.seconds_per_day
              + (self.confirmation_delay_days if delay_days is None
                 else float(delay_days)))
        for family in self.families:
            key = identities.get(family)
            if key is None or key == "":
                continue
            heapq.heappush(self.pending,
                           (at, family, key, self.weight(family, key)))

    def alight(self, threshold=1e-4):
        window = len(self.decay_rates) - 1
        return sum(1 for table in self.tables.values() for record in table.values()
                   if record.contagion[window] > threshold)

    def snapshot(self):
        return {
            "clock": self.clock,
            "events": self.events,
            "pending": [list(item) for item in sorted(self.pending)],
            "tables": {
                family: {
                    key: [record.contagion, record.activity,
                          record.contagion_clock, record.activity_clock,
                          record.degree, record.count, record.total,
                          record.first_seen, record.last_seen]
                    for key, record in table.items()
                }
                for family, table in self.tables.items()
            },
        }

    def restore(self, state):
        self.clock = state["clock"]
        self.events = state.get("events", 0)
        self.pending = [tuple(item) for item in state["pending"]]
        heapq.heapify(self.pending)
        self.tables = {family: {} for family in self.families}
        for family, table in state["tables"].items():
            if family not in self.tables:
                continue
            for key, packed in table.items():
                record = _Identity(len(self.decay_rates))
                (record.contagion, record.activity, record.contagion_clock,
                 record.activity_clock, record.degree, record.count,
                 record.total, record.first_seen, record.last_seen) = packed
                record.contagion = list(record.contagion)
                record.activity = list(record.activity)
                self.tables[family][key] = record
        return self


def feature_names(families, window_names=None):
    windows = window_names or DECAY_NAMES
    names = []
    for family in families:
        names += [f"{family}_count", f"{family}_mean_amount", f"{family}_age",
                  f"{family}_gap", f"{family}_amount_vs_mean"]
        names += [f"{family}_activity_{w}" for w in windows]
        names += [f"{family}_contagion_{w}" for w in windows]
    return names
