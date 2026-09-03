import json
import os

from fastapi import FastAPI
from pydantic import BaseModel

from rzero.stream import ContagionState, feature_names

FAMILIES = ["card", "address", "email", "device"]
MODEL_PATH = os.environ.get("RZERO_MODEL", "web/web_model.json")

state = ContagionState(FAMILIES, confirmation_delay_days=7.0)
model = json.load(open(MODEL_PATH)) if os.path.exists(MODEL_PATH) else None
app = FastAPI(title="R-Zero contagion service")


class Transaction(BaseModel):
    timestamp: float
    amount: float | None = None
    card: str | None = None
    address: str | None = None
    email: str | None = None
    device: str | None = None


def identities(txn):
    return {f: getattr(txn, f) for f in FAMILIES}


def score(features, txn):
    if model is None:
        return None
    row = dict(features)
    row["amount"] = txn.amount or 0.0
    row["amount_log"] = __import__("math").log1p(max(row["amount"], 0.0))
    row["amount_fraction"] = round(row["amount"] % 1.0, 3)
    row["hour_of_day"] = (txn.timestamp / 86400.0 * 24) % 24
    vector = [row.get(name, 0.0) for name in model["features"]]
    total = 0.0
    for tree in model["trees"]:
        node = tree
        while "v" not in node:
            node = node["l"] if vector[node["f"]] <= node["t"] else node["r"]
        total += node["v"]
    return 1.0 / (1.0 + __import__("math").exp(-total))


@app.post("/score")
def score_transaction(txn: Transaction):
    features = state.observe(txn.timestamp, identities(txn), amount=txn.amount)
    return {"features": features, "risk": score(features, txn),
            "events_seen": state.events}


@app.post("/confirm")
def confirm_fraud(txn: Transaction):
    state.confirm(txn.timestamp, identities(txn))
    return {"queued": True, "arrives_in_days": state.confirmation_delay_days}


@app.get("/health")
def health():
    return {"events_seen": state.events, "identities_alight": state.alight(),
            "features": len(feature_names(FAMILIES)), "model": model is not None}
