"""Tests for the physics simulator, the fitted model and the scheduling rule.

    python3 -m unittest discover -s model -v
    python3 -m unittest model.test_model.TestPolicyAccuracy -v   # the slow one

The browser half of the same model is tested by tests/model.spec.js, and
tests/parity.spec.js checks the two implementations agree.
"""

from __future__ import annotations

import math
import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fit import (  # noqa: E402
    Priors,
    _lambda1,
    advise,
    default_priors,
    fit,
    geometry_from_mass,
    predict,
    tau_prior_minutes,
)
from steak import (  # noqa: E402
    Geometry,
    Oven,
    Surface,
    humidity_ratio,
    p_sat,
    simulate,
    wet_bulb,
)


class TestPsychrometrics(unittest.TestCase):
    def test_saturation_pressure_is_accurate_where_it_is_used(self):
        # Magnus coefficients, good to a few tenths of a percent up to ~60 C.
        # Surface temperatures in this problem run 35-90 C, so that is the range
        # that has to hold; the fit drifts to ~2.7% high by 100 C, which is
        # outside anything the simulator reaches.
        for t, reference in ((0.0, 611.2), (20.0, 2339.3), (40.0, 7384.9), (60.0, 19946.0)):
            self.assertLess(abs(p_sat(t) - reference) / reference, 0.005, f"{t} C")
        self.assertLess(abs(p_sat(80.0) - 47414.0) / 47414.0, 0.02)

    def test_humidity_ratio_rises_with_temperature(self):
        w = [humidity_ratio(t) for t in (20, 40, 60, 80)]
        self.assertTrue(all(b > a for a, b in zip(w, w[1:])))

    def test_wet_bulb_is_the_ceiling_a_wet_steak_sits_under(self):
        # The number the whole 44 C problem turns on: a genuinely wet surface in
        # a dry 125 C oven cannot get far past this.
        wb = wet_bulb(125.0, 0.008)
        self.assertGreater(wb, 34.0)
        self.assertLess(wb, 43.0)

    def test_wet_bulb_rises_with_humidity_and_air_temperature(self):
        self.assertGreater(wet_bulb(125.0, 0.030), wet_bulb(125.0, 0.008))
        self.assertGreater(wet_bulb(160.0, 0.008), wet_bulb(125.0, 0.008))

    def test_wet_bulb_never_exceeds_the_air(self):
        for t in (60.0, 125.0, 200.0):
            self.assertLess(wet_bulb(t, 0.008), t)


class TestSimulator(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.r = simulate(duration=6000.0, t_initial=5.0)

    def test_core_rises_monotonically_towards_the_oven(self):
        self.assertTrue(np.all(np.diff(self.r.core) > -1e-6))
        self.assertLess(self.r.core[-1], 125.0)
        self.assertGreater(self.r.core[-1], 44.0)

    def test_surface_leads_the_core_and_trails_the_oven(self):
        late = slice(len(self.r.t) // 4, None)
        self.assertTrue(np.all(self.r.surface[late] > self.r.core[late]))
        self.assertTrue(np.all(self.r.surface < 125.0))

    def test_free_water_is_driven_off_early_and_stays_off(self):
        self.assertGreater(self.r.water[0], 0.0)
        gone = np.argmax(self.r.water <= 0.0)
        self.assertGreater(gone, 0)
        self.assertLess(self.r.t[gone] / 60.0, 25.0)
        self.assertTrue(np.all(self.r.water[gone:] <= 0.0))

    def test_evaporation_only_ever_accumulates(self):
        self.assertTrue(np.all(np.diff(self.r.mass_loss) >= -1e-12))

    def test_a_soaking_steak_stalls_where_a_dry_one_does_not(self):
        dry = simulate(duration=4200.0, t_initial=5.0, surface=Surface(free_water=0.02))
        wet = simulate(duration=4200.0, t_initial=5.0, surface=Surface(free_water=1.2))
        self.assertGreater(dry.core[-1], wet.core[-1] + 3.0)

    def test_a_hotter_oven_cooks_faster(self):
        cool = simulate(duration=6000.0, oven=Oven(t_air=110.0))
        hot = simulate(duration=6000.0, oven=Oven(t_air=150.0))
        self.assertGreater(hot.core[-1], cool.core[-1])

    def test_a_thicker_steak_cooks_slower(self):
        thin = simulate(duration=4200.0, geometry=Geometry(0.030, 0.120, 0.200))
        thick = simulate(duration=4200.0, geometry=Geometry(0.055, 0.120, 0.200))
        self.assertGreater(thin.core[-1], thick.core[-1])

    def test_opening_the_door_shows_up_as_lost_progress(self):
        shut = simulate(duration=4200.0)
        opened = simulate(duration=4200.0, openings=[
            __import__("steak").DoorOpening(t_open=1200.0, duration=180.0)])
        self.assertLess(opened.core[-1], shut.core[-1])


class TestTimeConstantPrior(unittest.TestCase):
    def test_lambda1_is_the_root_it_claims_to_be(self):
        for bi in (0.01, 0.1, 0.9, 5.0, 50.0):
            lam = _lambda1(bi)
            self.assertAlmostEqual(lam * math.tan(lam), bi, places=4)
            self.assertGreater(lam, 0.0)
            self.assertLess(lam, math.pi / 2)

    def test_one_kilo_forty_millimetres_matches_the_documented_figure(self):
        w, l = geometry_from_mass(1.0, 0.040)
        tau = tau_prior_minutes(0.040, w, l, h=20.0)
        self.assertGreater(tau, 55.0)
        self.assertLess(tau, 67.0)

    def test_tau_moves_the_right_way_with_thickness_and_convection(self):
        base = tau_prior_minutes(0.040, 0.12, 0.20, h=20.0)
        self.assertGreater(tau_prior_minutes(0.055, 0.12, 0.20, h=20.0), base)
        self.assertLess(tau_prior_minutes(0.025, 0.12, 0.20, h=20.0), base)
        self.assertLess(tau_prior_minutes(0.040, 0.12, 0.20, h=30.0), base)

    def test_edges_speed_a_finite_body_up(self):
        slab = tau_prior_minutes(0.040, h=20.0)
        finite = tau_prior_minutes(0.040, 0.12, 0.20, h=20.0)
        self.assertLess(finite, slab)

    def test_default_priors_keep_the_asymptote_below_the_oven(self):
        pr = default_priors(1.0, 0.040, 125.0)
        self.assertLess(pr.t_inf_mean, 125.0)
        self.assertEqual(pr.t_inf_max, 125.0)
        self.assertLess(default_priors(1.0, 0.040, 125.0, fan=True).tau_median, pr.tau_median)


class TestFit(unittest.TestCase):
    def test_recovers_a_curve_it_generated(self):
        truth = np.array([[math.log(55.0), 100.0, 7.0, 5.0]])
        ts = np.array([0.0, 10.0, 20.0, 30.0, 40.0, 50.0])
        temps = predict(truth, ts)[0]
        post = fit(ts, temps, default_priors(1.0, 0.040, 125.0), seed=7)

        true_hit = 7.0 + 55.0 * math.log((100.0 - 5.0) / (100.0 - 44.0))
        lo, mid, hi = np.percentile(post.time_to(44.0), [5, 50, 95])
        self.assertLess(abs(mid - true_hit), 3.0)
        self.assertLess(lo, true_hit)
        self.assertGreater(hi, true_hit)

    def test_more_readings_narrow_the_prediction(self):
        truth = np.array([[math.log(55.0), 100.0, 7.0, 5.0]])
        ts = np.array([0.0, 12.0, 24.0, 36.0])
        temps = predict(truth, ts)[0]
        pr = default_priors(1.0, 0.040, 125.0)
        spreads = []
        for n in (1, 2, 4):
            post = fit(ts[:n], temps[:n], pr, seed=3)
            lo, hi = np.percentile(post.time_to(44.0), [5, 95])
            spreads.append(hi - lo)
        self.assertLess(spreads[-1], spreads[0])

    def test_the_same_seed_gives_the_same_posterior(self):
        pr = default_priors(1.0, 0.040, 125.0)
        a = fit([0.0, 20.0], [5.0, 19.0], pr, seed=11)
        b = fit([0.0, 20.0], [5.0, 19.0], pr, seed=11)
        np.testing.assert_allclose(a.samples, b.samples)

    def test_time_to_target_handles_the_unreachable_cases(self):
        pr = default_priors(1.0, 0.040, 125.0)
        post = fit([0.0, 20.0], [5.0, 19.0], pr, seed=1)
        post.samples[:, 1] = 40.0                       # asymptote below target
        self.assertTrue(np.all(np.isinf(post.time_to(44.0))))
        self.assertEqual(post.stall_probability(44.0), 1.0)

        post.samples[:, 1] = 105.0
        post.samples[:, 3] = 50.0                       # already above target
        self.assertTrue(np.all(post.time_to(44.0) == 0.0))

    def test_a_stalling_steak_is_recognised(self):
        ts = [0.0, 15.0, 30.0, 45.0, 60.0]
        temps = [5.0, 26.0, 35.0, 38.5, 40.0]
        post = fit(ts, temps, default_priors(1.0, 0.040, 125.0), seed=5)
        self.assertGreater(post.stall_probability(44.5), 0.25)


class TestAdvise(unittest.TestCase):
    def setUp(self):
        self.pr = default_priors(1.0, 0.040, 125.0)

    def _post(self, ts, temps, seed=13):
        return fit(ts, temps, self.pr, seed=seed)

    def test_the_next_check_respects_both_bounds(self):
        for ts, temps in (
            ([0.0], [5.0]),
            ([0.0, 14.0], [5.0, 12.0]),
            ([0.0, 14.0, 26.0], [5.0, 12.0, 22.0]),
        ):
            now = ts[-1]
            a = advise(self._post(ts, temps), now, 44.0)
            self.assertGreaterEqual(a.next_check_min, now + 5.0 - 1e-6, (ts, a))
            self.assertLessEqual(a.next_check_min, now + 30.0 + 1e-6, (ts, a))
            self.assertIn(a.action, ("measure", "coast", "pull"))

    def test_the_check_beats_the_steak_to_target_95_percent_of_the_time(self):
        for ts, temps in (([0.0, 14.0], [5.0, 12.0]), ([0.0, 18.0], [4.0, 20.0])):
            post = self._post(ts, temps)
            a = advise(post, ts[-1], 44.0)
            if a.action != "measure":
                continue
            past = float(np.mean(post.temp_at(a.next_check_min)[:, 0] >= 44.0))
            self.assertLessEqual(past, 0.05, (ts, a.next_check_min, past))

    def test_it_coasts_only_when_another_reading_would_teach_nothing(self):
        post = self._post([0.0, 18.0, 30.0, 38.0], [5.0, 22.0, 34.0, 40.0])
        a = advise(post, 38.0, 44.0)
        self.assertEqual(a.action, "coast")
        # and aims a little low, because the real asymptote creeps upward
        self.assertLess(a.pull_min, a.hit_time[1])
        at_pull = float(np.median(post.temp_at(a.pull_min)[:, 0]))
        self.assertGreater(at_pull, 42.5)
        self.assertLess(at_pull, 44.0)

    def test_it_says_pull_once_the_steak_is_there(self):
        a = advise(self._post([0.0, 20.0, 40.0], [5.0, 25.0, 45.0]), 40.0, 44.0)
        self.assertEqual(a.action, "pull")
        self.assertEqual(a.next_check_min, 40.0)
        self.assertIn("pull it", a.reason.lower())

    def test_just_short_of_target_it_coasts_the_last_stretch(self):
        # A reading a little under target is not "pull" -- it coasts to the
        # crossing rather than pulling early.
        post = self._post([0.0, 20.0, 40.0], [5.0, 25.0, 43.5])
        a = advise(post, 40.0, 44.0)
        self.assertEqual(a.action, "coast")
        self.assertLess(abs(a.pull_min - 40.0), 4.0)

    def test_a_stalling_steak_earns_a_warning(self):
        post = self._post([0.0, 15.0, 30.0, 45.0, 60.0], [5.0, 26.0, 35.0, 38.5, 40.0])
        a = advise(post, 60.0, 44.0)
        self.assertGreater(a.stall_risk, 0.25)
        self.assertIn("stall", a.reason.lower())

    def test_a_looser_fit_earns_an_earlier_look(self):
        # One reading is far vaguer than three, so it should be checked sooner
        # relative to when it is predicted to finish.
        vague = advise(self._post([0.0], [5.0]), 0.0, 44.0)
        self.assertLess(vague.next_check_min, vague.hit_time[1])


class TestPolicyAccuracy(unittest.TestCase):
    """The end-to-end claim: the policy lands the steak on target.

    Slower than the rest (each trial runs the full simulator plus a fit per
    measurement), so it is kept small; model/validate.py is the wide version.
    """

    def test_lands_within_a_degree_and_a_half_without_excessive_openings(self):
        import validate

        rng = np.random.default_rng(20240501)
        errors, openings = [], []
        for _ in range(6):
            cfg = validate.sample_cook(rng)
            res = validate.run_trial(cfg, rng)
            errors.append(res["error"])
            openings.append(res["openings"])

        errors = np.array(errors)
        self.assertLess(np.abs(errors).max(), 1.6, f"errors {errors.round(2)}")
        self.assertLess(abs(errors.mean()), 0.8, f"mean {errors.mean():.2f}")
        self.assertLessEqual(max(openings), 6)
        self.assertGreaterEqual(min(openings), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
