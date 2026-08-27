"""The model the phone app actually fits, plus the "when do I check next?" rule.

Why this model
--------------
A steak in a 125 C oven is not a lumped body: with h ~ 20 W/m^2/K, a 20 mm
half-thickness and k = 0.45 W/m/K the Biot number is around 0.9, so internal
conduction matters as much as the surface film.  The textbook answer for that
regime is the one-term (Heisler) solution of the transient slab: after an
initial lag of Fo ~ 0.2, the *centre* temperature approaches the environment
exponentially with a single time constant

    tau = L^2 / (alpha * lambda_1^2),        lambda_1 * tan(lambda_1) = Bi.

So a single exponential is the physically correct shape for the core -- it is
only the early lag and the pre-factor that the naive Newton's-law version gets
wrong.  Evaporation then does two things, and both fold into the same shape:

* while there is free water on the surface, the surface is pinned near the oven
  air's wet-bulb temperature (~38-45 C for a dry 125 C oven), which stalls
  everything.  That shows up as extra dead time.
* once the surface has dried into a crust it still loses moisture, so the
  surface never reaches oven temperature.  The core therefore heads for an
  *effective* asymptote well below 125 C.

Hence three parameters, each with a clear physical meaning:

    T(t) = T_inf - (T_inf - T0) * exp(-max(0, t - lag) / tau)

    tau    time constant, minutes          (thickness, h, conductivity)
    T_inf  effective asymptote, C          (evaporative depression of the surface)
    lag    dead time, minutes              (conduction lag + wet-surface stall)

Three parameters is also about the most that two or three probe readings can
support, which is the real constraint here.  We fit them with priors and keep
the whole posterior, because the posterior spread -- not the point estimate --
is what tells us when it is safe to leave the steak alone.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

# ---------------------------------------------------------------------------
# physical prior for the time constant
# ---------------------------------------------------------------------------
ALPHA_MEAT = 0.45 / (1050.0 * 3500.0)  # m^2/s, thermal diffusivity of beef
K_MEAT = 0.45


def _lambda1(bi: float) -> float:
    """First root of lambda * tan(lambda) = Bi, in (0, pi/2)."""
    lo, hi = 1e-6, math.pi / 2 - 1e-9
    for _ in range(200):
        mid = 0.5 * (lo + hi)
        if mid * math.tan(mid) > bi:
            hi = mid
        else:
            lo = mid
    return 0.5 * (lo + hi)


def tau_prior_minutes(
    thickness_m: float,
    width_m: float | None = None,
    length_m: float | None = None,
    h: float = 20.0,
) -> float:
    """Predicted core time constant, minutes, from geometry and the film
    coefficient.  Dimensions combine as parallel conductances (the product
    solution for a finite body): 1/tau = sum_i alpha * lambda_i^2 / L_i^2."""
    inv = 0.0
    for full in (thickness_m, width_m, length_m):
        if full is None or full <= 0:
            continue
        half = full / 2.0
        bi = h * half / K_MEAT
        lam = _lambda1(bi)
        inv += ALPHA_MEAT * lam**2 / half**2
    return 1.0 / inv / 60.0


def geometry_from_mass(mass_kg: float, thickness_m: float) -> tuple[float, float]:
    """Guess plan dimensions for a steak of a given mass and thickness,
    assuming a 5:3 rectangle.  Returns (width, length) in metres."""
    volume = mass_kg / 1050.0
    area = volume / thickness_m
    width = math.sqrt(area * 3.0 / 5.0)
    return width, width * 5.0 / 3.0


# ---------------------------------------------------------------------------
# the model and its posterior
# ---------------------------------------------------------------------------
@dataclass
class Priors:
    tau_median: float = 60.0  # minutes
    tau_log_sd: float = 0.35
    t_inf_mean: float = 105.0  # C
    t_inf_sd: float = 15.0
    t_inf_min: float = 30.0
    t_inf_max: float = 125.0
    lag_median: float = 6.0  # minutes
    lag_log_sd: float = 0.6
    t0_sd: float = 1.0  # C, uncertainty on the first reading
    sigma_obs: float = 0.8  # C, probe placement + read noise
    sigma_model: float = 0.02  # fraction of the rise so far, added in quadrature


def predict(theta: np.ndarray, t: np.ndarray | float) -> np.ndarray:
    """theta columns: [log_tau, t_inf, lag, t0].  Returns temperature, C."""
    tau = np.exp(theta[..., 0:1])
    t_inf = theta[..., 1:2]
    lag = theta[..., 2:3]
    t0 = theta[..., 3:4]
    tt = np.maximum(0.0, np.atleast_1d(t)[None, :] - lag)
    return t_inf - (t_inf - t0) * np.exp(-tt / tau)


def _log_prior(theta: np.ndarray, pr: Priors, t0_obs: float) -> np.ndarray:
    log_tau, t_inf, lag, t0 = theta[..., 0], theta[..., 1], theta[..., 2], theta[..., 3]
    lp = -0.5 * ((log_tau - math.log(pr.tau_median)) / pr.tau_log_sd) ** 2
    lp += -0.5 * ((t_inf - pr.t_inf_mean) / pr.t_inf_sd) ** 2
    lp += np.where((t_inf > pr.t_inf_min) & (t_inf < pr.t_inf_max), 0.0, -np.inf)
    lp += np.where(lag > 0.05, -0.5 * ((np.log(np.maximum(lag, 1e-6)) - math.log(pr.lag_median)) / pr.lag_log_sd) ** 2, -np.inf)
    lp += -0.5 * ((t0 - t0_obs) / pr.t0_sd) ** 2
    return lp


def _log_lik(theta: np.ndarray, ts: np.ndarray, temps: np.ndarray, pr: Priors) -> np.ndarray:
    if len(ts) == 0:
        return np.zeros(theta.shape[0])
    mu = predict(theta, ts)
    rise = np.abs(temps - temps[0])
    sigma = np.sqrt(pr.sigma_obs**2 + (pr.sigma_model * rise) ** 2)
    return np.sum(-0.5 * ((mu - temps[None, :]) / sigma[None, :]) ** 2, axis=1)


@dataclass
class Posterior:
    samples: np.ndarray  # (n, 4)
    accept: float
    priors: Priors

    def temp_at(self, t: np.ndarray | float) -> np.ndarray:
        return predict(self.samples, t)

    def time_to(self, target: float) -> np.ndarray:
        """Minutes from the start of the cook at which each posterior sample
        reaches `target`.  np.inf where the sample never gets there."""
        tau = np.exp(self.samples[:, 0])
        t_inf = self.samples[:, 1]
        lag = self.samples[:, 2]
        t0 = self.samples[:, 3]
        reachable = t_inf > target + 1e-9
        ratio = np.where(reachable, (t_inf - t0) / np.maximum(t_inf - target, 1e-9), 1.0)
        out = np.where(reachable & (ratio > 0), lag + tau * np.log(np.maximum(ratio, 1e-12)), np.inf)
        return np.where(np.asarray(t0) >= target, 0.0, out)

    def stall_probability(self, target: float) -> float:
        return float(np.mean(self.samples[:, 1] <= target))


def fit(
    times_min: list[float] | np.ndarray,
    temps_c: list[float] | np.ndarray,
    priors: Priors = None,
    n_samples: int = 4000,
    chains: int = 8,
    burn: int = 3000,
    seed: int = 0,
) -> Posterior:
    """Random-walk Metropolis over the four parameters, run as `chains`
    vectorised chains.  Small problem, tiny data: this is milliseconds."""
    pr = priors or Priors()
    ts = np.asarray(times_min, dtype=float)
    temps = np.asarray(temps_c, dtype=float)
    t0_obs = float(temps[0]) if len(temps) else 5.0
    rng = np.random.default_rng(seed)

    theta = np.empty((chains, 4))
    theta[:, 0] = math.log(pr.tau_median) + pr.tau_log_sd * rng.standard_normal(chains)
    theta[:, 1] = np.clip(
        pr.t_inf_mean + pr.t_inf_sd * rng.standard_normal(chains),
        pr.t_inf_min + 1.0,
        pr.t_inf_max - 1.0,
    )
    theta[:, 2] = pr.lag_median * np.exp(pr.lag_log_sd * rng.standard_normal(chains))
    theta[:, 3] = t0_obs + pr.t0_sd * rng.standard_normal(chains)

    logp = _log_prior(theta, pr, t0_obs) + _log_lik(theta, ts, temps, pr)
    scale = np.array([0.25, 8.0, 2.0, 0.6])

    keep = max(1, math.ceil(n_samples / chains))
    thin = 3
    total = burn + keep * thin
    out = np.empty((keep, chains, 4))
    accepted = 0
    for i in range(total):
        prop = theta + scale * rng.standard_normal((chains, 4))
        lp = _log_prior(prop, pr, t0_obs) + _log_lik(prop, ts, temps, pr)
        take = np.log(rng.random(chains)) < (lp - logp)
        theta = np.where(take[:, None], prop, theta)
        logp = np.where(take, lp, logp)
        accepted += int(take.sum())
        if i < burn:
            # adapt towards ~30% acceptance during burn-in
            if i % 100 == 99:
                rate = accepted / (100 * chains)
                scale *= math.exp((rate - 0.3) * 1.5)
                accepted = 0
        else:
            j = i - burn
            if j % thin == 0 and j // thin < keep:
                out[j // thin] = theta

    return Posterior(out.reshape(-1, 4), accept=0.0, priors=pr)


# ---------------------------------------------------------------------------
# the decision rule
# ---------------------------------------------------------------------------
@dataclass
class Advice:
    now_min: float
    target: float
    temp_now: tuple[float, float, float]  # p05, p50, p95
    hit_time: tuple[float, float, float]  # p05, p50, p95 minutes from start
    next_check_min: float  # minutes from start
    stall_risk: float
    reason: str
    action: str = "measure"  # "measure", "coast" (wait and pull) or "pull"
    pull_min: float = 0.0  # minutes from start at which to take it out


def advise(
    post: Posterior,
    now_min: float,
    target: float = 44.0,
    guard_c: float = 2.0,
    min_gap_min: float = 5.0,
    max_blind_fraction: float = 0.55,
    max_gap_min: float = 30.0,
    coast_undershoot_c: float = 0.6,
) -> Advice:
    """When should the oven be opened next?

    The rule is *not* "check at the predicted finish time" -- that overshoots
    half the time.  It is: check at the earliest moment the steak could
    plausibly already be `guard_c` below target, i.e. the 5th percentile of the
    posterior arrival time at (target - guard).  Under that rule the chance of
    blowing past the target unobserved is the same 5%, whether the fit is
    currently sharp or vague; a vague fit simply earns an earlier check.

    Two practical bounds are layered on top: never sooner than `min_gap_min`
    (every opening costs oven heat and information is cheap only in the
    abstract), and never blindly wait more than `max_blind_fraction` of the
    remaining predicted time, so a badly wrong fit gets corrected early rather
    than discovered at the end.
    """
    temps = post.temp_at(now_min)[:, 0]
    p05_t, p50_t, p95_t = np.percentile(temps, [5, 50, 95])
    hits = post.time_to(target)
    finite = hits[np.isfinite(hits)]
    if len(finite) == 0:
        hit = (math.inf, math.inf, math.inf)
    else:
        hit = tuple(float(x) for x in np.percentile(finite, [5, 50, 95]))

    stall = post.stall_probability(target + 0.5)

    if p50_t >= target - 0.15:
        return Advice(now_min, target, (p05_t, p50_t, p95_t), hit, now_min, stall,
                      "At temperature now -- pull it.", "pull", now_min)

    guard_hits = post.time_to(target - guard_c)
    guard_finite = guard_hits[np.isfinite(guard_hits)]
    if len(guard_finite) == 0:
        safe = now_min + max_gap_min
        reason = "The fit says it may never reach target -- check the oven and the surface."
    else:
        safe = float(np.percentile(guard_finite, 5))
        reason = f"5% chance it is already within {guard_c:.0f} C of target by then."

    latest_useful = now_min + max_blind_fraction * max(hit[1] - now_min, 0.0) if math.isfinite(hit[1]) else now_min + max_gap_min
    nxt = min(safe, latest_useful, now_min + max_gap_min)
    if nxt < safe - 1e-6:
        reason = "Mid-course check: the prediction is still loose enough to be worth a reading."
    nxt = max(nxt, now_min + min_gap_min)

    if stall > 0.25:
        reason += " Warning: significant chance the steak stalls below target (wet surface / oven too cool)."

    # If the next safe opening would land at or after the predicted finish, there
    # is nothing left to learn: coast to the predicted pull time instead.
    action = "measure"
    if math.isfinite(hit[1]) and nxt >= hit[1] - 0.25:
        action = "coast"
        reason = "Close enough to coast -- no more openings needed, just pull at the predicted time."

    # Calibration.  The real effective asymptote creeps upward as the crust
    # dries, so a fitted constant-asymptote exponential decelerates slightly too
    # fast and we arrive a little early.  Aiming a fraction of a degree low
    # removes the resulting overshoot; the size comes from model/validate.py.
    coast = post.time_to(target - coast_undershoot_c)
    coast = coast[np.isfinite(coast)]
    pull = float(np.median(coast)) if len(coast) else (hit[1] if math.isfinite(hit[1]) else nxt)

    return Advice(now_min, target, (p05_t, p50_t, p95_t), hit, nxt, stall, reason,
                  action, pull)


def default_priors(mass_kg: float, thickness_m: float, oven_c: float, fan: bool = False) -> Priors:
    h = 26.0 if fan else 20.0
    width, length = geometry_from_mass(mass_kg, thickness_m)
    tau = tau_prior_minutes(thickness_m, width, length, h=h)
    return Priors(
        tau_median=tau,
        tau_log_sd=0.35,
        t_inf_mean=max(oven_c - 20.0, 45.0),
        t_inf_sd=15.0,
        t_inf_max=oven_c,
        lag_median=6.0,
        lag_log_sd=0.6,
    )


if __name__ == "__main__":
    pr = default_priors(1.0, 0.040, 125.0)
    print(f"prior tau = {pr.tau_median:.1f} min, T_inf ~ N({pr.t_inf_mean:.0f}, {pr.t_inf_sd:.0f})")
    post = fit([0.0], [5.0], pr)
    a = advise(post, 0.0)
    print(f"with only the starting reading: hit 44 C at {a.hit_time[1]:.0f} min "
          f"[{a.hit_time[0]:.0f}-{a.hit_time[2]:.0f}], first check at {a.next_check_min:.0f} min")
