# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A single-page phone tool that fits a physical heating model to probe readings
from a steak in a low oven and schedules when to next open the door. Live at
<https://sjmurdoch.github.io/reverse-sear/>. `README.md` has the physics
derivation; `COGNITIVE-WALKTHROUGHS.md` records usability walkthroughs.

## Commands

```bash
pip install numpy                 # the only dependency

python3 model/steak.py            # ground-truth simulator, one default cook
python3 model/fit.py              # priors and a no-data prediction
python3 model/validate.py 40      # closed-loop validation over 40 random cooks (slow: ~4 s each)

python3 web/build.py              # regenerate web/index.html from web/app.html
python3 web/build.py --out _site/index.html    # what CI does
```

There is no test runner and no linter. The checks that exist are
`model/validate.py` and the smoke test inlined in
`.github/workflows/pages.yml`, which asserts bounds on the prior and on
`advise()` — **changing the priors or the scheduling rule can fail the deploy**,
which is deliberate.

## Architecture

### The model is implemented twice, on purpose

`model/fit.py` is the reference implementation; the `<script>` block in
`web/app.html` is a hand-port of the same maths to JavaScript so the page stays
dependency-free. **They must stay in step.** Paired names:

| Python (`model/fit.py`) | JavaScript (`web/app.html`) |
|---|---|
| `_lambda1`, `tau_prior_minutes` | `lambda1`, `tauPriorMinutes` |
| `geometry_from_mass` | `planDims` |
| `default_priors` | `buildPriors` |
| `fit` (numpy, vectorised chains) | `fitPosterior` (mulberry32 PRNG) |
| `advise` | `advise` |
| `Priors` defaults, `advise` kwargs | module-level `const`s near `advise` |

Shared constants that must match: `GUARD_C` 2.0, `MIN_GAP_MIN` 5,
`MAX_GAP_MIN` 30, `MAX_BLIND_FRACTION` 0.55, `COAST_UNDERSHOOT_C` 0.6,
`sigma_obs` 0.8, `tau_log_sd` 0.35, `lag_median` 6.

After changing either side, cross-check them on the same input — they should
agree to MCMC noise (a couple of tenths of a minute on the predicted finish):

```bash
python3 -c "
import sys; sys.path.insert(0,'model')
from fit import *
p=fit([0,20,30],[5.0,18.8,29.0],default_priors(1.0,0.040,125.0))
a=advise(p,30.0); print([round(x,1) for x in a.hit_time], a.action, round(a.next_check_min,1))"
```

### Three layers

- `model/steak.py` — **ground truth only**, never imported by the app. A 2-D
  finite-volume conduction solve with radiation, Lewis-analogy evaporation, a
  depleting surface water film and a drying crust. Deliberately more detailed
  than the fitted model so validation is not circular.
- `model/fit.py` — the three-parameter model the app actually fits
  (`T∞`, `τ`, `lag`), its geometry-derived priors, and the scheduling rule.
- `web/app.html` — the page: the ported model plus all UI state.

`model/validate.py` closes the loop: it drives the fitter against `steak.py`
with noisy readings and reports core-temperature error at the pull and how many
times the oven was opened.

### Non-obvious invariants

**`COAST_UNDERSHOOT_C = 0.6` is empirical.** The real asymptote creeps upward as
the crust dries, so a constant-asymptote exponential arrives slightly early.
Any change to the model form invalidates this number — re-derive it by running
`validate.py` and reading the mean error, which should sit near zero.

**The schedule must be sticky, and `validate.py` cannot catch it if it isn't.**
`advise()` floors its next check at `now + MIN_GAP_MIN`, so re-running it on a
timer walks the appointment forward a few minutes at a time and the countdown
never reaches zero. The app therefore stores the promised moment in
`state.dueAt` and only calls `rescheduleCheck()` when the *information* changes
(reading logged or deleted, cook started, a setup field edited) — never on a
plain refit. `validate.py` calls `advise` exactly once per measurement and jumps
straight to `next_check_min`, so it is sticky by construction and this class of
bug is invisible to it. Test schedule behaviour in the browser, not in Python.

**`web/app.html` is body content only** — no `<!doctype>`, `<html>`, `<head>` or
`<body>` tags — so it can be published directly as a Claude Artifact.
`web/build.py` wraps it in an HTML shell and replaces the text between the
`<!--BUILD-->` / `<!--/BUILD-->` markers with a commit stamp.

**`web/index.html` is generated and gitignored.** A committed copy could only
ever carry the *previous* commit's stamp. Rerun `web/build.py` after every edit
to `app.html`; CI builds its own copy for the live site.

**The page must stay self-contained.** A strict CSP applies when it is published
as an Artifact: no external requests except Google Fonts. Colours are defined as
tokens on bare `:root` and redefined for both `prefers-color-scheme: dark` and
`[data-theme="dark"]` — never declare a colour only inside a media or
`[data-theme]` block.

**`render()` runs every second.** It must be cheap and idempotent. Anything
rebuilt there can be replaced under the user's finger, which is why `setAction()`
only touches the DOM when the button actually changes.

## Testing the page

No committed harness; drive it with Playwright against a local static server.
Chromium is pre-installed but the version Playwright expects may not be, so pin
the executable:

```js
chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
```

```bash
python3 -m http.server 8777 --bind 127.0.0.1   # serve web/ after building
```

Time-dependent behaviour needs an advancing clock, not a moved start time —
shifting `state.startedAt` also shifts every derived quantity and hides exactly
the bugs you are looking for:

```js
await page.addInitScript(() => {
  window.__skew = 0;
  const real = Date.now;
  Date.now = () => real() + window.__skew;
});
// then: await page.evaluate(() => { window.__skew += 6*60000; recompute(); render(); });
```

## Deployment

`.github/workflows/pages.yml` publishes on push to `main` via the Actions flow
(`configure-pages` → `upload-pages-artifact` → `deploy-pages`), not a `gh-pages`
branch. **Settings → Pages → Source must be "GitHub Actions"** — the workflow
cannot set this itself, because creating a Pages site needs a token with admin
rights that `GITHUB_TOKEN` does not have. `enablement: true` on `configure-pages`
fails with "Resource not accessible by integration"; do not re-add it.

## Conventions

Usability changes get a walkthrough entry in `COGNITIVE-WALKTHROUGHS.md`:
persona, the stage and which of the four cognitive-walkthrough questions failed,
the change, and what was deliberately *not* changed to avoid regressing other
users of the tool.
