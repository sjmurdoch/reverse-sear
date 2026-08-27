# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A single-page phone tool that fits a physical heating model to probe readings
from a steak in a low oven and schedules when to next open the door. Live at
<https://sjmurdoch.github.io/reverse-sear/>. `README.md` has the physics
derivation; `COGNITIVE-WALKTHROUGHS.md` records usability walkthroughs.

## Commands

```bash
pip install numpy && npm ci                    # numpy and @playwright/test
npx playwright install --with-deps webkit      # the browser that matters

npm test                          # the page, WebKit + iPhone 14 Pro viewport
npm run test:chromium             # fallback where WebKit cannot be downloaded
npm run test:model                # physics, fitter and scheduling rule (Python)
npx playwright test -g "does not walk forward"   # one test

python3 model/steak.py            # ground-truth simulator, one default cook
python3 model/fit.py              # priors and a no-data prediction
python3 model/validate.py 40      # wide closed-loop validation (slow: ~4 s per cook)

python3 web/build.py              # regenerate web/index.html from web/app.html
python3 web/build.py --out _site/index.html    # what CI does
npm run parity:update             # after changing model/fit.py -- see Parity below
```

No linter. `.github/workflows/pages.yml` gates the deploy on the Python tests
and on both browser projects, so **changing the priors or the scheduling rule
can fail the deploy** — that is deliberate. `tests/README.md` describes the
suite; the Playwright config rebuilds and serves the page itself, so tests never
run against a stale build.

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

`tests/parity.spec.js` enforces this: deterministic quantities exactly, posterior
summaries within a band. After changing `model/fit.py`, regenerate the fixture
with `npm run parity:update` and re-run the browser tests.

One deliberate asymmetry: for a `coast`, the JS puts the pull time in `next`
(the card counts down to it) while Python keeps the unused safe-check time in
`next_check_min` and the pull in `pull_min`. Compare `pull` for coast, `next`
for measure.

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

**The schedule must be sticky, and only a browser test can catch it if it isn't.**
`advise()` floors its next check at `now + MIN_GAP_MIN`, so re-running it on a
timer walks the appointment forward a few minutes at a time and the countdown
never reaches zero. The app therefore stores the promised moment in
`state.dueAt` and only calls `rescheduleCheck()` when the *information* changes
(reading logged or deleted, cook started, a setup field edited) — never on a
plain refit. `validate.py` calls `advise` exactly once per measurement and jumps
straight to `next_check_min`, so it is sticky by construction and this class of
bug is invisible to it — as it is to `model/test_model.py`. The regression test
lives in `tests/schedule.spec.js` ("does not walk forward when the app refits on
its timer"). Test schedule behaviour in the browser, not in Python.

**`adoptCoastPull()` is the one exception to that stickiness**, and it is
load-bearing. A plain refit can flip the plan from `measure` to `coast` — the
`now + MIN_GAP_MIN` floor eventually slides past the predicted finish — while an
earlier measurement appointment is still outstanding. The card reads *due +
coast* as "take it out now", so that stale appointment pulled a real steak at
40.8 °C against a 44 °C target. When the plan coasts, `state.dueAt` therefore
becomes `plan.pull`. That is safe where re-running `rescheduleCheck()` is not,
because the pull time is anchored to the posterior and only moves when a reading
arrives. `validate.py` is blind to this too: it pulls at `adv.pull_min` directly
and never has a stale appointment to trip over.

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

WebKit is the primary target — the app ships to iPhone Safari — and is what
`npm test` and the CI gate use. `iphone-chromium` is a fallback for sandboxes
that cannot download WebKit (the Playwright CDN is blocked by egress policy in
some environments); it pins `/opt/pw-browsers/chromium` when that exists. A
result from the Chromium project is not evidence about Safari — say which
project actually ran.

**Never simulate time by moving `state.startedAt`.** It shifts every quantity
derived from it and hides exactly the bugs worth catching. The `app` fixture in
`tests/fixtures.js` installs a controllable `Date.now()` (persisted in
`sessionStorage` so it survives a reload) and exposes:

- `app.advance(min)` — clock moves and the app refits, as on its 60 s timer
- `app.drift(min)` — clock moves with no refit, as between those timers
- `app.seed([[0, 5], [14, 12]])` — drop straight into a mid-cook state
- `app.read()` / `app.state()` / `app.rows()` — what the card says, the internal
  state, the readings table

Every test fails if the page logged an uncaught or console error.

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
