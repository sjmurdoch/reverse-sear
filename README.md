# Reverse Sear Pilot

Cook a steak to a precise core temperature in a low oven while opening the door
as few times as possible.

**Live at <https://sjmurdoch.github.io/reverse-sear/>** — open it in Safari and
"Add to Home Screen".

The tool is a single self-contained web page that runs in
Safari on an iPhone: enter the oven temperature and the steak, log the core
temperature each time you probe it, and it tells you when to next open the oven
— and eventually tells you to stop opening it and take the steak out at a
specific clock time.

The repository also contains the modelling work behind it: a detailed
finite-volume simulator used as synthetic ground truth, a reference
implementation of the fitter, and a closed-loop validation harness.

---

## The physics

**A thick steak is not a lumped body.** With a film coefficient of
`h ≈ 20 W/m²K` (natural convection plus radiation in a domestic oven), a 20 mm
half-thickness and `k = 0.45 W/m·K` for beef, the Biot number is

```
Bi = h·L/k ≈ 20 × 0.020 / 0.45 ≈ 0.9
```

so internal conduction and the surface film matter about equally. Newton's law
of cooling — the model most "cooking calculators" use — is only valid for
`Bi ≪ 0.1` and will get the shape of the early curve badly wrong.

**But the core still ends up exponential.** The transient slab with a
convective boundary has a Fourier-series solution whose higher terms die
quickly; past `Fo = αt/L² ≈ 0.2` only the first term survives:

```
θ_centre/θ₀ = A₁·exp(−λ₁²·Fo),      λ₁·tan λ₁ = Bi
```

which is a single exponential with time constant `τ = L²/(α λ₁²)`. So the
functional form is right for a naive reason and wrong for the naive one: the
core *does* approach its environment exponentially, but with a dead time before
it starts and a pre-factor Newton's law does not have.

For a finite body the three dimensions act as parallel conductances, so their
reciprocal time constants add:

```
1/τ = Σᵢ α·λ₁ᵢ²/Lᵢ²
```

For a 1 kg, 40 mm steak in a still 125 °C oven this gives **τ ≈ 61 min**, which
is the app's prior before it has seen any data.

**Evaporation is the interesting part, and it is not a detail.** Water leaving
the surface takes ~2.4 MJ/kg with it. Two consequences, on two timescales:

1. *While there is free water on the surface*, the surface sits near the
   **wet-bulb temperature of the oven air**. For 125 °C air at a humidity ratio
   of 0.008 kg/kg that is **38.5 °C** (`steak.wet_bulb()`); radiation, which
   doesn't participate in the mass-transfer analogy, lifts the real surface to
   about 43–45 °C. That is *at or below the 44 °C target*. A genuinely wet
   steak cannot approach 44 °C at all until its surface dries — the stall is
   not a slow start, it is a hard ceiling that lifts only when the water is
   gone. For a 1 kg steak carrying a ~0.1 mm damp film (about 7 g) that takes
   6–10 minutes; straight out of a wet package it can be 20 minutes.

   **Practical consequence: pat the steak dry, or leave it uncovered in the
   fridge overnight.** It is the single cheapest change to the cook.

2. *Once the surface has dried into a crust*, moisture still diffuses out
   through it, so the surface never reaches oven temperature and the core is
   heading for an **effective asymptote well below 125 °C** — typically
   95–115 °C, and drifting slowly upward as the crust thickens.

Both effects fold into the same three-parameter shape:

```
T(t) = T∞ − (T∞ − T₀)·exp( −max(0, t − lag) / τ )

  τ     time constant, min     — thickness, film coefficient, conductivity
  T∞    effective asymptote, C — evaporative depression of the surface
  lag   dead time, min         — conduction lag + the wet-surface stall
  T₀    starting core temp, C  — measured, with a little slack
```

Three parameters is also roughly the most that two or three probe readings can
support, which is the binding constraint here.

## Fitting, and why it is Bayesian

With one reading you have no data and a strong physical prior; with three you
have a decent fit. A point estimate is useless for the actual question, which
is *"how long can I safely not look?"* — that is a question about the width of
the predictive distribution, not its centre.

So the app keeps the whole posterior. Priors:

| parameter | prior |
|---|---|
| `τ`   | lognormal, median from the geometry above, log-sd 0.35 |
| `T∞`  | normal(oven − 20 °C, 15 °C), truncated to (30 °C, oven) |
| `lag` | lognormal, median 6 min, log-sd 0.6 |
| `T₀`  | normal(first reading, 1 °C) |

Likelihood is Gaussian with σ = 0.8 °C, which is mostly probe *placement* error
rather than instrument error. Sampling is plain random-walk Metropolis over
8 vectorised chains — 4000 posterior draws in about 40 ms in a phone browser,
so the fit is instantaneous after every reading.

## When to look next

The rule is deliberately not "check at the predicted finish time" — that
overshoots half the time by construction. It is:

> Check at the earliest moment the steak could *plausibly* already be 2 °C
> short of target — the 5th percentile of the posterior arrival time at
> `target − 2 °C`.

That fixes the probability of sailing past the target unnoticed at 5% *whether
the current fit is sharp or vague*. A vague fit simply earns an earlier look;
as readings accumulate and the posterior tightens, the intervals stretch out on
their own. Two practical bounds sit on top:

* never sooner than 5 minutes (every opening costs oven heat);
* never blind for more than 55% of the remaining predicted time, so a badly
  wrong fit is caught early rather than discovered at the end.

Once the next safe check would fall at or after the predicted finish, there is
nothing left to learn: the app switches to **coast**, tells you to leave the
door shut, and names the clock time to take the steak out.

The coast target aims **0.6 °C low**. That is a calibration constant, not a
fudge: the real effective asymptote creeps upward as the crust dries, so a
fitted *constant*-asymptote exponential decelerates slightly too fast and
arrives a little early. Validation put the resulting bias at +0.67 °C; aiming
0.6 °C low removes it.

## Does it work?

`model/validate.py` runs the whole thing closed-loop. Ground truth is
`model/steak.py`: a 2-D transient finite-volume conduction solve over the
steak's cross-section with convection, radiation, humidity-driven evaporation
via the Lewis analogy, a depleting free-water film, and a drying crust whose
vapour resistance grows. The fitter never sees any of that — only a noisy probe
reading (σ = 0.5 °C) at each time the policy asks for one.

Each trial randomises what the cook does not know: thickness 30–55 mm, fan or
conventional, true oven temperature 115–133 °C (while the app is told 125),
starting core 3–20 °C, surface water 20–350 g/m², oven humidity, thermostat
cycling, and crust behaviour.

Over 40 randomised cooks:

```
core temperature error at pull:  mean +0.06 °C, sd 0.57 °C
  |error| median 0.36 °C, 90th pct 0.95 °C, worst 1.38 °C
  within ±1.0 °C: 90%      within ±2.0 °C: 100%
oven openings after the initial reading: mean 3.1, max 4
pull time: median 41 min (range 19–63)
```

The openings/accuracy trade-off is a knob (`MIN_GAP_MIN`, `MAX_BLIND_FRACTION`
in the app; `min_gap_min`, `max_blind_fraction` in `fit.advise`). Measured over
25 cooks:

| min gap | blind fraction | openings | median error | 90th pct | within ±1 °C |
|---|---|---|---|---|---|
| 5 min  | 0.55 | 3.3 | 0.31 °C | 0.80 °C | 100% |
| 8 min  | 0.55 | 2.6 | 0.70 °C | 0.93 °C | 96% |
| 12 min | 0.70 | 2.2 | 0.43 °C | 1.20 °C | 84% |

The shipped defaults are the first row. Three or four openings for a ~40 minute
cook, landing inside ±1 °C, is about as far as this trade goes: below three
openings the error grows faster than the convenience.

---

## Why this shape of tool

| option | verdict |
|---|---|
| **Self-contained web page** | **Chosen.** No install, no App Store, no build. Works offline once loaded, survives a Safari restart via `localStorage`, and "Add to Home Screen" makes it look and launch like an app. The whole model is ~250 lines of JavaScript and fits in one file. |
| Native SwiftUI app | Xcode, a developer account, a provisioning dance, and a rebuild every time the model changes. Buys a real background notification and nothing else. |
| Apple Shortcuts | Genuinely convenient to launch, but arithmetic-hostile: no way to run MCMC, awkward state between runs, and charts are out of reach. |
| Python (Pythonista/Jupyter/server) | Fine for the modelling — which is exactly what `model/` is for — but not something to operate one-handed with a probe in the other hand. |

The one real limitation of the web page: iOS will not fire a notification from
a page that isn't in the foreground unless it is installed to the home screen
*and* backed by a push server. So the app shows a live countdown, beeps and
vibrates when a check comes due if it is open — and, more usefully, always
prints the **wall-clock time** of the next check so you can set a normal iOS
timer for it.

## Using it

Open <https://sjmurdoch.github.io/reverse-sear/> on the phone, then:

1. **Setup** — first the oven (temperature, fan or conventional), then the steak
   in its own block: target, thickness, mass and its starting core.
2. Probe the steak, enter that number as the starting core, hit **Start cook**
   as it goes into the oven.
3. When the countdown expires, take it out, probe the *thermal centre*, put it
   straight back, and log the reading. Refits and reschedules instantly.
4. Eventually it says **coast** and gives you a pull time. Don't open the oven
   again; take it out then.

When the app says to take the steak out, **Out of the oven** records the
estimated core at that moment and ends the cook; **Start another steak** — or
**Start another cook**, with more than one in — clears the oven for the next one.

**Several steaks.** *Add another steak* gives up to three of them their own
name, target, thickness and mass, and one press puts them all in. The card then
counts down to a *trip to the oven* rather than to one check per steak: the door
opens when the most urgent steak needs it, everything gets probed while it is
open, and the dock walks through them one at a time ("Sirloin — 2 of 3"). Each
steak still keeps its own appointment and its own pull time, so sharing a trip
can only move a check earlier than that steak asked for. A steak added after the
cook has started goes in on its own clock, without disturbing the ones already
in there.

Everything is kept in `localStorage`, so closing Safari, locking the phone or
switching apps loses nothing — reopen the page and the cook picks up exactly
where it was, countdown and all, including the check time it had already
promised. A saved cook more than six hours old is flagged as finished rather
than silently resumed.

While a cook is running the app holds a screen wake lock, because the countdown
and its beep only run while the page is on screen. The card says which state it
is in, and gives you the wall-clock time to set a phone timer for if the lock is
not held.

Things that keep the model honest:

* Probe the same spot each time — placement error dominates instrument error.
* Get it back in the oven inside ~30 seconds.
* Pat the surface dry before it goes in (see the wet-bulb argument above).
* Sear *after* pulling, and remember the sear adds carryover: at these
  temperatures a hard sear on a 1 kg steak typically adds a couple of degrees
  at the core. If you want 44 °C after searing, aim lower here.

## Usability

[`COGNITIVE-WALKTHROUGHS.md`](COGNITIVE-WALKTHROUGHS.md) records structured
walkthroughs of the app against the four cognitive-walkthrough questions, the
defects each one found, and what changed. The first one — a busy cook juggling
other dishes — turned up a scheduling bug bad enough to change the outcome of a
cook: the next check was being pushed forward on every refit, so the countdown
never reached zero and the app never asked for a second reading.

## Deployment

`.github/workflows/pages.yml` publishes the site with GitHub Actions (the
`configure-pages` / `upload-pages-artifact` / `deploy-pages` flow, not a
`gh-pages` branch) on every push to `main`, and on demand via
**Actions → Publish to GitHub Pages → Run workflow**.

**One-time setup:** set **Settings → Pages → Source** to **GitHub Actions**.
The workflow cannot do this for itself — creating a Pages site needs a token
with admin rights, and the workflow's `GITHUB_TOKEN` does not have them.

Each run smoke-tests the model before it builds — a bad prior or a scheduling
rule that stops asking for readings fails the deploy rather than shipping.

The page carries a discreet footer stamping the commit it was built from and
that commit's timestamp, linked to the commit on GitHub, so what is live is
always identifiable.

## Tests

```bash
pip install numpy && npm ci
npx playwright install --with-deps webkit

npm test              # the page under WebKit at an iPhone 14 Pro viewport
npm run test:model    # physics, fitter and scheduling rule
```

98 tests: 67 against the page in the browser, 31 against the Python model.
`tests/README.md` describes what each file covers. WebKit is the primary target
since the app ships to iPhone Safari; CI runs WebKit and Chromium and gates the
deploy on both, alongside the Python suite.

## Running the modelling code

```bash
pip install numpy

python3 model/steak.py         # ground-truth simulator, one default cook
python3 model/fit.py           # priors and a no-data prediction
python3 model/validate.py 40   # closed-loop validation over 40 random cooks

python3 web/build.py                        # -> web/index.html
python3 web/build.py --out _site/index.html # what CI does
```

`web/app.html` is the source of truth for the page (body content only, so it
can also be published directly as a Claude Artifact); `web/build.py` wraps it in
an HTML shell and stamps the build footer to produce `web/index.html`.

`web/index.html` is generated, not committed: a checked-in copy would always
carry the stamp of the *previous* commit, since it has to be built before the
commit that contains it exists. Run `web/build.py` after cloning if you want to
open the tool straight from disk; CI builds its own copy for the live site.
