import unittest
from economics import calc


class EconomicsTest(unittest.TestCase):
    def test_formulas(self):
        cfg = {"machines": [{"group": "A", "events_per_year": 100, "delta_t_hours_per_event": 0.5, "downtime_cost_per_hour": 10}],
               "labor_effect_per_year": 100, "repeat_diagnostics_effect_per_year": 0, "capex": 1000, "opex_per_year": 200, "max_payback_years": 5}
        r = calc(cfg)
        self.assertEqual(r["E_pr"], 500)
        self.assertEqual(r["E_year"], 400)
        self.assertAlmostEqual(r["payback_years"], 2.5)
        self.assertTrue(r["ok"])
        self.assertEqual(r["max_capex_for_limit"], 2000)

    def test_missing_values_rejected(self):
        with self.assertRaises(ValueError):
            calc({"machines": [{"group": "A", "events_per_year": None, "delta_t_hours_per_event": 1, "downtime_cost_per_hour": 1}]})


if __name__ == "__main__":
    unittest.main()
