"""Candidate research models. Train/evaluate chronologically; never promote automatically."""
import numpy as np
from datetime import datetime
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler


def chronological_candidate(train: list[dict], test: list[dict]) -> dict:
    if not train or not test:
        raise ValueError("Training and holdout samples are required")
    if max(s["date"] for s in train) >= min(s["date"] for s in test):
        raise ValueError("Holdout must follow training chronologically")
    for s in train + test:
        def timestamp(value):
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                raise ValueError("Timestamp must include timezone")
            return parsed
        if timestamp(s["forecastReceivedAt"]) >= timestamp(s["settledAt"]) or timestamp(s["forecastPublishedAt"]) > timestamp(s["forecastReceivedAt"]):
            raise ValueError("Future-data leakage")
    x = np.array([[s["forecastHigh"]] for s in train])
    y = np.array([s["observedHigh"] for s in train])
    model = make_pipeline(StandardScaler(), Ridge(alpha=10))
    model.fit(x, y)
    pred = model.predict(np.array([[s["forecastHigh"]] for s in test]))
    return {"candidate": "ridge-temperature-v1", "trainingSamples": len(train), "holdoutSamples": len(test),
            "holdoutMae": float(np.mean(np.abs(pred - [s["observedHigh"] for s in test]))),
            "automaticPromotion": False}
