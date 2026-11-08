import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from evaluate import evaluate
from model import chronological_candidate


class EvaluationTests(unittest.TestCase):
    def data(self):
        return {"fixture": False, "startedAt": "2026-11-08T18:00:00Z", "now": "2026-11-08T19:00:00Z", "openPositions": 0, "paused": False, "halted": False, "fills": [], "predictions": []}

    def test_empty_data_cannot_qualify(self):
        result = evaluate(self.data())
        self.assertFalse(result["statisticalGatesPassed"])
        self.assertFalse(result["liveEnabled"])
        self.assertIsNone(result["brierScore"])

    def test_fixtures_never_qualify(self):
        data = self.data()
        data["fixture"] = True
        self.assertFalse(evaluate(data)["gates"]["real_forward_paper_data"])

    def test_counts_unique_events_and_measures_calibration(self):
        data = self.data()
        data["predictions"] = [{"event": "same-city-day", "probability": .8, "marketProbability": .4, "outcome": 1}] * 20
        result = evaluate(data)
        self.assertEqual(result["settledEvents"], 1)
        self.assertAlmostEqual(result["brierScore"], .04)
        self.assertAlmostEqual(result["marketBrierScore"], .36)

    def test_fees_are_not_double_counted(self):
        data = self.data()
        data["fills"] = [{"timestamp": data["startedAt"], "realizedPnl": -.5, "fee": .1}]
        self.assertEqual(evaluate(data)["netRealizedPnl"], -.5)
        self.assertEqual(evaluate(data)["fees"], .1)

    def test_chronological_holdout_is_required(self):
        with self.assertRaisesRegex(ValueError, "chronologically"):
            chronological_candidate([{"date": "2026-11-08"}], [{"date": "2026-11-07"}])

    def test_candidate_rejects_future_vintage_with_timezone_offset(self):
        sample = {"date": "2026-11-07", "forecastHigh": 65, "observedHigh": 66,
                  "forecastPublishedAt": "2026-11-06T18:00:00Z", "forecastReceivedAt": "2026-11-07T08:00:00-05:00", "settledAt": "2026-11-07T12:00:00Z"}
        with self.assertRaisesRegex(ValueError, "leakage"):
            chronological_candidate([sample], [{**sample, "date": "2026-11-08"}])


if __name__ == "__main__":
    unittest.main()
