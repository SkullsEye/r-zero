import numpy as np
import pandas as pd

from rzero.contagion import decayed_history, entity_history
from rzero.entities import ENTITY_KEYS, encode_entity, popularity_weights

HALF_LIVES_IN_DAYS = {"1h": 1 / 24, "1d": 1.0, "7d": 7.0}
DECAY_RATES = np.array([np.log(2) / h for h in HALF_LIVES_IN_DAYS.values()])
DECAY_NAMES = list(HALF_LIVES_IN_DAYS)

NUMERIC_COLUMNS = ["TransactionAmt", "C1", "C13", "C14", "D1", "D2", "D3",
                   "D4", "D10", "D15", "dist1", "dist2"]
CATEGORICAL_COLUMNS = ["ProductCD", "card4", "card6", "M4", "P_emaildomain",
                       "R_emaildomain", "DeviceType", "id_30", "id_31"]

DEFAULT_CONFIRMATION_DELAY_DAYS = 7.0


def build_features(frame, day, is_fraud,
                   confirmation_delay_days=DEFAULT_CONFIRMATION_DELAY_DAYS):
    amounts = frame["TransactionAmt"].values.astype(float)
    columns = {}
    families = {"base": [], "velocity": [], "contagion": []}

    for name in NUMERIC_COLUMNS:
        if name in frame.columns:
            columns[name] = pd.to_numeric(frame[name], errors="coerce").values
            families["base"].append(name)

    for name in CATEGORICAL_COLUMNS:
        if name in frame.columns:
            key = f"{name}_code"
            columns[key] = pd.factorize(frame[name].astype(str))[0].astype(float)
            families["base"].append(key)

    columns["amount_log"] = np.log1p(np.maximum(amounts, 0))
    columns["amount_fraction"] = np.round(amounts - np.floor(amounts), 3)
    columns["hour_of_day"] = (day * 24) % 24
    columns["day_of_week"] = np.floor(day) % 7
    families["base"] += ["amount_log", "amount_fraction",
                         "hour_of_day", "day_of_week"]

    for entity, key_columns in ENTITY_KEYS.items():
        if not all(c in frame.columns for c in key_columns):
            continue

        codes, n_entities = encode_entity(frame, key_columns)
        if n_entities < 2:
            continue

        history = entity_history(day, codes, amounts, n_entities)
        for offset, suffix in enumerate(["count", "mean_amount", "age", "gap"]):
            key = f"{entity}_{suffix}"
            columns[key] = history[:, offset]
            families["velocity"].append(key)

        key = f"{entity}_amount_vs_mean"
        columns[key] = np.where(history[:, 1] > 0, amounts / history[:, 1], -1.0)
        families["velocity"].append(key)

        activity = decayed_history(day, codes, n_entities,
                                   np.ones(len(frame), bool), DECAY_RATES)
        for offset, window in enumerate(DECAY_NAMES):
            key = f"{entity}_activity_{window}"
            columns[key] = activity[:, offset]
            families["velocity"].append(key)

        weights = popularity_weights(codes, n_entities)
        contagion = decayed_history(
            day, codes, n_entities, is_fraud == 1, DECAY_RATES,
            weights=weights[np.maximum(codes, 0)],
            confirmation_delay=confirmation_delay_days)
        for offset, window in enumerate(DECAY_NAMES):
            key = f"{entity}_contagion_{window}"
            columns[key] = contagion[:, offset]
            families["contagion"].append(key)

    return pd.DataFrame(columns), families
