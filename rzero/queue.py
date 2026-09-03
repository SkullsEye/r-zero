import heapq
import math

DEFAULT_PERIOD_DAYS = 1.0


class ReviewQueue:
    def __init__(self, capacity, period_days=DEFAULT_PERIOD_DAYS,
                 seconds_per_day=86400.0, carry_over=False):
        if capacity < 0:
            raise ValueError("capacity must not be negative")
        if period_days <= 0:
            raise ValueError("period_days must be positive")
        self.capacity = int(capacity)
        self.period_days = float(period_days)
        self.seconds_per_day = float(seconds_per_day)
        self.carry_over = bool(carry_over)
        self.resolved = {}
        self.pending = {}
        self.period_end = None
        self.clock = None
        self.periods_closed = 0
        self.selected_total = 0

    def _advance(self, now):
        if self.period_end is None:
            self.period_end = now + self.period_days
            return []
        closed = []
        while now >= self.period_end:
            closed.extend(self._close())
            self.period_end += self.period_days
        return closed

    def _close(self):
        ranked = sorted(((s, k) for k, s in self.pending.items()
                         if k not in self.resolved), reverse=True)
        chosen = [k for _, k in ranked[:self.capacity]]
        for k in chosen:
            self.resolved[k] = None
        self.selected_total += len(chosen)
        self.periods_closed += 1
        if self.carry_over:
            for k in chosen:
                self.pending.pop(k, None)
        else:
            self.pending = {}
        return chosen

    def offer(self, timestamp, entity, score):
        now = float(timestamp) / self.seconds_per_day
        if self.clock is not None and now < self.clock:
            raise ValueError("timestamps must not go backwards")
        self.clock = now
        closed = self._advance(now)
        if entity is None or entity == "":
            return closed
        if entity in self.resolved:
            return closed
        if not math.isfinite(score):
            return closed
        if score > self.pending.get(entity, -math.inf):
            self.pending[entity] = score
        return closed

    def flush(self):
        return self._close()

    def verdict(self, entity, is_fraud):
        if entity in self.resolved:
            self.resolved[entity] = bool(is_fraud)

    def status(self, entity):
        if entity not in self.resolved:
            return "unseen"
        outcome = self.resolved[entity]
        return "awaiting" if outcome is None else ("blocked" if outcome else "cleared")

    def is_resolved(self, entity):
        return entity in self.resolved


def allocate(times, entities, scores, capacity, period_days=DEFAULT_PERIOD_DAYS,
             seconds_per_day=1.0):
    n = len(times)
    order = sorted(range(n), key=lambda i: times[i])
    queue = ReviewQueue(capacity, period_days, seconds_per_day)
    picked_at = {}
    flagged = [0] * n
    for i in order:
        for k in queue.offer(times[i], entities[i], scores[i]):
            picked_at.setdefault(k, queue.clock)
        if entities[i] in picked_at:
            flagged[i] = 1
    for k in queue.flush():
        picked_at.setdefault(k, queue.clock)
    return flagged, picked_at


def precision_at_capacity(flagged, labels, entities):
    seen, fraud = {}, {}
    for f, y, k in zip(flagged, labels, entities):
        if f:
            seen[k] = True
        if y == 1:
            fraud[k] = True
    if not seen:
        return 0.0
    return sum(1 for k in seen if k in fraud) / len(seen)


class ReviewDesk:
    def __init__(self, capacity, review_latency_days=4.0 / 24.0,
                 period_days=DEFAULT_PERIOD_DAYS, seconds_per_day=86400.0,
                 grace_days=0.0):
        if review_latency_days < 0:
            raise ValueError("review_latency_days must not be negative")
        self.queue = ReviewQueue(capacity, period_days, seconds_per_day)
        self.latency = float(review_latency_days)
        self.seconds_per_day = float(seconds_per_day)
        self.held = {}
        self.blocked = set()
        self.cleared = set()
        self.awaiting = []
        self.sequence = 0
        self.clock = None
        self.stopped_total = 0
        self.released_total = 0
        self.abandoned = 0
        self.grace = float(grace_days)

    def due(self, timestamp=None):
        now = self.clock if timestamp is None else float(timestamp) / self.seconds_per_day
        ready = []
        while self.awaiting and self.awaiting[0][0] <= now:
            _, _, entity = heapq.heappop(self.awaiting)
            if entity in self.held:
                ready.append(entity)
        return ready

    def _release(self, now):
        while self.awaiting and self.awaiting[0][0] <= now + self.grace:
            _, _, entity = heapq.heappop(self.awaiting)
            self.held.pop(entity, None)
            self.abandoned += 1

    def decide(self, timestamp, entity, score):
        now = float(timestamp) / self.seconds_per_day
        self.clock = now
        if self.grace > 0:
            self._release(now)
        if entity in self.blocked:
            return "block"
        if entity in self.held:
            return "hold"
        for picked in self.queue.offer(timestamp, entity, score):
            if picked in self.blocked or picked in self.cleared:
                continue
            self.held[picked] = now + self.latency
            heapq.heappush(self.awaiting, (now + self.latency, self.sequence, picked))
            self.sequence += 1
            self.stopped_total += 1
        if entity in self.held:
            return "hold"
        return "allow"

    def verdict(self, entity, is_fraud):
        self.queue.verdict(entity, is_fraud)
        self.held.pop(entity, None)
        if is_fraud:
            self.blocked.add(entity)
        else:
            self.cleared.add(entity)
            self.released_total += 1

    def pending_reviews(self):
        return list(self.held)

    def worst_case_exposure(self, transactions_per_day):
        return self.latency * transactions_per_day
