import numpy as np
import pandas as pd

ENTITY_KEYS = {
    "card1": ["card1"],
    "addr1": ["addr1"],
    "client": ["card1", "addr1", "D1n"],
    "card_full": ["card1", "card2", "card3", "card5", "card6"],
    "device": ["DeviceInfo"],
    "device_os": ["DeviceInfo", "id_30", "id_31"],
    "pemail": ["P_emaildomain"],
    "remail": ["R_emaildomain"],
    "screen": ["id_33"],
}

MAX_COMBINED_KEY = 1 << 62


def encode_entity(frame, columns):
    n_rows = len(frame)
    complete = np.ones(n_rows, bool)
    combined = np.zeros(n_rows, np.int64)
    span = 1

    for column in columns:
        codes, distinct = pd.factorize(frame[column], use_na_sentinel=True)
        complete &= codes >= 0
        width = len(distinct) + 1

        if span * width > MAX_COMBINED_KEY:
            _, compacted = np.unique(combined, return_inverse=True)
            combined = compacted.astype(np.int64)
            span = len(_)

        combined = combined * width + (codes + 1)
        span *= width

    result = np.full(n_rows, -1, np.int64)
    if not complete.any():
        return result, 0

    distinct, index = np.unique(combined[complete], return_inverse=True)
    result[complete] = index
    return result, len(distinct)


def popularity_weights(entity_codes, n_entities, softening=5.0):
    counts = np.bincount(entity_codes[entity_codes >= 0], minlength=n_entities)
    return 1.0 / np.log(counts.astype(float) + softening)
