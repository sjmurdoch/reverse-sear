"""Closed-loop test: does the app's simple model + scheduling rule land on 44 C?

We run the detailed simulator (model/steak.py) as ground truth, hand the fitter
only what a cook could actually observe -- a noisy probe reading at each time
the policy asks for one -- and record where the steak actually ends up when the
policy says "pull it now".

The headline numbers: absolute error in core temperature at the moment of
pulling, and how many times the oven had to be opened.

    python3 model/validate.py [n_trials]
"""

from __future__ import annotations

import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fit import advise, default_priors, fit  # noqa: E402
from steak import DoorOpening, Geometry, Oven, Surface, simulate  # noqa: E402

TARGET = 44.0
PROBE_NOISE = 0.5  # C, what the cook's thermometer plus placement gives us


def sample_cook(rng: np.random.Generator) -> dict:
    """A plausible-but-unknown-to-the-app steak and oven."""
    thickness = rng.uniform(0.030, 0.055)
    mass = 1.0
    volume = mass / 1050.0
    area = volume / thickness
    width = math.sqrt(area * 3.0 / 5.0)
    length = width * 5.0 / 3.0
    fan = bool(rng.random() < 0.4)
    return dict(
        thickness=thickness,
        width=width,
        length=length,
        mass=mass,
        fan=fan,
        # the cook believes the oven is at 125; it is not exactly
        oven_true=rng.uniform(115.0, 133.0),
        oven_believed=125.0,
        h_conv=rng.uniform(20.0, 34.0) if fan else rng.uniform(8.5, 14.0),
        t_initial=rng.uniform(3.0, 20.0),
        free_water=rng.uniform(0.02, 0.35),  # kg/m^2: patted dry .. straight from the bag
        humidity=rng.uniform(0.004, 0.020),
        cycle=rng.uniform(0.0, 9.0),
        crust=rng.uniform(500.0, 1600.0),
    )


def run_trial(cfg: dict, rng: np.random.Generator, verbose: bool = False) -> dict:
    """Simulate one cook under the adaptive policy."""
    truth = simulate(
        duration=10800.0,
        t_initial=cfg["t_initial"],
        geometry=Geometry(cfg["thickness"], cfg["width"], cfg["length"]),
        oven=Oven(
            t_air=cfg["oven_true"],
            h_conv=cfg["h_conv"],
            humidity_ratio_air=cfg["humidity"],
            cycle_amplitude=cfg["cycle"],
        ),
        surface=Surface(free_water=cfg["free_water"], crust_resistance=cfg["crust"]),
    )
    t_min = truth.t / 60.0

    def true_core(minutes: float) -> float:
        return float(np.interp(minutes, t_min, truth.core))

    priors = default_priors(cfg["mass"], cfg["thickness"], cfg["oven_believed"], fan=cfg["fan"])

    times = [0.0]
    temps = [cfg["t_initial"] + rng.normal(0.0, PROBE_NOISE)]
    now = 0.0
    openings = 0
    trace = []

    for _ in range(30):
        post = fit(times, temps, priors, seed=int(rng.integers(1 << 30)))
        adv = advise(post, now, TARGET)
        trace.append((now, temps[-1], adv.action, adv.next_check_min, adv.pull_min, adv.hit_time[1]))
        if verbose:
            print(
                f"    t={now:5.1f} read={temps[-1]:5.1f} -> {adv.action:7s} "
                f"next={adv.next_check_min:5.1f} predicted 44C at {adv.hit_time[1]:5.1f}"
            )
        if adv.action == "pull":
            pull_at = now
            break
        if adv.action == "coast":
            pull_at = adv.pull_min
            break
        now = adv.next_check_min
        if now > 240.0:
            pull_at = now
            break
        openings += 1
        times.append(now)
        temps.append(true_core(now) + rng.normal(0.0, PROBE_NOISE))
    else:
        pull_at = now

    final = true_core(pull_at)
    return dict(
        error=final - TARGET,
        final=final,
        pull_at=pull_at,
        openings=openings,
        truth_44=float(np.interp(TARGET, truth.core, t_min)) if truth.core[-1] > TARGET else math.nan,
        trace=trace,
    )


def main() -> None:
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 60
    rng = np.random.default_rng(12345)
    errors, openings, pulls = [], [], []
    for i in range(n):
        cfg = sample_cook(rng)
        res = run_trial(cfg, rng)
        errors.append(res["error"])
        openings.append(res["openings"])
        pulls.append(res["pull_at"])
        print(
            f"[{i + 1:3d}/{n}] thickness={cfg['thickness'] * 1000:4.0f}mm "
            f"{'fan' if cfg['fan'] else 'still':5s} oven={cfg['oven_true']:5.1f} "
            f"start={cfg['t_initial']:4.1f} water={cfg['free_water'] * 1000:5.0f}g/m2 | "
            f"pulled at {res['pull_at']:5.1f} min ({res['openings']} openings), "
            f"true 44C at {res['truth_44']:5.1f} min, core={res['final']:5.1f} C "
            f"err={res['error']:+5.2f}"
        )

    e = np.array(errors)
    print("\n--- summary over", n, "simulated cooks ---")
    print(f"  core temperature error at pull:  mean {e.mean():+.2f} C, sd {e.std():.2f} C")
    print(f"    |err| median {np.median(np.abs(e)):.2f} C, 90th pct {np.percentile(np.abs(e), 90):.2f} C, max {np.abs(e).max():.2f} C")
    print(f"    within +/-1.0 C: {100 * np.mean(np.abs(e) <= 1.0):.0f}%   within +/-2.0 C: {100 * np.mean(np.abs(e) <= 2.0):.0f}%")
    print(f"  oven openings (after the initial reading): mean {np.mean(openings):.1f}, max {max(openings)}")
    print(f"  pull time: median {np.median(pulls):.0f} min, range {min(pulls):.0f}-{max(pulls):.0f} min")


if __name__ == "__main__":
    main()
