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

from fit import Steak, advise, advise_batch, default_priors, fit  # noqa: E402
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


# ---------------------------------------------------------------------------
# several steaks, one oven
# ---------------------------------------------------------------------------
def sample_dinner(rng: np.random.Generator, n: int) -> dict:
    """One oven, `n` steaks, possibly going in at different times."""
    oven = dict(
        oven_true=rng.uniform(115.0, 133.0),
        oven_believed=125.0,
        fan=bool(rng.random() < 0.4),
        humidity=rng.uniform(0.004, 0.020),
        cycle=rng.uniform(0.0, 9.0),
    )
    oven["h_conv"] = rng.uniform(20.0, 34.0) if oven["fan"] else rng.uniform(8.5, 14.0)

    steaks = []
    for i in range(n):
        thickness = rng.uniform(0.028, 0.055)
        mass = rng.uniform(0.35, 1.2)
        volume = mass / 1050.0
        area = volume / thickness
        width = math.sqrt(area * 3.0 / 5.0)
        steaks.append(dict(
            name=f"#{i + 1}",
            thickness=thickness,
            mass=mass,
            width=width,
            length=width * 5.0 / 3.0,
            target=float(rng.choice([44.0, 44.0, 48.0, 52.0])),
            offset=0.0 if i == 0 else float(rng.choice([0.0, 0.0, rng.uniform(5.0, 20.0)])),
            t_initial=rng.uniform(3.0, 20.0),
            free_water=rng.uniform(0.02, 0.35),
            crust=rng.uniform(500.0, 1600.0),
        ))
    return dict(oven=oven, steaks=steaks)


def _truth_curves(dinner: dict) -> list:
    """Ground-truth core curve per steak, as a function of that steak's own
    elapsed minutes.  Door-opening losses are not modelled here, exactly as in
    the single-steak harness -- see `compare_schedules` for what they cost."""
    out = []
    for s in dinner["steaks"]:
        r = simulate(
            duration=12000.0,
            t_initial=s["t_initial"],
            geometry=Geometry(s["thickness"], s["width"], s["length"]),
            oven=Oven(
                t_air=dinner["oven"]["oven_true"],
                h_conv=dinner["oven"]["h_conv"],
                humidity_ratio_air=dinner["oven"]["humidity"],
                cycle_amplitude=dinner["oven"]["cycle"],
            ),
            surface=Surface(free_water=s["free_water"], crust_resistance=s["crust"]),
        )
        out.append((r.t / 60.0, r.core))
    return out


def run_dinner(dinner: dict, rng: np.random.Generator, batched: bool = True) -> dict:
    """Drive the whole dinner under either the batched or the independent rule."""
    curves = _truth_curves(dinner)

    def true_core(i: int, local_min: float) -> float:
        t_min, core = curves[i]
        return float(np.interp(max(local_min, 0.0), t_min, core))

    priors, times, temps, done, final = [], [], [], [], {}
    for i, s in enumerate(dinner["steaks"]):
        priors.append(default_priors(s["mass"], s["thickness"], dinner["oven"]["oven_believed"],
                                     fan=dinner["oven"]["fan"]))
        times.append([0.0])
        temps.append([true_core(i, 0.0) + rng.normal(0.0, PROBE_NOISE)])
        done.append(False)

    now = 0.0
    open_times = []

    for _ in range(80):
        if all(done):
            break
        objs = []
        for i, s in enumerate(dinner["steaks"]):
            post = fit(times[i], temps[i], priors[i], seed=int(rng.integers(1 << 30)))
            objs.append(Steak(post, s["target"], s["offset"], s["name"], done[i]))

        if batched:
            adv = advise_batch(objs, now)
            now = max(adv.open_at_min, now)
            open_times.append(now)
            actions = adv.per_steak
        else:
            # Each steak on its own schedule: the earliest single steak drives
            # this opening and only that steak is touched.
            best, best_t, best_kind = None, math.inf, "probe"
            for i, o in enumerate(objs):
                if done[i]:
                    continue
                local = now - o.offset_min
                if local < 0:
                    if o.offset_min < best_t:
                        best, best_t, best_kind = i, o.offset_min, "probe"
                    continue
                a = advise(o.posterior, local, o.target)
                t_ev = o.offset_min + (local if a.action == "pull" else
                                       a.pull_min if a.action == "coast" else a.next_check_min)
                kind = "pull" if a.action in ("pull", "coast") else "probe"
                if t_ev < best_t:
                    best, best_t, best_kind = i, t_ev, kind
            if best is None:
                break
            now = max(best_t, now)
            open_times.append(now)
            actions = [(dinner["steaks"][i]["name"],
                        (best_kind if i == best else "leave"), "") for i in range(len(objs))]

        if now > 400.0:
            break

        for i, s in enumerate(dinner["steaks"]):
            if done[i]:
                continue
            instruction = dict((n, k) for n, k, *_ in actions).get(s["name"], "leave")
            local = now - s["offset"]
            if local < 0:
                continue
            if instruction == "pull":
                final[s["name"]] = true_core(i, local)
                done[i] = True
            elif instruction == "probe":
                times[i].append(local)
                temps[i].append(true_core(i, local) + rng.normal(0.0, PROBE_NOISE))

    for i, s in enumerate(dinner["steaks"]):
        if not done[i]:
            final[s["name"]] = true_core(i, now - s["offset"])

    # Openings within a minute of each other are one trip to the oven.
    merged = []
    for t in sorted(open_times):
        if not merged or t - merged[-1] > 1.0:
            merged.append(t)

    errors = {s["name"]: final[s["name"]] - s["target"] for s in dinner["steaks"]}
    return dict(openings=len(merged), errors=errors, finished_at=now)


def compare_schedules(trials: int = 8, n_steaks: int = 3, seed: int = 2024) -> None:
    rng = np.random.default_rng(seed)
    rows = []
    for k in range(trials):
        dinner = sample_dinner(rng, n_steaks)
        b = run_dinner(dinner, np.random.default_rng(seed + k), batched=True)
        i = run_dinner(dinner, np.random.default_rng(seed + k), batched=False)
        rows.append((b, i))
        errs = " ".join(f"{n}{e:+5.2f}" for n, e in b["errors"].items())
        print(f"[{k + 1:2d}/{trials}] batched {b['openings']:2d} openings vs "
              f"independent {i['openings']:2d} | errors {errs}")

    be = np.array([e for b, _ in rows for e in b["errors"].values()])
    ie = np.array([e for _, i in rows for e in i["errors"].values()])
    bo = np.array([b["openings"] for b, _ in rows])
    io = np.array([i["openings"] for _, i in rows])
    print(f"\n--- {trials} dinners of {n_steaks} steaks ---")
    print(f"  door openings   batched {bo.mean():.1f}   independent {io.mean():.1f}"
          f"   ({100 * (1 - bo.mean() / io.mean()):.0f}% fewer)")
    print(f"  |error| batched      median {np.median(np.abs(be)):.2f} C, "
          f"90th {np.percentile(np.abs(be), 90):.2f} C, max {np.abs(be).max():.2f} C")
    print(f"  |error| independent  median {np.median(np.abs(ie)):.2f} C, "
          f"90th {np.percentile(np.abs(ie), 90):.2f} C, max {np.abs(ie).max():.2f} C")
