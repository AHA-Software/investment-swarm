"""Offline evidence only. No network access, credentials, order submission, or promotion."""
import json
import sys
from datetime import datetime
from zoneinfo import ZoneInfo
import numpy as np
import pandas as pd


def evaluate(data: dict) -> dict:
    settled = [p for p in data.get("predictions", []) if p.get("outcome") is not None]
    start = datetime.fromisoformat(data["startedAt"].replace("Z", "+00:00"))
    now = datetime.fromisoformat(data["now"].replace("Z", "+00:00"))
    calendar_days = max(0, (now.date() - start.date()).days)
    # Include zero-trading days. Resample calendar dates together across all stations.
    index = pd.date_range(start.astimezone(ZoneInfo("America/Los_Angeles")).date(), now.astimezone(ZoneInfo("America/Los_Angeles")).date(), freq="D")
    daily = pd.Series(0.0, index=index)
    fees = 0.0
    for fill in data.get("fills", []):
        fees += fill["fee"]
        day = datetime.fromisoformat(fill["timestamp"].replace("Z", "+00:00")).astimezone(ZoneInfo("America/Los_Angeles")).date()
        key = pd.Timestamp(day)
        if key in daily.index:
            # Entry fees are already part of allocated cost in closing realized PnL.
            daily[key] += fill["realizedPnl"]
    rng = np.random.default_rng(20261108)
    values = daily.to_numpy()
    # Seven-day blocks preserve serial weather dependence and same-date city correlation.
    boot = []
    if len(values) >= 7:
        for _ in range(2000):
            starts = rng.integers(0, len(values), size=int(np.ceil(len(values) / 7)))
            sampled = np.concatenate([values[(s + np.arange(7)) % len(values)] for s in starts])[:len(values)]
            boot.append(float(sampled.mean()))
    lower = float(np.quantile(boot, 0.025)) if boot else None
    brier = float(np.mean([(p["probability"]-p["outcome"])**2 for p in settled])) if settled else None
    baseline = float(np.mean([(p["marketProbability"]-p["outcome"])**2 for p in settled])) if settled else None
    event_count = len({p["event"] for p in settled})
    gates = {
        "real_forward_paper_data": not data.get("fixture", True),
        "sixty_calendar_days": calendar_days >= 60,
        "hundred_settled_event_trades": event_count >= 100,
        "positive_net_realized_pnl": float(daily.sum()) > 0,
        "positive_95pct_block_bootstrap_bound": lower is not None and lower > 0,
        "better_brier_than_market": brier is not None and baseline is not None and brier < baseline,
        "all_positions_reconciled": data.get("openPositions", 0) == 0,
        "no_active_risk_halt": not data.get("halted", True) and not data.get("paused", True),
    }
    return {"fixture": data.get("fixture", True), "strategyVersion": data.get("strategyVersion"), "calendarDays": calendar_days, "settledEvents": event_count,
            "netRealizedPnl": round(float(daily.sum()), 6), "fees": round(fees, 6),
            "brierScore": brier, "marketBrierScore": baseline, "meanDailyPnlLower95": lower,
            "gates": gates, "statisticalGatesPassed": all(gates.values()),
            "liveEnabled": False, "operatingCostsIncluded": False,
            "note": "Evidence report only. Launch additionally requires operational tests, tracked operating costs, a frozen prospective strategy evaluation, and human approval. Live execution is absent."}


if __name__ == "__main__":
    print(json.dumps(evaluate(json.load(sys.stdin)), allow_nan=False))
