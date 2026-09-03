import numpy as np

try:
    from numba import njit
except ImportError:
    def njit(*args, **kwargs):
        if len(args) == 1 and callable(args[0]) and not kwargs:
            return args[0]
        return lambda fn: fn


OBSERVE = 0
CONTRIBUTE = 1


@njit(cache=True)
def _scan_events(event_time, event_kind, event_entity, event_weight,
                 event_row, n_entities, decay_rates, n_rows):
    n_rates = decay_rates.shape[0]
    accumulated = np.zeros((n_entities, n_rates))
    updated_at = np.zeros((n_entities, n_rates))
    observed = np.zeros((n_rows, n_rates))

    for i in range(event_time.shape[0]):
        entity = event_entity[i]
        if entity < 0:
            continue
        now = event_time[i]

        for k in range(n_rates):
            elapsed = now - updated_at[entity, k]
            if elapsed > 0:
                accumulated[entity, k] *= np.exp(-decay_rates[k] * elapsed)
                updated_at[entity, k] = now

        if event_kind[i] == OBSERVE:
            row = event_row[i]
            for k in range(n_rates):
                observed[row, k] = accumulated[entity, k]
        else:
            for k in range(n_rates):
                accumulated[entity, k] += event_weight[i]

    return observed


def decayed_history(times, entity_codes, n_entities, contributes, decay_rates,
                    weights=None, confirmation_delay=0.0):
    times = np.ascontiguousarray(np.asarray(times, float))
    entity_codes = np.ascontiguousarray(np.asarray(entity_codes, np.int64))
    n_rows = len(times)
    weights = np.ones(n_rows) if weights is None else np.asarray(weights, float)
    contributors = np.where(np.asarray(contributes))[0]

    event_time = np.concatenate([times, times[contributors] + confirmation_delay])
    event_kind = np.concatenate([
        np.full(n_rows, OBSERVE, np.int64),
        np.full(len(contributors), CONTRIBUTE, np.int64)])
    event_entity = np.concatenate([entity_codes, entity_codes[contributors]])
    event_weight = np.concatenate([np.zeros(n_rows), weights[contributors]])
    event_row = np.concatenate([
        np.arange(n_rows, dtype=np.int64),
        np.full(len(contributors), -1, np.int64)])

    order = np.lexsort((event_kind, event_time))

    return _scan_events(
        np.ascontiguousarray(event_time[order]),
        np.ascontiguousarray(event_kind[order]),
        np.ascontiguousarray(event_entity[order]),
        np.ascontiguousarray(event_weight[order]),
        np.ascontiguousarray(event_row[order]),
        int(n_entities),
        np.ascontiguousarray(decay_rates, float),
        n_rows)


@njit(cache=True)
def _scan_running(times, entities, amounts, n_entities, n_rows):
    seen = np.zeros(n_entities)
    spent = np.zeros(n_entities)
    first_seen = np.full(n_entities, -1.0)
    last_seen = np.full(n_entities, -1.0)
    out = np.zeros((n_rows, 4))

    for i in range(n_rows):
        entity = entities[i]
        if entity < 0:
            out[i, 0] = -1.0
            out[i, 1] = -1.0
            out[i, 2] = -1.0
            out[i, 3] = -1.0
            continue

        count = seen[entity]
        out[i, 0] = count
        out[i, 1] = spent[entity] / count if count > 0 else -1.0
        out[i, 2] = times[i] - first_seen[entity] if first_seen[entity] >= 0 else -1.0
        out[i, 3] = times[i] - last_seen[entity] if last_seen[entity] >= 0 else -1.0

        seen[entity] = count + 1
        spent[entity] += amounts[i]
        if first_seen[entity] < 0:
            first_seen[entity] = times[i]
        last_seen[entity] = times[i]

    return out


def entity_history(times, entity_codes, amounts, n_entities):
    return _scan_running(
        np.ascontiguousarray(np.asarray(times, float)),
        np.ascontiguousarray(np.asarray(entity_codes, np.int64)),
        np.ascontiguousarray(np.asarray(amounts, float)),
        int(n_entities),
        len(times))
